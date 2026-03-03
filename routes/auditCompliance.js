const express = require('express');
const { body, query, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const ImmutableAuditLog = require('../models/ImmutableAuditLog');
const ComplianceViolation = require('../models/ComplianceViolation');
const UserConsent = require('../models/UserConsent');
const DataAccessLog = require('../models/DataAccessLog');
const Workspace = require('../models/Workspace');
const auditComplianceService = require('../services/auditComplianceService');

const router = express.Router();

const getUserId = (req) => req.user?._id || req.user?.id;

const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'compliance_officer') {
    return res.status(403).json({
      success: false,
      message: 'Admin or compliance officer access required'
    });
  }
  next();
};

const ensureWorkspaceAccess = async (req, workspaceId) => {
  if (!workspaceId) return;
  const userId = getUserId(req);
  const hasAccess = await Workspace.exists({
    _id: workspaceId,
    $or: [{ owner: userId }, { 'members.user': userId }]
  });
  if (!hasAccess) {
    const err = new Error('Workspace access denied');
    err.status = 403;
    throw err;
  }
};

const buildDateRange = (start, end) => {
  if (!start && !end) return undefined;
  const range = {};
  if (start) range.$gte = new Date(start);
  if (end) range.$lte = new Date(end);
  return range;
};

router.get('/audit-logs', auth, adminAuth, [
  query('workspaceId').optional().isMongoId(),
  query('userId').optional().isMongoId(),
  query('action').optional().isString(),
  query('entityType').optional().isString(),
  query('requestId').optional().isString(),
  query('correlationId').optional().isString(),
  query('sessionId').optional().isString(),
  query('riskLevel').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    await ensureWorkspaceAccess(req, req.query.workspaceId);

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 100);
    const skip = (page - 1) * limit;

    const q = {};
    if (req.query.workspaceId) q.workspaceId = req.query.workspaceId;
    if (req.query.userId) q.userId = req.query.userId;
    if (req.query.action) q.action = req.query.action;
    if (req.query.entityType) q.entityType = req.query.entityType;
    if (req.query.riskLevel) q.riskLevel = req.query.riskLevel;
    if (req.query.requestId) q['metadata.requestId'] = req.query.requestId;
    if (req.query.correlationId) q['metadata.correlationId'] = req.query.correlationId;
    if (req.query.sessionId) q['metadata.sessionId'] = req.query.sessionId;

    const createdAt = buildDateRange(req.query.startDate, req.query.endDate);
    if (createdAt) q.createdAt = createdAt;

    const [logs, total] = await Promise.all([
      ImmutableAuditLog.find(q)
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ImmutableAuditLog.countDocuments(q)
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to fetch audit logs' });
  }
});

