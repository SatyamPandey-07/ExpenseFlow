const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const path = require('path');
const fs = require('fs');

/**
 * Audit Routes
 * Enterprise-grade security audit trail and forensics
 * Issue #469
 */

/**
 * GET /api/audit/logs
 * Get audit logs with filtering
 */
router.get('/logs', auth, async (req, res) => {
  try {
    const {
      resource,
      action,
      startDate,
      endDate,
      severity,
      flagged,
      reviewed,
      page,
      limit,
      sortBy,
      sortOrder
    } = req.query;

    const filters = {
      userId: req.user.id,
      resource,
      action,
      startDate,
      endDate,
      severity,
      flagged: flagged === 'true' ? true : flagged === 'false' ? false : undefined,
      reviewed: reviewed === 'true' ? true : reviewed === 'false' ? false : undefined
    };

    const options = {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      sortBy: sortBy || 'createdAt',
      sortOrder: sortOrder || 'desc'
    };

    const result = await auditService.getLogs(filters, options);

    res.json({
      success: true,
      data: result.logs,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit logs'
    });
  }
});

/**
 * GET /api/audit/resource/:resource/:resourceId
 * Get audit trail for a specific resource
 */
router.get('/resource/:resource/:resourceId', auth, async (req, res) => {
  try {
    const { resource, resourceId } = req.params;
    const { limit } = req.query;

    const trail = await auditService.getResourceTrail(
      resource,
      resourceId,
      parseInt(limit) || 50
    );

    res.json({
      success: true,
      data: trail
    });
  } catch (error) {
    console.error('Get resource trail error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve resource audit trail'
    });
  }
});

/**
 * GET /api/audit/suspicious
 * Detect suspicious activity for current user
 */
router.get('/suspicious', auth, async (req, res) => {
  try {
    const { timeWindow } = req.query;

    const suspicious = await auditService.detectSuspiciousActivity(
      req.user.id,
      parseInt(timeWindow) || 5
    );

    res.json({
      success: true,
      data: suspicious
    });
  } catch (error) {
    console.error('Detect suspicious activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to detect suspicious activity'
    });
  }
});

/**
 * POST /api/audit/flag/:logId
 * Flag an audit log for review
 */
router.post('/flag/:logId', auth, async (req, res) => {
  try {
    const { logId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required'
      });
    }

    const log = await auditService.flagLog(logId, reason);

    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error('Flag audit log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to flag audit log'
    });
  }
});

/**
 * POST /api/audit/review/:logId
 * Review a flagged audit log
 */
router.post('/review/:logId', auth, async (req, res) => {
  try {
    const { logId } = req.params;
    const { notes } = req.body;

    const log = await auditService.reviewLog(logId, req.user.id, notes);

    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error('Review audit log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to review audit log'
    });
  }
});

/**
 * GET /api/audit/verify-chain
 * Verify audit chain integrity
 */
router.get('/verify-chain', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const result = await auditService.verifyChainIntegrity(req.user.id, start, end);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Verify chain integrity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify chain integrity'
    });
  }
});

/**
 * GET /api/audit/statistics
 * Get audit statistics
 */
router.get('/statistics', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const stats = await auditService.getStatistics(req.user.id, start, end);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get audit statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit statistics'
    });
  }
});

/**
 * POST /api/audit/export/pdf
 * Export audit logs to protected PDF
 */
router.post('/export/pdf', auth, async (req, res) => {
  try {
    const {
      resource,
      action,
      startDate,
      endDate,
      severity,
      flagged
    } = req.body;

    const filters = {
      userId: req.user.id,
      resource,
      action,
      startDate,
      endDate,
      severity,
      flagged
    };

    // Generate filename
    const filename = `audit-trail-${req.user.id}-${Date.now()}.pdf`;
    const outputPath = path.join(__dirname, '../temp', filename);

    // Ensure temp directory exists
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Generate PDF
    await auditService.exportToPDF(filters, outputPath);

    // Send file
    res.download(outputPath, filename, (err) => {
      if (err) {
        console.error('PDF download error:', err);
      }

      // Delete temp file after download
      fs.unlink(outputPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Error deleting temp file:', unlinkErr);
        }
      });
    });
  } catch (error) {
    console.error('Export PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export audit logs to PDF'
    });
  }
});

/**
 * GET /api/audit/search
 * Search audit logs
 */
router.get('/search', auth, async (req, res) => {
  try {
    const { q, page, limit, sortBy, sortOrder } = req.query;

    const filters = {
      userId: req.user.id
    };

    const options = {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      sortBy: sortBy || 'createdAt',
      sortOrder: sortOrder || 'desc'
    };

    const result = await auditService.searchLogs(q, filters, options);

    res.json({
      success: true,
      data: result.logs,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Search audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search audit logs'
    });
  }
});

/**
 * GET /api/audit/recent
 * Get recent audit activity
 */
router.get('/recent', auth, async (req, res) => {
  try {
    const { limit } = req.query;

    const activity = await auditService.getRecentActivity(
      req.user.id,
      parseInt(limit) || 20
    );

    res.json({
      success: true,
      data: activity
    });
  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve recent activity'
    });
  }
});

/**
 * GET /api/audit/flagged
 * Get flagged activities
 */
