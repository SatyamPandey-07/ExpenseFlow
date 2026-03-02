/**
 * Credential Compromise API Routes
 * Endpoints for breach checking and credential security
 */

const express = require('express');
const router = express.Router();
const credentialCompromiseService = require('../services/credentialCompromiseService');
const compromiseCorrelationService = require('../services/compromiseCorrelationService');
const attackPatternDetectionService = require('../services/attackPatternDetectionService');

/**
 * POST /api/credential-compromise/check
 * Check if a credential is compromised
 * Body: { identifier, identifierType, userId (optional), providers (optional) }
 */
router.post('/check', async (req, res) => {
  try {
    const { identifier, identifierType = 'EMAIL', userId, providers } = req.body;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        error: 'Identifier is required'
      });
    }

    const result = await credentialCompromiseService.checkCompromise(
      identifier,
      identifierType,
      { userId, providers }
    );

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/credential-compromise/check-password
 * Check if a password hash appears in breaches
 * Body: { password }
 */
router.post('/check-password', async (req, res) => {
  try {
    const { password, providers } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required'
      });
    }

    const result = await credentialCompromiseService.checkPasswordHash(
      password,
      { providers }
    );

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Check password error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/credential-compromise/user/:userId
 * Get all compromises for a user
 * Query: status, minRiskScore, limit
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, minRiskScore, limit } = req.query;

    const result = await credentialCompromiseService.getUserCompromises(
      userId,
      {
        status,
        minRiskScore: minRiskScore ? parseInt(minRiskScore) : 0,
        limit: limit ? parseInt(limit) : 50
      }
    );

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Get user compromises error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/credential-compromise/:compromiseId/notify
 * Mark user as notified about compromise
 * Body: { userId }
 */
router.post('/:compromiseId/notify', async (req, res) => {
  try {
    const { compromiseId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    const result = await credentialCompromiseService.markUserNotified(
      compromiseId,
      userId
    );

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Mark notified error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/credential-compromise/:compromiseId/action
 * Record user action on compromise
 * Body: { userId, action, context }
 */
router.post('/:compromiseId/action', async (req, res) => {
  try {
    const { compromiseId } = req.params;
    const { userId, action, context } = req.body;

    if (!userId || !action) {
      return res.status(400).json({
        success: false,
        error: 'User ID and action are required'
      });
    }

    const result = await credentialCompromiseService.recordUserAction(
      compromiseId,
      userId,
      action,
      context
    );

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Record action error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/credential-compromise/:compromiseId/resolve
 * Resolve a compromise
 * Body: { resolvedBy, resolution }
 */
router.post('/:compromiseId/resolve', async (req, res) => {
  try {
    const { compromiseId } = req.params;
    const { resolvedBy, resolution } = req.body;

    if (!resolvedBy || !resolution) {
      return res.status(400).json({
        success: false,
        error: 'Resolved by and resolution are required'
      });
    }

    const result = await credentialCompromiseService.resolveCompromise(
      compromiseId,
      resolvedBy,
      resolution
    );

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Resolve error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/credential-compromise/correlate-login
 * Correlate login attempt with known compromises
 * Body: { userId, email, success, sourceIP, userAgent, timestamp, geoLocation }
 */
router.post('/correlate-login', async (req, res) => {
  try {
    const attempt = req.body;

    if (!attempt.email || !attempt.sourceIP) {
      return res.status(400).json({
        success: false,
        error: 'Email and source IP are required'
      });
    }

    const result = await compromiseCorrelationService.correlateLoginAttempt(attempt);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Correlate login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/credential-compromise/detect-lateral-movement
 * Detect lateral movement patterns
 * Body: { userId, sourceIP, userAgent, timestamp, privilegeLevel }
 */
router.post('/detect-lateral-movement', async (req, res) => {
  try {
    const sessionData = req.body;

    if (!sessionData.userId || !sessionData.sourceIP) {
      return res.status(400).json({
        success: false,
        error: 'User ID and source IP are required'
      });
    }

    const result = await compromiseCorrelationService.detectLateralMovement(sessionData);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Detect lateral movement error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/credential-compromise/process-login
 * Process login attempt for attack pattern detection
 * Body: { email, success, sourceIP, userAgent, timestamp, geoLocation }
 */
router.post('/process-login', async (req, res) => {
  try {
    const attempt = req.body;

    if (!attempt.email || !attempt.sourceIP) {
      return res.status(400).json({
        success: false,
        error: 'Email and source IP are required'
      });
    }

    const result = await attackPatternDetectionService.processLoginAttempt(attempt);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Process login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/credential-compromise/attack-stats
 * Get attack pattern statistics
 * Query: timeWindow (milliseconds)
 */
router.get('/attack-stats', async (req, res) => {
  try {
    const { timeWindow } = req.query;

    const result = await attackPatternDetectionService.getAttackStatistics(
      timeWindow ? parseInt(timeWindow) : 86400000
    );

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Get attack stats error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/credential-compromise/batch-correlate
 * Batch correlate multiple login attempts
 * Body: { attempts: [] }
 */
router.post('/batch-correlate', async (req, res) => {
  try {
    const { attempts } = req.body;

    if (!attempts || !Array.isArray(attempts) || attempts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Attempts array is required'
      });
    }

    const result = await compromiseCorrelationService.batchCorrelate(attempts);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[CredentialCompromise] Batch correlate error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/credential-compromise/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'Credential Compromise Detection',
    status: 'operational',
    timestamp: new Date()
  });
});

module.exports = router;
