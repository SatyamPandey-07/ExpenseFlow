const crypto = require('crypto');
const ImmutableAuditLog = require('../models/ImmutableAuditLog');
const ComplianceViolation = require('../models/ComplianceViolation');
const UserConsent = require('../models/UserConsent');
const DataAccessLog = require('../models/DataAccessLog');
const Workspace = require('../models/Workspace');

class AuditComplianceService {
  constructor() {
    this.complianceRules = new Map();
    this.setupComplianceRules();
  }

  setupComplianceRules() {
    this.complianceRules.set('data_retention', { days: 2555 });
    this.complianceRules.set('access_logging', { enabled: true });
    this.complianceRules.set('immutability', { enabled: true, hashChain: true });
    this.complianceRules.set('forensic_export', { enabled: true });
  }

  async validateWorkspaceAccess(userId, workspaceId) {
    if (!workspaceId) return true;

    const hasAccess = await Workspace.exists({
      _id: workspaceId,
      $or: [
        { owner: userId },
        { 'members.user': userId }
      ]
    });

    if (!hasAccess) {
      throw new Error('Access denied for requested workspace');
    }

    return true;
  }

  async logImmutableAudit(userId, action, entityType, entityId = null, changes = {}, options = {}) {
    const record = await ImmutableAuditLog.create({
      userId,
      workspaceId: options.workspaceId || null,
      action,
      entityType,
      entityId,
      changes: {
        before: changes.before,
        after: changes.after
      },
      metadata: {
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        sessionId: options.sessionId,
        apiEndpoint: options.apiEndpoint,
        requestId: options.requestId,
        geolocation: options.geolocation,
        deviceInfo: options.deviceInfo,
        correlationId: options.correlationId,
        timelineId: options.timelineId,
        tags: options.tags || []
      },
      riskLevel: options.riskLevel || 'low',
      complianceFlags: options.complianceFlags || []
    });

    return record;
  }

  async verifyAuditIntegrity(startSequence = null, endSequence = null, workspaceId = null) {
    const query = {};
    if (workspaceId) query.workspaceId = workspaceId;
    if (startSequence !== null || endSequence !== null) {
      query.sequenceNumber = {};
      if (startSequence !== null) query.sequenceNumber.$gte = Number(startSequence);
      if (endSequence !== null) query.sequenceNumber.$lte = Number(endSequence);
    }

    const logs = await ImmutableAuditLog.find(query).sort({ sequenceNumber: 1 }).lean();

    if (logs.length === 0) {
      return {
        verified: true,
        checked: 0,
        issues: [],
        message: 'No logs found for requested range'
      };
    }

    const issues = [];
    let previousHash = '0000000000000000000000000000000000000000000000000000000000000000';

    for (const log of logs) {
      if (log.previousHash !== previousHash) {
        issues.push({
          sequenceNumber: log.sequenceNumber,
          type: 'CHAIN_BREAK',
          expected: previousHash,
          actual: log.previousHash
        });
      }

      const expectedSignature = crypto
        .createHmac('sha256', process.env.AUDIT_SIGNATURE_KEY || 'default-key')
        .update(log.currentHash)
        .digest('hex');

      if (expectedSignature !== log.signature) {
        issues.push({
          sequenceNumber: log.sequenceNumber,
          type: 'INVALID_SIGNATURE'
        });
      }

      previousHash = log.currentHash;
    }

    return {
      verified: issues.length === 0,
      checked: logs.length,
      issues,
      startSequence: logs[0].sequenceNumber,
      endSequence: logs[logs.length - 1].sequenceNumber
    };
  }

