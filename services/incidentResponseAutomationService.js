const axios = require('axios');
const SecurityIncident = require('../models/SecurityIncident');
const PlaybookExecution = require('../models/PlaybookExecution');
const PlaybookActionAudit = require('../models/PlaybookActionAudit');
const User = require('../models/User');
const notificationService = require('./notificationService');
const PlaybookExecutorService = require('./playbooks/playbookExecutorService');

/**
 * Incident Response Automation Engine
 * Issue #919: Automated Incident Detection, Response, and Orchestration
 */
class IncidentResponseAutomationService {
  constructor() {
    this.executor = new PlaybookExecutorService();

    this.defaultActionMatrix = {
      LOW: ['USER_NOTIFICATION'],
      MEDIUM: ['SELECTIVE_TOKEN_REVOKE', 'USER_NOTIFICATION', 'STEP_UP_CHALLENGE'],
      HIGH: ['SELECTIVE_TOKEN_REVOKE', 'IPBLACKLIST_ADD', 'FORCE_PASSWORD_RESET', 'DEVICE_DEREGISTER', 'ANALYST_ESCALATION'],
      CRITICAL: ['FULL_SESSION_KILL', 'ACCOUNT_SUSPEND', 'IPBLACKLIST_ADD', 'FORCE_PASSWORD_RESET', 'DEVICE_DEREGISTER', 'ANALYST_ESCALATION', 'CUSTOM_WEBHOOK']
    };
  }

