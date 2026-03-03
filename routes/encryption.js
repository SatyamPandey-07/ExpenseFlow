const express = require('express');
const router = express.Router();
const kms = require('../services/keyManagementService');
const encryptionService = require('../services/encryptionService');
const auth = require('../middleware/auth');
const { checkRole } = require('../middleware/rbac');
const { 
  encryptRequestFields, 
  decryptResponseFields,
  maskSensitiveFields,
  requireEncryption,
  getEncryptionStatus
} = require('../middleware/fieldEncryption');
const {
  markEncryptedEndpoint,
  transportSecuritySuite
} = require('../middleware/transportSecurity');

/**
 * Encryption Management Routes
 * Issue #827: End-to-End Encryption for Sensitive Data
 * 
 * Provides APIs for:
 * - Encryption/decryption operations
 * - Key management
 * - Encryption status and health
 * - Compliance reporting
 * - Key rotation
 * 
 * All routes require authentication and appropriate permissions
 */

// Apply transport security to all routes
router.use(transportSecuritySuite({ enforceHTTPS: true, enforceHSTS: true }));

const getKmsActor = (req, operation) => ({
  userId: req.user?._id,
  role: req.userRole || 'authenticated-user',
  serviceAccount: null,
  ipAddress: req.ip,
  reason: req.body?.reason || req.query?.reason,
  operation,
  auditUserId: req.user?._id,
  apiEndpoint: req.originalUrl,
  requestId: req.headers['x-request-id']
});

const requireKeyAdmin = (req, res, next) => {
  const allowedEmails = (process.env.ENCRYPTION_KEY_ADMIN_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

  const userEmail = req.user?.email?.toLowerCase();

  if (allowedEmails.length > 0) {
    if (!userEmail || !allowedEmails.includes(userEmail)) {
      return res.status(403).json({ error: 'Access denied: key administrator privileges required' });
    }
    return next();
  }

  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Key administration policy not configured. Set ENCRYPTION_KEY_ADMIN_EMAILS.'
    });
  }

  return next();
};

// ============================================================================
// Data Encryption/Decryption APIs
// ============================================================================

/**
 * POST /api/encryption/encrypt
 * Encrypt data with specified purpose
 */