  async reconstructTimeline(filters = {}) {
    const query = {};

    if (filters.workspaceId) query.workspaceId = filters.workspaceId;
    if (filters.userId) query.userId = filters.userId;
    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.entityId) query.entityId = filters.entityId;
    if (filters.requestId) query['metadata.requestId'] = filters.requestId;
    if (filters.sessionId) query['metadata.sessionId'] = filters.sessionId;
    if (filters.correlationId) query['metadata.correlationId'] = filters.correlationId;
    if (filters.action) query.action = filters.action;
    if (filters.riskLevel) query.riskLevel = filters.riskLevel;

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
    }

    const limit = Math.min(Number(filters.limit) || 500, 5000);
    const logs = await ImmutableAuditLog.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: 1, sequenceNumber: 1 })
      .limit(limit)
      .lean();

    return {
      count: logs.length,
      startedAt: logs[0]?.createdAt || null,
      endedAt: logs[logs.length - 1]?.createdAt || null,
      timeline: logs
    };
  }

  async correlateAnomalies(filters = {}) {
    const matchStage = {};
    if (filters.workspaceId) matchStage.workspaceId = filters.workspaceId;
    if (filters.startDate || filters.endDate) {
      matchStage.createdAt = {};
      if (filters.startDate) matchStage.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) matchStage.createdAt.$lte = new Date(filters.endDate);
    }

    const suspiciousActions = filters.actions || [
      'login_failed',
      'login_blocked',
      'suspicious_activity',
      'rate_limit_exceeded',
      'ip_blocked',
      'account_locked'
    ];

    matchStage.$or = [
      { action: { $in: suspiciousActions } },
      { status: 'failure' },
      { riskLevel: { $in: ['high', 'critical'] } }
    ];

    const correlatedByIp = await ImmutableAuditLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$metadata.ipAddress',
          events: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
          latestEvent: { $max: '$createdAt' },
          highRiskCount: {
            $sum: {
              $cond: [{ $in: ['$riskLevel', ['high', 'critical']] }, 1, 0]
            }
          }
        }
      },
      {
        $project: {
          ipAddress: '$_id',
          eventCount: '$events',
          uniqueUserCount: { $size: '$uniqueUsers' },
          latestEvent: 1,
          highRiskCount: 1,
          _id: 0
        }
      },
      { $sort: { eventCount: -1 } },
      { $limit: 100 }
    ]);

    const correlatedBySession = await ImmutableAuditLog.aggregate([
      { $match: matchStage },
      { $match: { 'metadata.sessionId': { $nin: [null, ''] } } },
      {
        $group: {
          _id: '$metadata.sessionId',
          events: { $sum: 1 },
          actions: { $addToSet: '$action' },
          firstSeen: { $min: '$createdAt' },
          lastSeen: { $max: '$createdAt' }
        }
      },
      { $sort: { events: -1 } },
      { $limit: 100 }
    ]);

    return {
      byIp: correlatedByIp,
      bySession: correlatedBySession,
      generatedAt: new Date()
    };
  }

  async generateComplianceReport(standard, workspaceId = null, dateRange = {}) {
    if (workspaceId) {
      await this.validateWorkspaceAccess(dateRange.requestedBy || null, workspaceId).catch(() => {});
    }

    const query = {};
    if (workspaceId) query.workspaceId = workspaceId;
    if (dateRange.start || dateRange.end) {
      query.createdAt = {};
      if (dateRange.start) query.createdAt.$gte = new Date(dateRange.start);
      if (dateRange.end) query.createdAt.$lte = new Date(dateRange.end);
    }

    const [totalLogs, standardFlags, violations] = await Promise.all([
      ImmutableAuditLog.countDocuments(query),
      ImmutableAuditLog.countDocuments({
        ...query,
        complianceFlags: { $elemMatch: { standard } }
      }),
      ComplianceViolation.find({
        ...(workspaceId ? { workspaceId } : {}),
        standard
      })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()
    ]);

    const openViolations = violations.filter(v => v.status !== 'resolved').length;
    const criticalViolations = violations.filter(v => v.severity === 'critical').length;

    return {
      standard,
      workspaceId,
      period: {
        start: dateRange.start || null,
        end: dateRange.end || null
      },
      summary: {
        totalLogs,
        standardFlags,
        totalViolations: violations.length,
        openViolations,
        criticalViolations
      },
      violations,
      generatedAt: new Date().toISOString()
    };
  }

  async applyLegalHold(entityType, entityId, reason, holdBy) {
    const result = await ImmutableAuditLog.updateMany(
      { entityType, entityId },
      {
        $set: {
          'retentionPolicy.legalHold': true,
          'retentionPolicy.holdReason': reason,
          'retentionPolicy.holdBy': holdBy
        }
      }
    );

    return result;
  }

  async releaseLegalHold(entityType, entityId, releasedBy) {
    const result = await ImmutableAuditLog.updateMany(
      { entityType, entityId },
      {
        $set: {
          'retentionPolicy.legalHold': false,
          'retentionPolicy.holdReason': null,
          'retentionPolicy.holdBy': releasedBy
        }
      }
    );

    return result;
  }

  async calculateOverallComplianceScore(workspaceId = null) {
    const baseQuery = workspaceId ? { workspaceId } : {};
    const [totalLogs, violations, criticalViolations, highRiskLogs] = await Promise.all([
      ImmutableAuditLog.countDocuments(baseQuery),
      ComplianceViolation.countDocuments({ ...(workspaceId ? { workspaceId } : {}), status: { $ne: 'resolved' } }),
      ComplianceViolation.countDocuments({ ...(workspaceId ? { workspaceId } : {}), severity: 'critical', status: { $ne: 'resolved' } }),
      ImmutableAuditLog.countDocuments({ ...baseQuery, riskLevel: { $in: ['high', 'critical'] } })
    ]);

    if (totalLogs === 0) return 100;

    const violationPenalty = Math.min(40, violations * 2);
    const criticalPenalty = Math.min(30, criticalViolations * 5);
    const riskPenalty = Math.min(20, Math.round((highRiskLogs / totalLogs) * 100));

    return Math.max(0, 100 - violationPenalty - criticalPenalty - riskPenalty);
  }

  convertToCSV(logs = []) {
    if (!logs.length) return 'sequenceNumber,createdAt,userId,workspaceId,action,entityType,riskLevel\n';

    const escape = (value) => {
      if (value === null || value === undefined) return '';
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'sequenceNumber', 'createdAt', 'userId', 'workspaceId', 'action',
      'entityType', 'entityId', 'riskLevel', 'apiEndpoint', 'ipAddress', 'requestId'
    ];

    const rows = logs.map((log) => {
      return [
        log.sequenceNumber,
        log.createdAt,
        log.userId?._id || log.userId,
        log.workspaceId,
        log.action,
        log.entityType,
        log.entityId,
        log.riskLevel,
        log.metadata?.apiEndpoint,
        log.metadata?.ipAddress,
        log.metadata?.requestId
      ].map(escape).join(',');
    });

    return `${headers.join(',')}\n${rows.join('\n')}`;
  }

  convertToXML(logs = []) {
    const records = logs.map((log) => `
  <auditLog>
    <sequenceNumber>${log.sequenceNumber || ''}</sequenceNumber>
    <createdAt>${log.createdAt || ''}</createdAt>
    <userId>${log.userId?._id || log.userId || ''}</userId>
    <workspaceId>${log.workspaceId || ''}</workspaceId>
    <action>${log.action || ''}</action>
    <entityType>${log.entityType || ''}</entityType>
    <entityId>${log.entityId || ''}</entityId>
    <riskLevel>${log.riskLevel || ''}</riskLevel>
    <apiEndpoint>${log.metadata?.apiEndpoint || ''}</apiEndpoint>
    <ipAddress>${log.metadata?.ipAddress || ''}</ipAddress>
    <requestId>${log.metadata?.requestId || ''}</requestId>
  </auditLog>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<auditLogs>${records}\n</auditLogs>`;
  }

  getComplianceStatus() {
    return {
      status: 'active',
      rules: Object.fromEntries(this.complianceRules),
      lastCheck: new Date()
    };
  }

  // ========================================
  // USER CONSENT TRACKING METHODS
  // Issue #920: Compliance & Audit Logging Framework
  // ========================================

  async recordConsent(data) {
    const consent = await UserConsent.create({
      userId: data.userId,
      workspaceId: data.workspaceId,
      consentType: data.consentType,
      consentGiven: data.consentGiven,
      consentVersion: data.consentVersion,
      legalBasis: data.legalBasis || 'consent',
      consentMethod: data.consentMethod,
      consentTimestamp: data.consentTimestamp || new Date(),
      expiresAt: data.expiresAt,
      metadata: data.metadata,
      proofOfConsent: data.proofOfConsent,
      regulations: data.regulations || [],
      auditTrail: [{
        action: 'consent_given',
        timestamp: new Date(),
        reason: data.reason,
        performedBy: data.userId,
        metadata: data.metadata
      }]
    });

    // Create immutable audit log entry
    await this.logImmutableAudit(
      data.userId,
      `consent_${data.consentGiven ? 'given' : 'denied'}`,
      'user_consent',
      consent._id,
      {},
      {
        workspaceId: data.workspaceId,
        ipAddress: data.metadata?.ipAddress,
        userAgent: data.metadata?.userAgent,
        sessionId: data.metadata?.sessionId,
        complianceFlags: (data.regulations || []).map(reg => ({
          standard: reg,
          requirement: `User consent tracking - ${data.consentType}`,
          status: 'compliant',
          details: `Consent ${data.consentGiven ? 'granted' : 'denied'} for ${data.consentType}`
        }))
      }
    );

    return consent;
  }

  async withdrawConsent(userId, consentType, reason, metadata = {}) {
    const consents = await UserConsent.find({
      userId,
      consentType,
      consentGiven: true,
      withdrawnAt: null
    });

    const results = [];
    for (const consent of consents) {
      await consent.withdraw(reason, userId);
      results.push(consent);

      // Log withdrawal
      await this.logImmutableAudit(
        userId,
        'consent_withdrawn',
        'user_consent',
        consent._id,
        { before: { consentGiven: true }, after: { consentGiven: false } },
        {
          workspaceId: consent.workspaceId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          sessionId: metadata.sessionId,
          complianceFlags: consent.regulations.map(reg => ({
            standard: reg,
            requirement: `User consent withdrawal - ${consentType}`,
            status: 'compliant',
            details: `Consent withdrawn: ${reason}`
          }))
        }
      );
    }

    return results;
  }

  async getConsentHistory(userId, workspaceId = null) {
    const query = { userId };
    if (workspaceId) query.workspaceId = workspaceId;

    return UserConsent.find(query)
      .sort({ consentTimestamp: -1 })
      .lean();
  }

  async checkConsent(userId, consentType, workspaceId = null) {
    return UserConsent.hasConsent(userId, consentType, workspaceId);
  }

  async getConsentProof(consentId) {
    const consent = await UserConsent.findById(consentId).lean();
    if (!consent) throw new Error('Consent record not found');

    // Verify integrity
    const isValid = await UserConsent.findById(consentId).then(c => c.verifyIntegrity());

    return {
      consent,
      integrityVerified: isValid,
      exportedAt: new Date(),
      proofOfConsent: consent.proofOfConsent,
      auditTrail: consent.auditTrail
    };
  }

  // ========================================
  // DATA ACCESS LOGGING METHODS
  // Issue #920: Compliance & Audit Logging Framework
  // ========================================

  async logDataAccess(data) {
    // Calculate risk score
    const riskScore = this.calculateAccessRiskScore(data);
    const riskLevel = this.getRiskLevel(riskScore);
    
    // Check for anomalies
    const anomalies = await this.detectAccessAnomalies(data);

    const accessLog = await DataAccessLog.logAccess({
      ...data,
      riskAssessment: {
        riskScore,
        riskLevel,
        riskFactors: anomalies.riskFactors || [],
        anomalyDetected: anomalies.detected,
        anomalyReasons: anomalies.reasons || []
      }
    });

    // If high risk or anomaly detected, create compliance violation alert
    if (riskLevel === 'high' || riskLevel === 'critical' || anomalies.detected) {
      await this.createComplianceAlert({
        type: 'suspicious_data_access',
        severity: riskLevel,
        userId: data.userId,
        workspaceId: data.workspaceId,
        details: {
          accessLogId: accessLog._id,
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          anomalies: anomalies.reasons
        },
        metadata: data.metadata
      });
    }

    return accessLog;
  }

  calculateAccessRiskScore(data) {
    let score = 0;

    // Data classification risk
    const classificationScores = {
      public: 0,
      internal: 10,
      confidential: 30,
      restricted: 50,
      pii: 40,
      phi: 60,
      pci: 70
    };
    score += classificationScores[data.dataClassification] || 10;

    // Access type risk
    const accessTypeScores = {
      read: 5,
      write: 15,
      update: 15,
      delete: 30,
      export: 25,
      download: 20,
      bulk_access: 35,
      decrypt: 40
    };
    score += accessTypeScores[data.accessType] || 10;

    // Authorization risk
    if (!data.accessAuthorization?.authorized) {
      score += 50;
    }

    // Time-based risk (access outside business hours)
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      score += 15;
    }

    return Math.min(score, 100);
  }

  getRiskLevel(score) {
    if (score >= 70) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }

  async detectAccessAnomalies(data) {
    const anomalies = {
      detected: false,
      reasons: [],
      riskFactors: []
    };

    // Check for unusual access patterns
    const recentAccess = await DataAccessLog.find({
      userId: data.userId,
      resourceType: data.resourceType,
      createdAt: { $gte: new Date(Date.now() - 3600000) } // Last hour
    }).countDocuments();

    if (recentAccess > 50) {
      anomalies.detected = true;
      anomalies.reasons.push('Unusually high access frequency');
      anomalies.riskFactors.push('high_frequency_access');
    }

    // Check for bulk access
    if (data.accessDetails?.recordCount > 100) {
      anomalies.detected = true;
      anomalies.reasons.push('Bulk data access detected');
      anomalies.riskFactors.push('bulk_access');
    }

    // Check for unauthorized access attempts
    if (!data.accessAuthorization?.authorized) {
      anomalies.detected = true;
      anomalies.reasons.push('Unauthorized access attempt');
      anomalies.riskFactors.push('unauthorized_access');
    }

    // Check for sensitive data access
    if (['pii', 'phi', 'pci'].includes(data.dataClassification)) {
      anomalies.riskFactors.push('sensitive_data_access');
    }

    return anomalies;
  }

  async getDataAccessHistory(resourceType, resourceId, options = {}) {
    return DataAccessLog.getResourceAccessHistory(resourceType, resourceId, options);
  }

  async getUserDataAccessHistory(userId, options = {}) {
    return DataAccessLog.getUserAccessHistory(userId, options);
  }

  async getDataAccessAnalytics(filters = {}) {
    const matchStage = {};
    if (filters.workspaceId) matchStage.workspaceId = filters.workspaceId;
    if (filters.startDate || filters.endDate) {
      matchStage.createdAt = {};
      if (filters.startDate) matchStage.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) matchStage.createdAt.$lte = new Date(filters.endDate);
    }

    const [byAccessType, byResourceType, byRiskLevel, byUser] = await Promise.all([
      DataAccessLog.aggregate([
        { $match: matchStage },
        { $group: { _id: '$accessType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      DataAccessLog.aggregate([
        { $match: matchStage },
        { $group: { _id: '$resourceType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      DataAccessLog.aggregate([
        { $match: matchStage },
        { $group: { _id: '$riskAssessment.riskLevel', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      DataAccessLog.aggregate([
        { $match: matchStage },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ])
    ]);

    return {
      byAccessType,
      byResourceType,
      byRiskLevel,
      topUsers: byUser,
      generatedAt: new Date()
    };
  }

  // ========================================
  // COMPLIANCE VIOLATION ALERTS
  // Issue #920: Compliance & Audit Logging Framework
  // ========================================

  async createComplianceAlert(data) {
    const violation = await ComplianceViolation.create({
      workspaceId: data.workspaceId,
      standard: data.standard || 'INTERNAL',
      requirement: data.requirement || 'Security Policy',
      severity: data.severity || 'medium',
      status: 'open',
      detectedAt: new Date(),
      description: data.description || `${data.type}: Automated compliance alert`,
      affectedResources: [{
        resourceType: data.details?.resourceType,
        resourceId: data.details?.resourceId,
        impact: data.severity
      }],
      evidence: {
        logs: data.details?.accessLogId ? [data.details.accessLogId] : [],
        anomalies: data.details?.anomalies || [],
        metadata: data.metadata
      },
      remediation: {
        status: 'pending',
        priority: data.severity === 'critical' ? 'urgent' : 'high'
      }
    });

    // Create immutable audit log
    await this.logImmutableAudit(
      data.userId || null,
      'compliance_violation_detected',
      'compliance_violation',
      violation._id,
      {},
      {
        workspaceId: data.workspaceId,
        ipAddress: data.metadata?.ipAddress,
        riskLevel: data.severity,
        complianceFlags: [{
          standard: data.standard || 'INTERNAL',
          requirement: data.requirement || 'Security Policy',
          status: 'violation',
          details: data.description || 'Automated compliance alert'
        }]
      }
    );

    // Send notifications if critical
    if (data.severity === 'critical' || data.severity === 'high') {
      await this.sendComplianceAlert(violation);
    }

    return violation;
  }

  async sendComplianceAlert(violation) {
    // Emit Socket.IO event for real-time dashboard
    if (global.io) {
      global.io.emit('compliance:alert', {
        violationId: violation._id,
        severity: violation.severity,
        standard: violation.standard,
        description: violation.description,
        timestamp: new Date()
      });
    }

    // TODO: Add email/SMS notification integration
    console.log(`[COMPLIANCE ALERT] ${violation.severity.toUpperCase()}: ${violation.description}`);
  }

  async getComplianceAlerts(filters = {}) {
    const query = {};
    if (filters.workspaceId) query.workspaceId = filters.workspaceId;
    if (filters.severity) query.severity = filters.severity;
    if (filters.status) query.status = filters.status;
    if (filters.standard) query.standard = filters.standard;

    const limit = filters.limit || 100;

    return ComplianceViolation.find(query)
      .sort({ detectedAt: -1 })
      .limit(limit)
      .lean();
  }

  // ========================================
  // COMPLIANCE DASHBOARD & METRICS
  // Issue #920: Compliance & Audit Logging Framework
  // ========================================

  async getComplianceDashboard(workspaceId = null, dateRange = {}) {
    const startDate = dateRange.start ? new Date(dateRange.start) : new Date(Date.now() - 30 * 24 * 3600000);
    const endDate = dateRange.end ? new Date(dateRange.end) : new Date();

    const baseQuery = workspaceId ? { workspaceId } : {};
    const dateQuery = { createdAt: { $gte: startDate, $lte: endDate } };

    const [
      auditLogStats,
      dataAccessStats,
      consentStats,
      violationStats,
      complianceScore,
      recentViolations,
      highRiskAccess,
      consentWithdrawals
    ] = await Promise.all([
      // Audit log statistics
      ImmutableAuditLog.aggregate([
        { $match: { ...baseQuery, ...dateQuery } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            criticalEvents: {
              $sum: { $cond: [{ $eq: ['$riskLevel', 'critical'] }, 1, 0] }
            },
            highRiskEvents: {
              $sum: { $cond: [{ $eq: ['$riskLevel', 'high'] }, 1, 0] }
            }
          }
        }
      ]),

      // Data access statistics
      DataAccessLog.aggregate([
        { $match: { ...baseQuery, ...dateQuery } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            unauthorized: {
              $sum: { $cond: [{ $eq: ['$accessAuthorization.authorized', false] }, 1, 0] }
            },
            anomalies: {
              $sum: { $cond: ['$riskAssessment.anomalyDetected', 1, 0] }
            },
            sensitiveAccess: {
              $sum: {
                $cond: [
                  { $in: ['$dataClassification', ['pii', 'phi', 'pci']] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]),

      // Consent statistics
      UserConsent.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            totalConsents: { $sum: 1 },
            activeConsents: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$consentGiven', true] },
                      { $eq: ['$withdrawnAt', null] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            withdrawnConsents: {
              $sum: { $cond: [{ $ne: ['$withdrawnAt', null] }, 1, 0] }
            }
          }
        }
      ]),

      // Violation statistics
      ComplianceViolation.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            criticalCount: {
              $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] }
            }
          }
        }
      ]),

      // Overall compliance score
      this.calculateOverallComplianceScore(workspaceId),

      // Recent violations
      ComplianceViolation.find({ ...baseQuery, status: { $ne: 'resolved' } })
        .sort({ detectedAt: -1 })
        .limit(10)
        .lean(),

      // High-risk data access
      DataAccessLog.find({
        ...baseQuery,
        ...dateQuery,
        'riskAssessment.riskLevel': { $in: ['high', 'critical'] }
      })
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      // Recent consent withdrawals
      UserConsent.find({
        ...baseQuery,
        withdrawnAt: { $gte: startDate }
      })
        .populate('userId', 'name email')
        .sort({ withdrawnAt: -1 })
        .limit(10)
        .lean()
    ]);

    return {
      period: {
        start: startDate,
        end: endDate
      },
      complianceScore,
      auditLogs: {
        total: auditLogStats[0]?.total || 0,
        critical: auditLogStats[0]?.criticalEvents || 0,
        highRisk: auditLogStats[0]?.highRiskEvents || 0
      },
      dataAccess: {
        total: dataAccessStats[0]?.total || 0,
        unauthorized: dataAccessStats[0]?.unauthorized || 0,
        anomalies: dataAccessStats[0]?.anomalies || 0,
        sensitiveAccess: dataAccessStats[0]?.sensitiveAccess || 0
      },
      consents: {
        total: consentStats[0]?.totalConsents || 0,
        active: consentStats[0]?.activeConsents || 0,
        withdrawn: consentStats[0]?.withdrawnConsents || 0
      },
      violations: violationStats.reduce((acc, item) => {
        acc[item._id] = item.count;
        acc[`${item._id}_critical`] = item.criticalCount;
        return acc;
      }, {}),
      recentViolations,
      highRiskAccess,
      consentWithdrawals,
      generatedAt: new Date()
    };
  }

  async generateComplianceExport(format, filters = {}) {
    const [auditLogs, dataAccessLogs, consents, violations] = await Promise.all([
      ImmutableAuditLog.find(this.buildFilterQuery(filters))
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .limit(filters.limit || 10000)
        .lean(),
      DataAccessLog.find(this.buildFilterQuery(filters))
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .limit(filters.limit || 10000)
        .lean(),
      UserConsent.find(this.buildFilterQuery(filters))
        .populate('userId', 'name email')
        .sort({ consentTimestamp: -1 })
        .limit(filters.limit || 10000)
        .lean(),
      ComplianceViolation.find(this.buildFilterQuery(filters))
        .sort({ detectedAt: -1 })
        .limit(filters.limit || 10000)
        .lean()
    ]);

    if (format === 'csv') {
      return this.convertComplianceToCSV({ auditLogs, dataAccessLogs, consents, violations });
    } else if (format === 'xml') {
      return this.convertComplianceToXML({ auditLogs, dataAccessLogs, consents, violations });
    } else if (format === 'json') {
      return JSON.stringify({ auditLogs, dataAccessLogs, consents, violations }, null, 2);
    }

    throw new Error('Unsupported export format');
  }

  buildFilterQuery(filters) {
    const query = {};
    if (filters.workspaceId) query.workspaceId = filters.workspaceId;
    if (filters.userId) query.userId = filters.userId;
    if (filters.startDate || filters.endDate) {
      const createdAtField = filters.dateField || 'createdAt';
      query[createdAtField] = {};
      if (filters.startDate) query[createdAtField].$gte = new Date(filters.startDate);
      if (filters.endDate) query[createdAtField].$lte = new Date(filters.endDate);
    }
    return query;
  }

  convertComplianceToCSV(data) {
    const sections = [];

    // Audit logs section
    if (data.auditLogs?.length > 0) {
      sections.push('=== AUDIT LOGS ===');
      sections.push(this.convertToCSV(data.auditLogs));
    }

    // Data access logs section
    if (data.dataAccessLogs?.length > 0) {
      sections.push('\n=== DATA ACCESS LOGS ===');
      const csvData = data.dataAccessLogs.map(log => ({
        sequenceNumber: log.sequenceNumber,
        timestamp: log.createdAt,
        userId: log.userId?._id || log.userId,
        accessType: log.accessType,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        classification: log.dataClassification,
        riskLevel: log.riskAssessment?.riskLevel,
        status: log.status
      }));
      sections.push(this.convertToCSV(csvData));
    }

    // Consents section
    if (data.consents?.length > 0) {
      sections.push('\n=== USER CONSENTS ===');
      const csvData = data.consents.map(consent => ({
        userId: consent.userId?._id || consent.userId,
        consentType: consent.consentType,
        consentGiven: consent.consentGiven,
        consentTimestamp: consent.consentTimestamp,
        withdrawnAt: consent.withdrawnAt || '',
        regulations: consent.regulations?.join(';')
      }));
      sections.push(this.convertToCSV(csvData));
    }

    return sections.join('\n');
  }

  convertComplianceToXML(data) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<complianceExport generatedAt="${new Date().toISOString()}">
  <auditLogs count="${data.auditLogs?.length || 0}">
    ${this.convertToXML(data.auditLogs || [])}
  </auditLogs>
  <dataAccessLogs count="${data.dataAccessLogs?.length || 0}">
    ${data.dataAccessLogs?.map(log => `
    <accessLog>
      <sequenceNumber>${log.sequenceNumber}</sequenceNumber>
      <timestamp>${log.createdAt}</timestamp>
      <userId>${log.userId?._id || log.userId}</userId>
      <accessType>${log.accessType}</accessType>
      <resourceType>${log.resourceType}</resourceType>
      <resourceId>${log.resourceId}</resourceId>
      <classification>${log.dataClassification}</classification>
      <riskLevel>${log.riskAssessment?.riskLevel}</riskLevel>
      <status>${log.status}</status>
    </accessLog>`).join('') || ''}
  </dataAccessLogs>
  <userConsents count="${data.consents?.length || 0}">
    ${data.consents?.map(consent => `
    <consent>
      <userId>${consent.userId?._id || consent.userId}</userId>
      <consentType>${consent.consentType}</consentType>
      <consentGiven>${consent.consentGiven}</consentGiven>
      <timestamp>${consent.consentTimestamp}</timestamp>
      <withdrawnAt>${consent.withdrawnAt || ''}</withdrawnAt>
      <regulations>${consent.regulations?.join(',') || ''}</regulations>
    </consent>`).join('') || ''}
  </userConsents>
  <violations count="${data.violations?.length || 0}">
    ${data.violations?.map(v => `
    <violation>
      <severity>${v.severity}</severity>
      <standard>${v.standard}</standard>
      <status>${v.status}</status>
      <detectedAt>${v.detectedAt}</detectedAt>
      <description>${v.description || ''}</description>
    </violation>`).join('') || ''}
  </violations>
</complianceExport>`;
  }
}

module.exports = new AuditComplianceService();