router.get('/flagged', auth, async (req, res) => {
  try {
    const { page, limit } = req.query;

    const filters = {
      userId: req.user.id
    };

    const options = {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50
    };

    const result = await auditService.getFlaggedActivities(filters, options);

    res.json({
      success: true,
      data: result.logs,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Get flagged activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve flagged activities'
    });
  });

// ===== NEW: Advanced Forensic & Replay Endpoints (Issue #209) =====

const AuditSnapshot = require('../models/AuditSnapshot');
const StateDelta = require('../models/StateDelta');
const replayEngine = require('../services/replayEngine');
const forensicAI = require('../services/forensicAI');

/**
 * GET /api/audit/snapshots
 * Get all snapshots for user
 */
router.get('/snapshots', auth, async (req, res) => {
  try {
    const { type, limit = 10 } = req.query;

    const query = { user: req.user.id };
    if (type) query.snapshotType = type;

    const snapshots = await AuditSnapshot.find(query)
      .sort({ snapshotDate: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, data: snapshots });
  } catch (error) {
    console.error('Get snapshots error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve snapshots' });
  }
});

/**
 * POST /api/audit/snapshots
 * Create on-demand snapshot
 */
router.post('/snapshots', auth, async (req, res) => {
  try {
    const startTime = Date.now();

    const currentState = await replayEngine.replayToDate(
      req.user.id,
      new Date(),
      { includeTransactions: false, includeMetadata: false }
    );

    const snapshot = await AuditSnapshot.createSnapshot(
      req.user.id,
      currentState.state,
      'on-demand'
    );

    snapshot.metadata.generationDuration = Date.now() - startTime;
    await snapshot.save();

    res.status(201).json({ success: true, data: snapshot });
  } catch (error) {
    console.error('Create snapshot error:', error);
    res.status(500).json({ success: false, message: 'Failed to create snapshot' });
  }
});

/**
 * GET /api/audit/deltas
 * Get state deltas for a time period
 */
router.get('/deltas', auth, async (req, res) => {
  try {
    const { startDate, endDate, entityType, operation, limit = 50 } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
    }

    const query = {
      user: req.user.id,
      timestamp: { $gte: new Date(startDate), $lte: new Date(endDate) }
    };

    if (entityType) query.entityType = entityType;
    if (operation) query.operation = operation;

    const deltas = await StateDelta.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, data: deltas });
  } catch (error) {
    console.error('Get deltas error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve deltas' });
  }
});

/**
 * POST /api/audit/replay
 * Replay state to a specific point in time (Time Machine)
 */
router.post('/replay', auth, async (req, res) => {
  try {
    const { targetDate, includeTransactions = true } = req.body;

    if (!targetDate) {
      return res.status(400).json({ success: false, message: 'targetDate is required' });
    }

    const result = await replayEngine.replayToDate(
      req.user.id,
      new Date(targetDate),
      { includeTransactions }
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Replay error:', error);
    res.status(500).json({ success: false, message: 'Failed to replay state' });
  }
});

/**
 * POST /api/audit/compare
 * Compare states between two dates
 */
router.post('/compare', auth, async (req, res) => {
  try {
    const { date1, date2 } = req.body;

    if (!date1 || !date2) {
      return res.status(400).json({ success: false, message: 'Both date1 and date2 are required' });
    }

    const comparison = await replayEngine.compareStates(
      req.user.id,
      new Date(date1),
      new Date(date2)
    );

    res.json({ success: true, data: comparison });
  } catch (error) {
    console.error('Compare error:', error);
    res.status(500).json({ success: false, message: 'Failed to compare states' });
  }
});

/**
 * GET /api/audit/evolution
 * Get state evolution over time
 */
router.get('/evolution', auth, async (req, res) => {
  try {
    const { startDate, endDate, interval = 'daily' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
    }

    const evolution = await replayEngine.getStateEvolution(
      req.user.id,
      new Date(startDate),
      new Date(endDate),
      interval
    );

    res.json({ success: true, data: evolution });
  } catch (error) {
    console.error('Evolution error:', error);
    res.status(500).json({ success: false, message: 'Failed to get state evolution' });
  }
});

/**
 * POST /api/audit/forensic/trace-balance
 * Forensic analysis: Trace how a balance was reached
 */
router.post('/forensic/trace-balance', auth, async (req, res) => {
  try {
    const { targetDate, targetBalance } = req.body;

    if (!targetDate) {
      return res.status(400).json({ success: false, message: 'targetDate is required' });
    }

    const analysis = await forensicAI.traceBalanceOrigin(
      req.user.id,
      new Date(targetDate),
      targetBalance
    );

    res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('Trace balance error:', error);
    res.status(500).json({ success: false, message: 'Failed to trace balance' });
  }
});

/**
 * POST /api/audit/forensic/detect-anomalies
 * Detect anomalies in transaction patterns
 */
router.post('/forensic/detect-anomalies', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
    }

    const anomalies = await forensicAI.detectAnomalies(
      req.user.id,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ success: true, data: anomalies });
  } catch (error) {
    console.error('Detect anomalies error:', error);
    res.status(500).json({ success: false, message: 'Failed to detect anomalies' });
  }
});

/**
 * POST /api/audit/forensic/narrative
 * Generate natural language narrative of transactions
 */
router.post('/forensic/narrative', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
    }

    const narrative = await forensicAI.generateTransactionNarrative(
      req.user.id,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ success: true, data: { narrative } });
  } catch (error) {
    console.error('Generate narrative error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate narrative' });
  }
});

module.exports = router;
