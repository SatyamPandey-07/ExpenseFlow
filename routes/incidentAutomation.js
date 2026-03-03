const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const incidentResponseAutomationService = require('../services/incidentResponseAutomationService');
const SecurityIncident = require('../models/SecurityIncident');

const requireIncidentAdmin = (req, res, next) => {
  const allowedEmails = (process.env.INCIDENT_ADMIN_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

  if (allowedEmails.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: 'Incident admin policy not configured. Set INCIDENT_ADMIN_EMAILS.'
      });
    }
    return next();
  }

  const email = req.user?.email?.toLowerCase();
  if (!email || !allowedEmails.includes(email)) {
    return res.status(403).json({ error: 'Access denied: incident admin required' });
  }

  return next();
};

const actorContext = req => ({
  actorUserId: req.user?._id,
  clientIP: req.ip,
  reason: req.body?.reason || req.query?.reason,
  source: 'INCIDENT_AUTOMATION_API'
});

/**
 * POST /api/incident-automation/detect
 * Detect, classify severity, create incident, and auto-respond
 */
router.post('/detect', auth, requireIncidentAdmin, async (req, res) => {
  try {
    const {
      title,
      description,
      incidentType,
      confidenceScore,
      campaignMetrics,
      attackPatterns,
      evidence
    } = req.body;

    if (!incidentType) {
      return res.status(400).json({ error: 'incidentType is required' });
    }

    const result = await incidentResponseAutomationService.detectAndRespond({
      title,
      description,
      incidentType,
      confidenceScore,
      campaignMetrics,
      attackPatterns,
      evidence
    }, actorContext(req));

    res.status(201).json({
      success: true,
      message: 'Incident detected and response automation executed',
      data: {
        incident: {
          id: result.incident._id,
          incidentId: result.incident.incidentId,
          severity: result.runResult.severity,
          status: result.incident.status
        },
        runResult: result.runResult
      }
    });
  } catch (error) {
    console.error('Incident detect/respond error:', error);
    res.status(500).json({ error: 'Incident automation failed', message: error.message });
  }
});

/**
 * POST /api/incident-automation/respond/:incidentId
 * Execute automated containment/remediation for an existing incident
 */
router.post('/respond/:incidentId', auth, requireIncidentAdmin, async (req, res) => {
  try {
    const { incidentId } = req.params;

    const result = await incidentResponseAutomationService.respondToExistingIncident(
      incidentId,
      actorContext(req)
    );

    res.json({
      success: true,
      message: 'Automated response executed',
      data: {
        incidentId: result.incident.incidentId,
        runResult: result.runResult
      }
    });
  } catch (error) {
    console.error('Incident response replay error:', error);
    res.status(500).json({ error: 'Failed to execute incident response', message: error.message });
  }
});

/**
 * POST /api/incident-automation/escalate/:incidentId
 * Escalate incident to human review workflow
 */
router.post('/escalate/:incidentId', auth, requireIncidentAdmin, async (req, res) => {
  try {
    const incident = await SecurityIncident.findById(req.params.incidentId);
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const escalation = await incidentResponseAutomationService.escalateIncident(incident, {
      ...actorContext(req),
      reason: req.body.reason || 'Manual escalation request'
    });

    res.json({
      success: true,
      message: 'Incident escalated',
      data: escalation
    });
  } catch (error) {
    console.error('Incident escalation error:', error);
    res.status(500).json({ error: 'Escalation failed', message: error.message });
  }
});

/**
 * GET /api/incident-automation/timeline/:incidentId
 * Reconstruct incident timeline and execution chronology
 */
router.get('/timeline/:incidentId', auth, requireIncidentAdmin, async (req, res) => {
  try {
    const timeline = await incidentResponseAutomationService.reconstructTimeline(req.params.incidentId);

    res.json({
      success: true,
      data: timeline
    });
  } catch (error) {
    console.error('Timeline reconstruction error:', error);
    res.status(500).json({ error: 'Timeline reconstruction failed', message: error.message });
  }
});

/**
 * GET /api/incident-automation/root-cause/:incidentId
 * Generate root cause analysis for incident
 */
router.get('/root-cause/:incidentId', auth, requireIncidentAdmin, async (req, res) => {
  try {
    const incident = await SecurityIncident.findById(req.params.incidentId).lean();
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const analysis = incidentResponseAutomationService.generateRootCauseAnalysis(incident);

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('Root cause analysis error:', error);
    res.status(500).json({ error: 'Root cause analysis failed', message: error.message });
  }
});

/**
 * POST /api/incident-automation/lessons-learned/:incidentId
 * Save post-incident analysis and lessons learned
 */
router.post('/lessons-learned/:incidentId', auth, requireIncidentAdmin, async (req, res) => {
  try {
    const { lessons, recommendations = [] } = req.body;

    if (!lessons) {
      return res.status(400).json({ error: 'lessons is required' });
    }

    const data = await incidentResponseAutomationService.addLessonsLearned(
      req.params.incidentId,
      req.user._id,
      lessons,
      recommendations
    );

    res.json({
      success: true,
      message: 'Post-incident lessons saved',
      data
    });
  } catch (error) {
    console.error('Lessons learned save error:', error);
    res.status(500).json({ error: 'Failed to save lessons learned', message: error.message });
  }
});

/**
 * GET /api/incident-automation/metrics
 * Incident KPIs and response metrics
 */
router.get('/metrics', auth, requireIncidentAdmin, async (req, res) => {
  try {
    const windowDays = Number(req.query.windowDays || 30);
    const metrics = await incidentResponseAutomationService.getIncidentKpis(windowDays);

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('Incident KPI fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch incident metrics', message: error.message });
  }
});

/**
 * GET /api/incident-automation/command-center
 * Real-time command center dashboard snapshot
 */
router.get('/command-center', auth, requireIncidentAdmin, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const dashboard = await incidentResponseAutomationService.getCommandCenterDashboard(limit);

    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    console.error('Command center fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch command center dashboard', message: error.message });
  }
});

module.exports = router;