router.post('/audit-logs/verify-integrity', auth, adminAuth, [
  body('workspaceId').optional().isMongoId(),
  body('startSequence').optional().isInt({ min: 1 }),
  body('endSequence').optional().isInt({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    await ensureWorkspaceAccess(req, req.body.workspaceId);
    const data = await auditComplianceService.verifyAuditIntegrity(
      req.body.startSequence ?? null,
      req.body.endSequence ?? null,
      req.body.workspaceId ?? null
    );

    res.json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/forensics/timeline', auth, adminAuth, [
  query('workspaceId').optional().isMongoId(),
  query('userId').optional().isMongoId(),
  query('entityType').optional().isString(),
  query('entityId').optional().isString(),
  query('requestId').optional().isString(),
  query('correlationId').optional().isString(),
  query('sessionId').optional().isString(),
  query('action').optional().isString(),
  query('riskLevel').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 5000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.query.workspaceId);

    const data = await auditComplianceService.reconstructTimeline({
      workspaceId: req.query.workspaceId,
      userId: req.query.userId,
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      requestId: req.query.requestId,
      correlationId: req.query.correlationId,
      sessionId: req.query.sessionId,
      action: req.query.action,
      riskLevel: req.query.riskLevel,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/forensics/anomaly-correlation', auth, adminAuth, [
  query('workspaceId').optional().isMongoId(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.query.workspaceId);

    const data = await auditComplianceService.correlateAnomalies({
      workspaceId: req.query.workspaceId,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/compliance/violations', auth, adminAuth, [
  query('workspaceId').optional().isMongoId(),
  query('standard').optional().isIn(['SOX', 'GDPR', 'PCI_DSS', 'HIPAA', 'SOC2', 'ISO27001', 'CCPA', 'PIPEDA']),
  query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('status').optional().isIn(['open', 'investigating', 'remediation_in_progress', 'resolved', 'false_positive', 'accepted_risk']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.query.workspaceId);

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    const skip = (page - 1) * limit;

    const q = {};
    if (req.query.workspaceId) q.workspaceId = req.query.workspaceId;
    if (req.query.standard) q.standard = req.query.standard;
    if (req.query.severity) q.severity = req.query.severity;
    if (req.query.status) q.status = req.query.status;

    const [violations, total] = await Promise.all([
      ComplianceViolation.find(q)
        .populate('remediation.assignedTo', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ComplianceViolation.countDocuments(q)
    ]);

    res.json({
      success: true,
      data: {
        violations,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.put('/compliance/violations/:violationId', auth, adminAuth, [
  body('status').isIn(['open', 'investigating', 'remediation_in_progress', 'resolved', 'false_positive', 'accepted_risk']),
  body('assignedTo').optional().isMongoId(),
  body('resolutionNotes').optional().isString().trim().isLength({ max: 1000 }),
  body('dueDate').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const updateData = { status: req.body.status };
    if (req.body.assignedTo) updateData['remediation.assignedTo'] = req.body.assignedTo;
    if (req.body.dueDate) updateData['remediation.dueDate'] = new Date(req.body.dueDate);
    if (req.body.status === 'resolved') {
      updateData.resolvedAt = new Date();
      updateData.resolutionNotes = req.body.resolutionNotes;
    }

    const violation = await ComplianceViolation.findOneAndUpdate(
      { violationId: req.params.violationId },
      {
        ...updateData,
        $push: {
          auditTrail: {
            action: `Status changed to ${req.body.status}`,
            performedBy: getUserId(req),
            timestamp: new Date(),
            details: {
              assignedTo: req.body.assignedTo,
              dueDate: req.body.dueDate
            }
          }
        }
      },
      { new: true }
    );

    if (!violation) return res.status(404).json({ success: false, message: 'Compliance violation not found' });

    await auditComplianceService.logImmutableAudit(
      getUserId(req),
      'compliance_violation_updated',
      'compliance_violation',
      violation._id,
      { after: updateData },
      {
        workspaceId: violation.workspaceId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.sessionId,
        apiEndpoint: req.originalUrl,
        requestId: req.headers['x-request-id'],
        riskLevel: violation.severity === 'critical' ? 'high' : 'medium',
        complianceFlags: [{ standard: violation.standard, status: 'review_required' }]
      }
    );

    res.json({ success: true, data: violation });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/compliance/reports', auth, adminAuth, [
  body('standard').isIn(['SOX', 'GDPR', 'PCI_DSS', 'HIPAA', 'SOC2', 'ISO27001', 'CCPA', 'PIPEDA']),
  body('workspaceId').optional().isMongoId(),
  body('dateRange.start').optional().isISO8601(),
  body('dateRange.end').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.body.workspaceId);

    const report = await auditComplianceService.generateComplianceReport(
      req.body.standard,
      req.body.workspaceId || null,
      req.body.dateRange || {}
    );

    await auditComplianceService.logImmutableAudit(
      getUserId(req),
      'compliance_report_generated',
      'report',
      null,
      { after: { standard: req.body.standard, workspaceId: req.body.workspaceId || null } },
      {
        workspaceId: req.body.workspaceId || null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.sessionId,
        apiEndpoint: req.originalUrl,
        requestId: req.headers['x-request-id']
      }
    );

    res.json({ success: true, data: report });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/legal-hold/apply', auth, adminAuth, [
  body('entityType').isString().notEmpty(),
  body('entityId').isString().notEmpty(),
  body('reason').notEmpty().isString().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    await auditComplianceService.applyLegalHold(req.body.entityType, req.body.entityId, req.body.reason, getUserId(req));
    res.json({ success: true, message: 'Legal hold applied successfully' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/legal-hold/release', auth, adminAuth, [
  body('entityType').isString().notEmpty(),
  body('entityId').isString().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    await auditComplianceService.releaseLegalHold(req.body.entityType, req.body.entityId, getUserId(req));
    res.json({ success: true, message: 'Legal hold released successfully' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/compliance/dashboard', auth, adminAuth, [query('workspaceId').optional().isMongoId()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.query.workspaceId);

    const workspaceQuery = req.query.workspaceId ? { workspaceId: req.query.workspaceId } : {};
    const [
      totalAuditLogs,
      openViolations,
      criticalViolations,
      recentActivity,
      complianceByStandard,
      complianceScore
    ] = await Promise.all([
      ImmutableAuditLog.countDocuments(workspaceQuery),
      ComplianceViolation.countDocuments({ ...workspaceQuery, status: 'open' }),
      ComplianceViolation.countDocuments({ ...workspaceQuery, severity: 'critical' }),
      ImmutableAuditLog.find(workspaceQuery).sort({ createdAt: -1 }).limit(10).populate('userId', 'name').lean(),
      ComplianceViolation.aggregate([
        { $match: workspaceQuery },
        { $group: { _id: '$standard', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      auditComplianceService.calculateOverallComplianceScore(req.query.workspaceId || null)
    ]);

    res.json({
      success: true,
      data: {
        summary: { totalAuditLogs, openViolations, criticalViolations, complianceScore },
        recentActivity,
        complianceByStandard,
        generatedAt: new Date()
      }
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/audit-logs/export', auth, adminAuth, [
  body('workspaceId').optional().isMongoId(),
  body('format').isIn(['json', 'csv', 'xml']),
  body('filters').optional().isObject(),
  body('dateRange.start').optional().isISO8601(),
  body('dateRange.end').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.body.workspaceId);

    const { format, filters = {}, dateRange = {}, workspaceId } = req.body;
    const q = { ...filters };
    if (workspaceId) q.workspaceId = workspaceId;
    const createdAt = buildDateRange(dateRange.start, dateRange.end);
    if (createdAt) q.createdAt = createdAt;

    const logs = await ImmutableAuditLog.find(q)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(10000)
      .lean();

    await auditComplianceService.logImmutableAudit(
      getUserId(req),
      'audit_exported',
      'audit_log',
      null,
      { after: { format, recordCount: logs.length, filters } },
      {
        workspaceId: workspaceId || null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.sessionId,
        apiEndpoint: req.originalUrl,
        requestId: req.headers['x-request-id'],
        riskLevel: 'medium'
      }
    );

    let exportData = '';
    let contentType = 'application/json';
    let filename = `audit-logs-${Date.now()}.json`;

    if (format === 'json') {
      exportData = JSON.stringify(logs, null, 2);
      contentType = 'application/json';
      filename = `audit-logs-${Date.now()}.json`;
    } else if (format === 'csv') {
      exportData = auditComplianceService.convertToCSV(logs);
      contentType = 'text/csv';
      filename = `audit-logs-${Date.now()}.csv`;
    } else {
      exportData = auditComplianceService.convertToXML(logs);
      contentType = 'application/xml';
      filename = `audit-logs-${Date.now()}.xml`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportData);
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// ========================================
// USER CONSENT TRACKING ROUTES
// Issue #920: Compliance & Audit Logging Framework
// ========================================

router.post('/consent/record', auth, [
  body('consentType').isIn([
    'terms_of_service', 'privacy_policy', 'data_processing', 
    'marketing_communications', 'analytics_tracking', 'cookie_usage',
    'data_sharing', 'third_party_integrations', 'biometric_data',
    'health_data', 'financial_data_processing', 'cross_border_data_transfer',
    'automated_decision_making', 'profiling'
  ]),
  body('consentGiven').isBoolean(),
  body('consentVersion').isString().notEmpty(),
  body('consentMethod').isIn(['explicit', 'implicit', 'opt_in', 'opt_out', 'granular']),
  body('workspaceId').optional().isMongoId(),
  body('legalBasis').optional().isIn(['consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interest']),
  body('regulations').optional().isArray(),
  body('proofOfConsent').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    
    const userId = getUserId(req);
    const consent = await auditComplianceService.recordConsent({
      userId,
      workspaceId: req.body.workspaceId,
      consentType: req.body.consentType,
      consentGiven: req.body.consentGiven,
      consentVersion: req.body.consentVersion,
      consentMethod: req.body.consentMethod,
      legalBasis: req.body.legalBasis,
      expiresAt: req.body.expiresAt,
      regulations: req.body.regulations || [],
      proofOfConsent: req.body.proofOfConsent,
      metadata: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.sessionId,
        geolocation: req.body.geolocation
      }
    });

    res.json({ success: true, data: consent });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/consent/withdraw', auth, [
  body('consentType').isString().notEmpty(),
  body('reason').isString().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const userId = getUserId(req);
    const results = await auditComplianceService.withdrawConsent(
      userId,
      req.body.consentType,
      req.body.reason,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.sessionId
      }
    );

    res.json({ success: true, data: { withdrawnCount: results.length, consents: results } });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/consent/history', auth, [
  query('workspaceId').optional().isMongoId()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const userId = getUserId(req);
    const history = await auditComplianceService.getConsentHistory(userId, req.query.workspaceId);

    res.json({ success: true, data: history });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/consent/check/:consentType', auth, [
  query('workspaceId').optional().isMongoId()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const userId = getUserId(req);
    const hasConsent = await auditComplianceService.checkConsent(
      userId,
      req.params.consentType,
      req.query.workspaceId
    );

    res.json({ success: true, data: { hasConsent } });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/consent/proof/:consentId', auth, adminAuth, async (req, res) => {
  try {
    const proof = await auditComplianceService.getConsentProof(req.params.consentId);
    res.json({ success: true, data: proof });
  } catch (error) {
    res.status(error.status || 404).json({ success: false, message: error.message });
  }
});

// ========================================
// DATA ACCESS LOGGING ROUTES
// Issue #920: Compliance & Audit Logging Framework
// ========================================

router.post('/data-access/log', auth, [
  body('accessType').isIn(['read', 'write', 'update', 'delete', 'export', 'download', 'print', 'share', 'decrypt', 'search', 'bulk_access', 'api_access']),
  body('resourceType').isIn(['expense', 'budget', 'user_profile', 'workspace', 'report', 'invoice', 'receipt', 'bank_connection', 'api_key', 'encryption_key', 'audit_log', 'personal_data', 'financial_data', 'health_data', 'sensitive_document']),
  body('resourceId').notEmpty(),
  body('dataClassification').optional().isIn(['public', 'internal', 'confidential', 'restricted', 'pii', 'phi', 'pci']),
  body('accessReason').optional().isIn(['routine_operation', 'user_request', 'support_ticket', 'compliance_audit', 'security_investigation', 'legal_requirement', 'data_subject_request', 'administrative_task', 'automated_process'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const userId = getUserId(req);
    const accessLog = await auditComplianceService.logDataAccess({
      userId,
      workspaceId: req.body.workspaceId,
      accessType: req.body.accessType,
      resourceType: req.body.resourceType,
      resourceId: req.body.resourceId,
      resourceOwner: req.body.resourceOwner,
      dataClassification: req.body.dataClassification || 'internal',
      accessReason: req.body.accessReason || 'routine_operation',
      accessAuthorization: req.body.accessAuthorization || { authorized: true, method: 'role_based' },
      accessDetails: req.body.accessDetails || {},
      metadata: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.sessionId,
        requestId: req.headers['x-request-id'],
        apiEndpoint: req.originalUrl,
        httpMethod: req.method
      },
      complianceRelevance: req.body.complianceRelevance || {},
      status: req.body.status || 'success'
    });

    res.json({ success: true, data: accessLog });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/data-access/resource/:resourceType/:resourceId', auth, adminAuth, async (req, res) => {
  try {
    const history = await auditComplianceService.getDataAccessHistory(
      req.params.resourceType,
      req.params.resourceId,
      { limit: Number(req.query.limit) || 100 }
    );

    res.json({ success: true, data: history });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/data-access/user/:userId', auth, adminAuth, [
  query('resourceType').optional().isString(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const history = await auditComplianceService.getUserDataAccessHistory(req.params.userId, {
      resourceType: req.query.resourceType,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: Number(req.query.limit) || 100
    });

    res.json({ success: true, data: history });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/data-access/analytics', auth, adminAuth, [
  query('workspaceId').optional().isMongoId(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.query.workspaceId);

    const analytics = await auditComplianceService.getDataAccessAnalytics({
      workspaceId: req.query.workspaceId,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });

    res.json({ success: true, data: analytics });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// ========================================
// COMPLIANCE ALERTS ROUTES
// Issue #920: Compliance & Audit Logging Framework
// ========================================

router.get('/compliance/alerts', auth, adminAuth, [
  query('workspaceId').optional().isMongoId(),
  query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('status').optional().isIn(['open', 'investigating', 'remediation_in_progress', 'resolved', 'false_positive', 'accepted_risk']),
  query('standard').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.query.workspaceId);

    const alerts = await auditComplianceService.getComplianceAlerts({
      workspaceId: req.query.workspaceId,
      severity: req.query.severity,
      status: req.query.status,
      standard: req.query.standard,
      limit: Number(req.query.limit) || 100
    });

    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// ========================================
// ENHANCED COMPLIANCE DASHBOARD
// Issue #920: Compliance & Audit Logging Framework
// ========================================

router.get('/compliance/dashboard-enhanced', auth, adminAuth, [
  query('workspaceId').optional().isMongoId(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.query.workspaceId);

    const dashboard = await auditComplianceService.getComplianceDashboard(
      req.query.workspaceId,
      {
        start: req.query.startDate,
        end: req.query.endDate
      }
    );

    res.json({ success: true, data: dashboard });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

// ========================================
// COMPREHENSIVE COMPLIANCE EXPORT
// Issue #920: Compliance & Audit Logging Framework
// ========================================

router.post('/compliance/export', auth, adminAuth, [
  body('format').isIn(['json', 'csv', 'xml']),
  body('workspaceId').optional().isMongoId(),
  body('userId').optional().isMongoId(),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  body('limit').optional().isInt({ min: 1, max: 50000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureWorkspaceAccess(req, req.body.workspaceId);

    const exportData = await auditComplianceService.generateComplianceExport(
      req.body.format,
      {
        workspaceId: req.body.workspaceId,
        userId: req.body.userId,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        limit: req.body.limit || 10000
      }
    );

    // Log the export
    await auditComplianceService.logImmutableAudit(
      getUserId(req),
      'compliance_data_exported',
      'compliance_export',
      null,
      {},
      {
        workspaceId: req.body.workspaceId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.sessionId,
        apiEndpoint: req.originalUrl,
        riskLevel: 'medium',
        complianceFlags: [{
          standard: 'INTERNAL',
          requirement: 'Data export audit',
          status: 'compliant',
          details: `Exported compliance data in ${req.body.format} format`
        }]
      }
    );

    const contentTypes = {
      json: 'application/json',
      csv: 'text/csv',
      xml: 'application/xml'
    };

    res.setHeader('Content-Type', contentTypes[req.body.format]);
    res.setHeader('Content-Disposition', `attachment; filename="compliance-export-${Date.now()}.${req.body.format}"`);
    res.send(exportData);
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

module.exports = router;