router.post('/encrypt',
  auth,
  markEncryptedEndpoint({ purpose: 'userData' }),
  async (req, res) => {
    try {
      const { data, purpose = 'userData', returnObject = false } = req.body;

      if (!data) {
        return res.status(400).json({ error: 'Data is required' });
      }

      const encrypted = await encryptionService.encrypt(data, purpose, {
        returnObject,
        actor: getKmsActor(req, 'encrypt'),
        tenantId: req.body.tenantId,
        userId: req.body.userId
      });

      res.json({
        success: true,
        encrypted,
        purpose,
        summary: returnObject ? encryptionService.getEncryptionSummary(encrypted) : null
      });
    } catch (error) {
      console.error('Encryption API error:', error);
      res.status(500).json({ error: 'Encryption failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/decrypt
 * Decrypt encrypted data
 */
router.post('/decrypt',
  auth,
  markEncryptedEndpoint({ purpose: 'userData' }),
  async (req, res) => {
    try {
      const { encryptedData } = req.body;

      if (!encryptedData) {
        return res.status(400).json({ error: 'Encrypted data is required' });
      }

      const decrypted = await encryptionService.decrypt(encryptedData, {
        actor: getKmsActor(req, 'decrypt')
      });

      res.json({
        success: true,
        data: decrypted
      });
    } catch (error) {
      console.error('Decryption API error:', error);
      res.status(500).json({ error: 'Decryption failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/decrypt-migrate
 * Decrypt data and re-encrypt with latest active key if stale
 */
router.post('/decrypt-migrate',
  auth,
  markEncryptedEndpoint({ purpose: 'userData' }),
  async (req, res) => {
    try {
      const { encryptedData, purpose = 'userData', tenantId = null, userId = null } = req.body;

      if (!encryptedData) {
        return res.status(400).json({ error: 'Encrypted data is required' });
      }

      const result = await encryptionService.decryptAndReEncryptIfNeeded(encryptedData, purpose, {
        tenantId,
        userId,
        actor: getKmsActor(req, 'decrypt')
      });

      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('Decrypt migrate API error:', error);
      res.status(500).json({ error: 'Decrypt/migrate failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/encrypt-fields
 * Encrypt specific fields in an object
 */
router.post('/encrypt-fields',
  auth,
  async (req, res) => {
    try {
      const { data, fields, purpose = 'userData' } = req.body;

      if (!data || !fields || !Array.isArray(fields)) {
        return res.status(400).json({ error: 'Data and fields array are required' });
      }

      const encrypted = await encryptionService.encryptFields(data, fields, purpose, {
        actor: getKmsActor(req, 'encrypt')
      });

      res.json({
        success: true,
        data: encrypted,
        encryptedFields: fields
      });
    } catch (error) {
      console.error('Field encryption API error:', error);
      res.status(500).json({ error: 'Field encryption failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/decrypt-fields
 * Decrypt specific fields in an object
 */
router.post('/decrypt-fields',
  auth,
  async (req, res) => {
    try {
      const { data, fields } = req.body;

      if (!data || !fields || !Array.isArray(fields)) {
        return res.status(400).json({ error: 'Data and fields array are required' });
      }

      const decrypted = await encryptionService.decryptFields(data, fields);

      res.json({
        success: true,
        data: decrypted
      });
    } catch (error) {
      console.error('Field decryption API error:', error);
      res.status(500).json({ error: 'Field decryption failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/encrypt-file
 * Encrypt file data
 */
router.post('/encrypt-file',
  auth,
  async (req, res) => {
    try {
      const { fileData, purpose = 'documents', metadata = {} } = req.body;

      if (!fileData) {
        return res.status(400).json({ error: 'File data is required' });
      }

      // Convert base64 to buffer if needed
      const fileBuffer = Buffer.isBuffer(fileData) 
        ? fileData 
        : Buffer.from(fileData, 'base64');

      const encrypted = await encryptionService.encryptFile(fileBuffer, purpose, {
        ...metadata,
        actor: getKmsActor(req, 'encrypt')
      });

      res.json({
        success: true,
        encrypted,
        metadata: encrypted.metadata
      });
    } catch (error) {
      console.error('File encryption API error:', error);
      res.status(500).json({ error: 'File encryption failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/decrypt-file
 * Decrypt file data
 */
router.post('/decrypt-file',
  auth,
  async (req, res) => {
    try {
      const { encryptedFile } = req.body;

      if (!encryptedFile) {
        return res.status(400).json({ error: 'Encrypted file data is required' });
      }

      const decrypted = await encryptionService.decryptFile(encryptedFile);

      res.json({
        success: true,
        data: decrypted.toString('base64'),
        size: decrypted.length
      });
    } catch (error) {
      console.error('File decryption API error:', error);
      res.status(500).json({ error: 'File decryption failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/mask
 * Mask sensitive data for display
 */
router.post('/mask',
  auth,
  async (req, res) => {
    try {
      const { data, type = 'default' } = req.body;

      if (!data) {
        return res.status(400).json({ error: 'Data is required' });
      }

      const masked = encryptionService.mask(data, type);

      res.json({
        success: true,
        masked,
        type
      });
    } catch (error) {
      console.error('Masking API error:', error);
      res.status(500).json({ error: 'Masking failed', message: error.message });
    }
  }
);

// ============================================================================
// Key Management APIs (Admin Only)
// ============================================================================

/**
 * POST /api/encryption/keys/generate
 * Generate a new encryption key
 */
router.post('/keys/generate',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { purpose, keyType = 'data', tenantId = null, userId = null, algorithm, rotationPeriodDays } = req.body;

      if (!purpose) {
        return res.status(400).json({ error: 'Purpose is required' });
      }

      const key = await kms.generateDataEncryptionKey(purpose, keyType, {
        tenantId,
        userId,
        algorithm,
        rotationPeriodDays,
        actor: getKmsActor(req, 'generate')
      });

      res.json({
        success: true,
        keyId: key.keyId,
        version: key.version,
        purpose,
        message: 'Encryption key generated successfully'
      });
    } catch (error) {
      console.error('Key generation API error:', error);
      res.status(500).json({ error: 'Key generation failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/keys/rotate
 * Rotate an encryption key
 */
router.post('/keys/rotate',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { purpose, tenantId = null, userId = null } = req.body;

      if (!purpose) {
        return res.status(400).json({ error: 'Purpose is required' });
      }

      const result = await kms.rotateKey(purpose, {
        tenantId,
        userId,
        actor: getKmsActor(req, 'rotate')
      });

      res.json({
        success: true,
        ...result,
        message: 'Key rotated successfully'
      });
    } catch (error) {
      console.error('Key rotation API error:', error);
      res.status(500).json({ error: 'Key rotation failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/keys/revoke
 * Revoke an encryption key (emergency)
 */
router.post('/keys/revoke',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { keyId, reason } = req.body;

      if (!keyId || !reason) {
        return res.status(400).json({ error: 'Key ID and reason are required' });
      }

      const result = await kms.revokeKey(keyId, reason, {
        actor: getKmsActor(req, 'revoke')
      });

      res.json({
        success: true,
        ...result,
        message: 'Key revoked successfully'
      });
    } catch (error) {
      console.error('Key revocation API error:', error);
      res.status(500).json({ error: 'Key revocation failed', message: error.message });
    }
  }
);

/**
 * GET /api/encryption/keys
 * List encryption keys
 */
router.get('/keys',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { purpose, status } = req.query;
      
      const filter = {};
      if (purpose) filter.purpose = purpose;
      if (status) filter.status = status;

      const keys = await kms.listKeys(filter);

      res.json({
        success: true,
        count: keys.length,
        keys
      });
    } catch (error) {
      console.error('Key list API error:', error);
      res.status(500).json({ error: 'Failed to list keys', message: error.message });
    }
  }
);

/**
 * GET /api/encryption/keys/:keyId
 * Get key details
 */
router.get('/keys/:keyId',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { keyId } = req.params;

      const key = await kms.getKeyById(keyId, null, {
        actor: getKmsActor(req, 'read'),
        operation: 'read'
      });

      res.json({
        success: true,
        keyId: key.keyId,
        version: key.version,
        message: 'Key retrieved successfully'
      });
    } catch (error) {
      console.error('Key retrieval API error:', error);
      res.status(404).json({ error: 'Key not found', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/keys/backup
 * Export key backup (encrypted)
 */
router.post('/keys/backup',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { password } = req.body;

      if (!password || password.length < 16) {
        return res.status(400).json({ 
          error: 'Strong password (16+ characters) is required for backup' 
        });
      }

      const backup = await kms.exportKeyBackup(password, {
        actor: getKmsActor(req, 'backup')
      });

      res.json({
        success: true,
        backup,
        message: 'Key backup created successfully. Store securely!'
      });
    } catch (error) {
      console.error('Key backup API error:', error);
      res.status(500).json({ error: 'Backup creation failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/keys/restore
 * Import key backup
 */
router.post('/keys/restore',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { backup, password } = req.body;

      if (!backup || !password) {
        return res.status(400).json({ error: 'Backup data and password are required' });
      }

      const restore = await kms.importKeyBackup(backup, password, {
        actor: getKmsActor(req, 'backup')
      });

      res.json({
        success: true,
        restore,
        message: 'Keys restored successfully from backup'
      });
    } catch (error) {
      console.error('Key restore API error:', error);
      res.status(500).json({ error: 'Restore failed', message: error.message });
    }
  }
);

// ============================================================================
// Health & Status APIs
// ============================================================================

/**
 * GET /api/encryption/health
 * Get encryption system health metrics
 */
router.get('/health',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const health = await kms.getKeyHealthMetrics();

      res.json({
        success: true,
        health,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Health check API error:', error);
      res.status(500).json({ error: 'Health check failed', message: error.message });
    }
  }
);

/**
 * GET /api/encryption/status
 * Get encryption status summary
 */
router.get('/status',
  auth,
  async (req, res) => {
    try {
      const status = {
        encryptionEnabled: true,
        algorithms: kms.getAlgorithmStatus().supportedAlgorithms,
        activeAlgorithm: kms.getAlgorithmStatus().activeAlgorithm,
        keyManagement: 'active',
        transportSecurity: {
          https: process.env.NODE_ENV === 'production',
          hsts: true,
          tlsVersion: 'TLS 1.2+'
        },
        compliance: {
          pciDss: true,
          gdpr: true,
          nist: true,
          iso27001: true
        },
        features: {
          fieldLevelEncryption: true,
          fileEncryption: true,
          keyRotation: true,
          keyVersioning: true,
          authenticatedEncryption: true
        }
      };

      res.json({
        success: true,
        status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Status API error:', error);
      res.status(500).json({ error: 'Status check failed', message: error.message });
    }
  }
);

/**
 * GET /api/encryption/compliance
 * Get compliance attestation
 */
router.get('/compliance',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const attestation = encryptionService.getComplianceAttestation();

      res.json({
        success: true,
        attestation,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Compliance API error:', error);
      res.status(500).json({ error: 'Compliance check failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/validate
 * Validate encrypted data integrity
 */
router.post('/validate',
  auth,
  async (req, res) => {
    try {
      const { encryptedData } = req.body;

      if (!encryptedData) {
        return res.status(400).json({ error: 'Encrypted data is required' });
      }

      const isEncrypted = encryptionService.isEncrypted(encryptedData);
      
      let summary = null;
      if (isEncrypted) {
        try {
          summary = encryptionService.getEncryptionSummary(encryptedData);
        } catch (error) {
          return res.json({
            success: true,
            isEncrypted: false,
            valid: false,
            error: 'Invalid encryption format'
          });
        }
      }

      res.json({
        success: true,
        isEncrypted,
        valid: isEncrypted,
        summary
      });
    } catch (error) {
      console.error('Validation API error:', error);
      res.status(500).json({ error: 'Validation failed', message: error.message });
    }
  }
);

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * POST /api/encryption/batch/encrypt
 * Batch encrypt multiple items
 */
router.post('/batch/encrypt',
  auth,
  async (req, res) => {
    try {
      const { items, purpose = 'userData' } = req.body;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Items array is required' });
      }

      const results = await encryptionService.batchEncrypt(items, purpose);

      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;

      res.json({
        success: true,
        total: results.length,
        successful,
        failed,
        results
      });
    } catch (error) {
      console.error('Batch encrypt API error:', error);
      res.status(500).json({ error: 'Batch encryption failed', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/batch/decrypt
 * Batch decrypt multiple items
 */
router.post('/batch/decrypt',
  auth,
  async (req, res) => {
    try {
      const { items } = req.body;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Items array is required' });
      }

      const results = await encryptionService.batchDecrypt(items);

      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;

      res.json({
        success: true,
        total: results.length,
        successful,
        failed,
        results
      });
    } catch (error) {
      console.error('Batch decrypt API error:', error);
      res.status(500).json({ error: 'Batch decryption failed', message: error.message });
    }
  }
);

// ============================================================================
// Utilities
// ============================================================================

/**
 * GET /api/encryption/supported-purposes
 * Get list of supported encryption purposes
 */
router.get('/supported-purposes',
  auth,
  async (req, res) => {
    try {
      const purposes = {
        userData: {
          description: 'User personal information and PII',
          fields: encryptionService.getSensitiveFieldsForPurpose('userData')
        },
        financialData: {
          description: 'Financial and payment card data',
          fields: encryptionService.getSensitiveFieldsForPurpose('financialData')
        },
        healthData: {
          description: 'Health and medical information (HIPAA)',
          fields: encryptionService.getSensitiveFieldsForPurpose('healthData')
        },
        documents: {
          description: 'File and document encryption',
          fields: encryptionService.getSensitiveFieldsForPurpose('documents')
        }
      };

      res.json({
        success: true,
        purposes
      });
    } catch (error) {
      console.error('Purposes API error:', error);
      res.status(500).json({ error: 'Failed to get purposes', message: error.message });
    }
  }
);

/**
 * GET /api/encryption/keys/algorithms
 * Get active and supported key algorithms
 */
router.get('/keys/algorithms',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      res.json({
        success: true,
        algorithms: kms.getAlgorithmStatus()
      });
    } catch (error) {
      console.error('Algorithm status API error:', error);
      res.status(500).json({ error: 'Failed to fetch algorithm status', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/keys/algorithms/active
 * Set active algorithm for newly generated keys
 */
router.post('/keys/algorithms/active',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { algorithm } = req.body;

      if (!algorithm) {
        return res.status(400).json({ error: 'Algorithm is required' });
      }

      const result = await kms.setActiveAlgorithm(algorithm, {
        actor: getKmsActor(req, 'rotate')
      });

      res.json({
        success: true,
        ...result,
        message: 'Active algorithm updated'
      });
    } catch (error) {
      console.error('Set algorithm API error:', error);
      res.status(400).json({ error: 'Failed to set algorithm', message: error.message });
    }
  }
);

/**
 * POST /api/encryption/keys/derive
 * Derive hierarchical scoped key (tenant/user)
 */
router.post('/keys/derive',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { purpose, tenantId = null, userId = null, context = 'default' } = req.body;

      if (!purpose) {
        return res.status(400).json({ error: 'Purpose is required' });
      }

      const derived = await kms.deriveScopedKey({
        purpose,
        tenantId,
        userId,
        context,
        actor: getKmsActor(req, 'derive')
      });

      res.json({
        success: true,
        keyId: derived.keyId,
        parentKeyId: derived.parentKeyId,
        version: derived.version,
        context,
        message: 'Scoped key derived successfully'
      });
    } catch (error) {
      console.error('Derive key API error:', error);
      res.status(500).json({ error: 'Key derivation failed', message: error.message });
    }
  }
);

/**
 * GET /api/encryption/keys/audit-trail
 * Retrieve key access and lifecycle audit events
 */
router.get('/keys/audit-trail',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const { keyId, purpose, eventType, limit = 100 } = req.query;

      const events = await kms.listAuditTrail({ keyId, purpose, eventType }, Number(limit));

      res.json({
        success: true,
        count: events.length,
        events
      });
    } catch (error) {
      console.error('Key audit trail API error:', error);
      res.status(500).json({ error: 'Failed to fetch key audit trail', message: error.message });
    }
  }
);

/**
 * GET /api/encryption/keys/strength
 * Verify current encryption strength posture
 */
router.get('/keys/strength',
  auth,
  checkRole(['admin']),
  requireKeyAdmin,
  async (req, res) => {
    try {
      const verification = kms.verifyEncryptionStrength();

      res.json({
        success: true,
        verification
      });
    } catch (error) {
      console.error('Encryption strength API error:', error);
      res.status(500).json({ error: 'Failed to verify encryption strength', message: error.message });
    }
  }
);

module.exports = router;