  toCanonicalSeverity(severity = '') {
    const normalized = String(severity).toUpperCase();
    if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(normalized)) return normalized;
    return 'MEDIUM';
  }

  toIncidentSeverity(severity) {
    return this.toCanonicalSeverity(severity).toLowerCase();
  }

  classifySeverity(input = {}) {
    const confidence = Number(input.confidenceScore || 0);
    const campaignSize = Number(input.campaignMetrics?.totalEntities || 0);
    const compromisedAccounts = Number(input.campaignMetrics?.compromisedAccounts?.length || 0);
    const targetedAccounts = Number(input.campaignMetrics?.targetedAccounts?.length || 0);
    const patternCount = Number(input.attackPatterns?.length || 0);
    const attackVelocity = String(input.campaignMetrics?.attackVelocity || '').toUpperCase();

    let score = 0;
    score += Math.min(confidence, 100) * 0.35;
    score += Math.min(campaignSize, 50) * 0.6;
    score += Math.min(compromisedAccounts * 10, 30);
    score += Math.min(targetedAccounts * 2, 20);
    score += Math.min(patternCount * 5, 20);

    if (attackVelocity === 'BURST') score += 10;
    if (input.incidentType === 'DATA_EXFILTRATION') score += 15;
    if (input.incidentType === 'ACCOUNT_TAKEOVER_CAMPAIGN') score += 12;

    let severity = 'LOW';
    if (score >= 80) severity = 'CRITICAL';
    else if (score >= 60) severity = 'HIGH';
    else if (score >= 35) severity = 'MEDIUM';

    return {
      severity,
      score: Math.round(score),
      confidence,
      factors: {
        campaignSize,
        compromisedAccounts,
        targetedAccounts,
        patternCount,
        attackVelocity
      }
    };
  }

  buildExecutionContext(incident, context = {}) {
    const affectedUserId =
      context.userId ||
      context.targetUser ||
      incident.assignedTo?.userId ||
      incident.campaignMetrics?.targetedAccounts?.[0] ||
      incident.campaignMetrics?.compromisedAccounts?.[0] ||
      null;

    return {
      incidentId: incident._id,
      executionId: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      playbookType: 'AUTOMATED_INCIDENT_RESPONSE',
      userId: affectedUserId,
      riskLevel: this.toCanonicalSeverity(incident.severity),
      clientIP: context.clientIP || context.ipAddress || null,
      suspiciousGeoLocation: context.suspiciousGeoLocation || null,
      currentSessionId: context.currentSessionId || null,
      actorUserId: context.actorUserId || null,
      source: context.source || 'INCIDENT_AUTOMATION_ENGINE'
    };
  }

  buildActions(severity, context = {}) {
    const mapped = this.defaultActionMatrix[this.toCanonicalSeverity(severity)] || this.defaultActionMatrix.MEDIUM;

    return mapped.map((actionType, index) => {
      const parameters = {
        ...(context.actionParameters || {})
      };

      if (actionType === 'IPBLACKLIST_ADD' && context.clientIP) {
        parameters.ipAddress = context.clientIP;
      }

      if (actionType === 'CUSTOM_WEBHOOK' && process.env.INCIDENT_AUTOMATION_WEBHOOK_URL) {
        parameters.webhookUrl = process.env.INCIDENT_AUTOMATION_WEBHOOK_URL;
        parameters.customData = {
          source: 'incident-automation',
          severity,
          incidentContext: {
            actorUserId: context.actorUserId,
            reason: context.reason
          }
        };
      }

      return {
        actionId: `auto-${actionType.toLowerCase()}-${index + 1}`,
        actionType,
        stage: index < 2 ? 1 : (index < 5 ? 2 : 3),
        parameters
      };
    });
  }

  mapToResponseAction(actionType) {
    const map = {
      IPBLACKLIST_ADD: 'BLOCKED_IP',
      SELECTIVE_TOKEN_REVOKE: 'REVOKED_SESSION',
      FULL_SESSION_KILL: 'MASS_REVOKED_SESSIONS',
      STEP_UP_CHALLENGE: 'FORCED_REAUTH',
      ACCOUNT_SUSPEND: 'DISABLED_ACCOUNT',
      USER_NOTIFICATION: 'ALERTED_USER',
      ANALYST_ESCALATION: 'ESCALATED',
      FORCE_PASSWORD_RESET: 'FORCED_REAUTH'
    };

    return map[actionType] || 'INVESTIGATED';
  }

  async executeActions(incident, actions, context = {}) {
    const execution = this.buildExecutionContext(incident, context);
    const results = [];

    for (const action of actions) {
      try {
        const result = await this.executor.executeAction(action, execution, context);
        results.push({ actionType: action.actionType, success: true, result });

        await incident.recordAction(
          this.mapToResponseAction(action.actionType),
          context.actorUserId || null,
          context.clientIP || context.userId || null,
          context.clientIP ? 'IP' : 'USER',
          'Automated incident response',
          { actionType: action.actionType, result }
        );
      } catch (error) {
        results.push({ actionType: action.actionType, success: false, error: error.message });
      }
    }

    return results;
  }

  async reconstructTimeline(incidentId) {
    const incident = await SecurityIncident.findById(incidentId)
      .populate('assignedTo.userId', 'name email')
      .lean();

    if (!incident) {
      throw new Error('Incident not found');
    }

    const executions = await PlaybookExecution.find({ incidentId })
      .select('executionId status startedAt completedAt actionExecutions auditEvents riskLevel')
      .sort({ startedAt: 1 })
      .lean();

    const audits = await PlaybookActionAudit.find({ incidentId })
      .select('actionType status requestedAt completedAt error')
      .sort({ requestedAt: 1 })
      .lean();

    const timeline = [];

    timeline.push({
      timestamp: incident.detectedAt,
      type: 'INCIDENT_DETECTED',
      details: {
        incidentId: incident.incidentId,
        incidentType: incident.incidentType,
        severity: incident.severity,
        confidenceScore: incident.confidenceScore
      }
    });

    for (const chainEvent of (incident.evidence?.evidenceChain || [])) {
      timeline.push({
        timestamp: chainEvent.timestamp,
        type: 'EVIDENCE_EVENT',
        details: chainEvent
      });
    }

    for (const responseAction of (incident.responseActions || [])) {
      timeline.push({
        timestamp: responseAction.performedAt,
        type: 'CONTAINMENT_ACTION',
        details: responseAction
      });
    }

    for (const execution of executions) {
      timeline.push({
        timestamp: execution.startedAt,
        type: 'PLAYBOOK_EXECUTION',
        details: {
          executionId: execution.executionId,
          status: execution.status,
          riskLevel: execution.riskLevel
        }
      });

      for (const auditEvent of (execution.auditEvents || [])) {
        timeline.push({
          timestamp: auditEvent.timestamp,
          type: 'EXECUTION_AUDIT',
          details: auditEvent
        });
      }
    }

    for (const audit of audits) {
      timeline.push({
        timestamp: audit.requestedAt || audit.completedAt,
        type: 'ACTION_AUDIT',
        details: audit
      });
    }

    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return {
      incident: {
        id: incident._id,
        incidentId: incident.incidentId,
        status: incident.status,
        severity: incident.severity
      },
      timeline,
      counts: {
        timelineEvents: timeline.length,
        responseActions: incident.responseActions?.length || 0,
        executions: executions.length,
        actionAudits: audits.length
      }
    };
  }

  generateRootCauseAnalysis(incident) {
    const attackPatterns = (incident.attackPatterns || []).map(p => p.patternType);
    const centralNodes = (incident.graphAnalysis?.centralNodes || []).map(n => ({
      entityType: n.entityType,
      entityValue: n.entityValue,
      centralityScore: n.centralityScore
    }));

    const likelyRootCauses = [];

    if (attackPatterns.includes('CREDENTIAL_STUFFING') || incident.incidentType === 'CREDENTIAL_STUFFING') {
      likelyRootCauses.push('Compromised credentials reused across accounts');
    }

    if (attackPatterns.includes('IMPOSSIBLE_TRAVEL')) {
      likelyRootCauses.push('Anomalous geolocation behavior indicating session theft or proxy abuse');
    }

    if ((incident.campaignMetrics?.uniqueIPs || 0) > 20) {
      likelyRootCauses.push('Distributed attack infrastructure (possible botnet or proxy network)');
    }

    if ((incident.campaignMetrics?.compromisedAccounts || []).length > 0) {
      likelyRootCauses.push('Identity hardening gaps (MFA/session trust controls bypassed or absent)');
    }

    if (likelyRootCauses.length === 0) {
      likelyRootCauses.push('Insufficient telemetry to determine definitive root cause; requires analyst review');
    }

    return {
      incidentId: incident.incidentId,
      incidentType: incident.incidentType,
      severity: incident.severity,
      confidenceScore: incident.confidenceScore,
      likelyRootCauses,
      evidenceHighlights: {
        attackPatterns,
        centralNodes,
        uniqueIPs: incident.campaignMetrics?.uniqueIPs || 0,
        uniqueDevices: incident.campaignMetrics?.uniqueDevices || 0,
        targetedUsers: incident.campaignMetrics?.uniqueUsers || 0
      },
      generatedAt: new Date().toISOString()
    };
  }

  async notifyAndCoordinate(incident, runResult, context = {}) {
    const impactedUsers = [
      ...(incident.campaignMetrics?.targetedAccounts || []),
      ...(incident.campaignMetrics?.compromisedAccounts || [])
    ].map(id => String(id));

    const dedupedUsers = [...new Set(impactedUsers)].slice(0, 50);

    for (const userId of dedupedUsers) {
      try {
        await notificationService.notifySecurityAlert(userId, {
          title: `Incident ${incident.incidentId} response initiated`,
          message: 'Protective actions were automatically applied to reduce risk.',
          alertType: 'INCIDENT_RESPONSE_AUTOMATION'
        });
      } catch (error) {
        console.warn(`Failed to notify impacted user ${userId}:`, error.message);
      }
    }

    await this.sendExternalIntegrations(incident, runResult, context);
  }

  async sendExternalIntegrations(incident, runResult, context = {}) {
    const payload = {
      event: 'incident.automation.completed',
      timestamp: new Date().toISOString(),
      incident: {
        id: incident._id,
        incidentId: incident.incidentId,
        type: incident.incidentType,
        severity: incident.severity,
        status: incident.status,
        confidenceScore: incident.confidenceScore
      },
      runResult,
      context: {
        source: context.source || 'incident-automation',
        actorUserId: context.actorUserId || null,
        reason: context.reason || null
      }
    };

    const outboundTargets = [
      { name: 'SIEM', url: process.env.INCIDENT_SIEM_WEBHOOK_URL },
      { name: 'Ticketing', url: process.env.INCIDENT_TICKETING_WEBHOOK_URL },
      { name: 'Automation', url: process.env.INCIDENT_AUTOMATION_WEBHOOK_URL }
    ].filter(t => !!t.url);

    for (const target of outboundTargets) {
      try {
        await axios.post(target.url, payload, {
          timeout: 8000,
          headers: {
            'Content-Type': 'application/json',
            'X-Incident-Event': payload.event,
            'X-Incident-Id': incident.incidentId
          }
        });
      } catch (error) {
        console.warn(`[IncidentAutomation] Failed external dispatch to ${target.name}:`, error.message);
      }
    }
  }

  emitCommandCenterUpdate(eventType, payload) {
    if (global.io) {
      global.io.emit('incident:command-center:update', {
        eventType,
        timestamp: new Date().toISOString(),
        payload
      });
    }
  }

  async detectAndRespond(incidentInput, context = {}) {
    const classification = this.classifySeverity(incidentInput);
    const normalizedSeverity = this.toIncidentSeverity(incidentInput.severity || classification.severity);

    const incident = await SecurityIncident.create({
      title: incidentInput.title || `${incidentInput.incidentType || 'SECURITY_INCIDENT'} detected`,
      description: incidentInput.description || 'Incident generated by automation engine',
      incidentType: incidentInput.incidentType || 'OTHER',
      severity: normalizedSeverity,
      confidenceScore: Number(incidentInput.confidenceScore || classification.confidence || 60),
      status: 'NEW',
      campaignMetrics: {
        ...(incidentInput.campaignMetrics || {}),
        totalEntities: incidentInput.campaignMetrics?.totalEntities || 0,
        totalEvents: incidentInput.campaignMetrics?.totalEvents || 0,
        targetedAccounts: incidentInput.campaignMetrics?.targetedAccounts || [],
        compromisedAccounts: incidentInput.campaignMetrics?.compromisedAccounts || []
      },
      attackPatterns: incidentInput.attackPatterns || [],
      evidence: {
        ...(incidentInput.evidence || {}),
        evidenceChain: incidentInput.evidence?.evidenceChain || []
      },
      detectedBy: context.source || 'INCIDENT_AUTOMATION_ENGINE',
      detectionVersion: '1.0.0',
      tags: ['AUTOMATED_RESPONSE', this.toCanonicalSeverity(classification.severity)]
    });

    const actions = this.buildActions(classification.severity, context);
    const actionResults = await this.executeActions(incident, actions, context);

    const failedActions = actionResults.filter(r => !r.success).length;
    const successfulActions = actionResults.filter(r => r.success).length;

    if (failedActions > 0 || this.toCanonicalSeverity(classification.severity) === 'CRITICAL') {
      await this.escalateIncident(incident, {
        reason: failedActions > 0
          ? `Automation failures detected (${failedActions} action(s) failed)`
          : 'Critical severity requires human oversight',
        actorUserId: context.actorUserId,
        source: context.source || 'INCIDENT_AUTOMATION_ENGINE'
      });
    }

    if (successfulActions > 0) {
      incident.status = 'MITIGATED';
      incident.timeToMitigation = Date.now() - new Date(incident.detectedAt).getTime();
      await incident.save();
    }

    const runResult = {
      incidentId: incident.incidentId,
      severity: this.toCanonicalSeverity(classification.severity),
      classification,
      actionsAttempted: actions.length,
      successfulActions,
      failedActions,
      actionResults
    };

    await this.notifyAndCoordinate(incident, runResult, context);

    this.emitCommandCenterUpdate('INCIDENT_AUTOMATION_COMPLETED', {
      incidentId: incident.incidentId,
      severity: runResult.severity,
      successfulActions,
      failedActions
    });

    return {
      incident,
      runResult
    };
  }

  async respondToExistingIncident(incidentId, context = {}) {
    const incident = await SecurityIncident.findById(incidentId);
    if (!incident) {
      throw new Error('Incident not found');
    }

    const severity = this.toCanonicalSeverity(incident.severity);
    const actions = this.buildActions(severity, context);
    const actionResults = await this.executeActions(incident, actions, context);

    const runResult = {
      incidentId: incident.incidentId,
      severity,
      actionsAttempted: actions.length,
      successfulActions: actionResults.filter(r => r.success).length,
      failedActions: actionResults.filter(r => !r.success).length,
      actionResults
    };

    await this.notifyAndCoordinate(incident, runResult, context);

    this.emitCommandCenterUpdate('INCIDENT_RESPONSE_REPLAY', {
      incidentId: incident.incidentId,
      severity,
      successfulActions: runResult.successfulActions,
      failedActions: runResult.failedActions
    });

    return { incident, runResult };
  }

  async escalateIncident(incident, context = {}) {
    const analysts = await User.find({
      role: { $in: ['SECURITY_ANALYST', 'INCIDENT_COMMANDER', 'SECURITY_ADMIN'] },
      active: true
    }).select('_id email').limit(10);

    for (const analyst of analysts) {
      try {
        await notificationService.notifySecurityAlert(analyst._id, {
          title: `Escalation required: ${incident.incidentId}`,
          message: context.reason || 'Incident requires analyst review',
          alertType: 'INCIDENT_ESCALATION'
        });
      } catch (error) {
        console.warn(`Failed to notify analyst ${analyst._id}:`, error.message);
      }
    }

    await incident.recordAction(
      'ESCALATED',
      context.actorUserId || null,
      null,
      'INCIDENT',
      context.reason || 'Escalated by automation policy',
      {
        source: context.source || 'INCIDENT_AUTOMATION_ENGINE',
        escalatedAt: new Date(),
        analystsNotified: analysts.length
      }
    );

    if (incident.status === 'NEW') {
      incident.status = 'INVESTIGATING';
      await incident.save();
    }

    this.emitCommandCenterUpdate('INCIDENT_ESCALATED', {
      incidentId: incident.incidentId,
      reason: context.reason,
      analystsNotified: analysts.length
    });

    return {
      escalated: true,
      analystsNotified: analysts.length,
      reason: context.reason || 'Human review required'
    };
  }

  async addLessonsLearned(incidentId, analystUserId, lessons, recommendations = []) {
    const incident = await SecurityIncident.findById(incidentId);
    if (!incident) {
      throw new Error('Incident not found');
    }

    await incident.addAnalystNote(
      analystUserId,
      `${lessons}\nRecommendations: ${(recommendations || []).join('; ')}`,
      'CONCLUSION'
    );

    return {
      incidentId: incident.incidentId,
      lessons,
      recommendations,
      updatedAt: new Date().toISOString()
    };
  }

  async getIncidentKpis(windowDays = 30) {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const incidents = await SecurityIncident.find({ detectedAt: { $gte: since } }).lean();
    const executions = await PlaybookExecution.find({ startedAt: { $gte: since } }).lean();

    const total = incidents.length;
    const mitigated = incidents.filter(i => i.status === 'MITIGATED' || i.status === 'RESOLVED').length;
    const escalated = incidents.filter(i => (i.responseActions || []).some(a => a.actionType === 'ESCALATED')).length;

    const mttrValues = incidents
      .filter(i => typeof i.timeToResolution === 'number' && i.timeToResolution > 0)
      .map(i => i.timeToResolution);

    const mttmValues = incidents
      .filter(i => typeof i.timeToMitigation === 'number' && i.timeToMitigation > 0)
      .map(i => i.timeToMitigation);

    const avg = values => values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;

    const bySeverity = ['critical', 'high', 'medium', 'low'].reduce((acc, sev) => {
      acc[sev.toUpperCase()] = incidents.filter(i => i.severity === sev).length;
      return acc;
    }, {});

    return {
      windowDays,
      incidents: {
        total,
        mitigated,
        open: total - mitigated,
        escalationRate: total ? Number(((escalated / total) * 100).toFixed(2)) : 0,
        bySeverity
      },
      response: {
        meanTimeToMitigateMs: avg(mttmValues),
        meanTimeToResolveMs: avg(mttrValues)
      },
      playbookExecutions: {
        total: executions.length,
        completed: executions.filter(e => e.status === 'COMPLETED').length,
        failed: executions.filter(e => e.status === 'FAILED').length
      }
    };
  }

  async getCommandCenterDashboard(limit = 20) {
    const [activeIncidents, recentExecutions, recentAudits, kpis] = await Promise.all([
      SecurityIncident.find({ status: { $in: ['NEW', 'INVESTIGATING', 'CONFIRMED', 'MITIGATED'] } })
        .sort({ detectedAt: -1 })
        .limit(limit)
        .lean(),
      PlaybookExecution.find({})
        .sort({ startedAt: -1 })
        .limit(limit)
        .select('executionId playbookName status riskLevel incidentId startedAt completedAt failedActions successfulActions')
        .lean(),
      PlaybookActionAudit.find({})
        .sort({ requestedAt: -1 })
        .limit(limit)
        .select('auditId actionType status incidentId requestedAt completedAt')
        .lean(),
      this.getIncidentKpis(30)
    ]);

    return {
      generatedAt: new Date().toISOString(),
      activeIncidents,
      recentExecutions,
      recentAudits,
      kpis
    };
  }
}

module.exports = new IncidentResponseAutomationService();
