/**
 * Device Attestation API Routes
 * Endpoints for device attestation, trust scoring, and integrity verification
 */

const express = require('express');
const router = express.Router();
const deviceAttestationService = require('../services/deviceAttestationService');
const deviceTrustIntegrationService = require('../services/deviceTrustIntegrationService');
const DeviceAttestation = require('../models/DeviceAttestation');
const DeviceBindingHistory = require('../models/DeviceBindingHistory');
const AttestationCache = require('../models/AttestationCache');

// Middleware to extract device info
const extractDeviceInfo = (req, res, next) => {
  req.deviceInfo = {
    deviceId: req.headers['x-device-id'] || req.body.deviceId,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip || req.connection.remoteAddress,
    platform: req.headers['x-platform'] || req.body.platform
  };
  next();
};

/**
 * POST /api/device-attestation/attest
 * Perform device attestation
 */
router.post('/attest', extractDeviceInfo, async (req, res) => {
  try {
    const { provider, attestationData } = req.body;
    const { deviceId } = req.deviceInfo;
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Device ID required'
      });
    }

    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'Attestation provider required'
      });
    }

    console.log(`[API] Device attestation request: Provider=${provider}, Device=${deviceId}`);

    // Perform attestation
    const result = await deviceAttestationService.attestDevice({
      userId,
      deviceId,
      provider,
      attestationData,
      sessionId: req.sessionId,
      metadata: {
        ipAddress: req.deviceInfo.ipAddress,
        userAgent: req.deviceInfo.userAgent,
        requestId: req.id
      }
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      attestation: {
        id: result.attestation._id,
        status: result.status,
        trustScore: result.trustScore,
        provider: result.attestation.provider,
        validUntil: result.attestation.validUntil,
        riskFactors: result.riskFactors
      },
      cached: result.cached
    });

  } catch (error) {
    console.error('[API] Attestation error:', error);
    res.status(500).json({
      success: false,
      error: 'Attestation failed',
      message: error.message
    });
  }
});

/**
 * GET /api/device-attestation/verify/:deviceId
 * Verify existing device attestation
 */
router.get('/verify/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { provider } = req.query;
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const result = await deviceAttestationService.verifyDeviceAttestation(
      userId,
      deviceId,
      provider
    );

    res.json(result);

  } catch (error) {
    console.error('[API] Verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Verification failed',
      message: error.message
    });
  }
});

/**
 * GET /api/device-attestation/trust-score/:deviceId
 * Get device trust score
 */
router.get('/trust-score/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const trustScore = await deviceAttestationService.getDeviceTrustScore(userId, deviceId);

    res.json({
      success: true,
      ...trustScore
    });

  } catch (error) {
    console.error('[API] Trust score error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get trust score',
      message: error.message
    });
  }
});

/**
 * GET /api/device-attestation/trust-component/:deviceId
 * Get complete device trust component with all factors
 */
router.get('/trust-component/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user?.id || req.userId;
    const sessionId = req.sessionId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const trustComponent = await deviceTrustIntegrationService.calculateDeviceTrustComponent(
      userId,
      deviceId,
      sessionId
    );

    res.json({
      success: true,
      ...trustComponent
    });

  } catch (error) {
    console.error('[API] Trust component error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate trust component',
      message: error.message
    });
  }
});

/**
 * POST /api/device-attestation/revoke/:deviceId
 * Revoke device attestation
 */
router.post('/revoke/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { reason } = req.body;
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const result = await deviceAttestationService.revokeDeviceAttestation(
      userId,
      deviceId,
      reason || 'USER_REVOKED'
    );

    res.json(result);

  } catch (error) {
    console.error('[API] Revocation error:', error);
    res.status(500).json({
      success: false,
      error: 'Revocation failed',
      message: error.message
    });
  }
});

/**
 * GET /api/device-attestation/history/:deviceId
 * Get device binding history
 */
router.get('/history/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 50 } = req.query;
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const history = await DeviceBindingHistory.getDeviceTimeline(
      userId,
      deviceId,
      parseInt(limit)
    );

    res.json({
      success: true,
      history,
      count: history.length
    });

  } catch (error) {
    console.error('[API] History error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get history',
      message: error.message
    });
  }
});

/**
 * GET /api/device-attestation/anomalies/:deviceId
 * Detect binding anomalies
 */
router.get('/anomalies/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const anomalies = await DeviceBindingHistory.detectAnomalies(userId, deviceId);

    res.json({
      success: true,
      ...anomalies
    });

  } catch (error) {
    console.error('[API] Anomaly detection error:', error);
    res.status(500).json({
      success: false,
      error: 'Anomaly detection failed',
      message: error.message
    });
  }
});

/**
 * GET /api/device-attestation/devices
 * Get all attested devices for user
 */
router.get('/devices', async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const attestations = await DeviceAttestation.find({
      userId,
      status: 'VALID',
      validUntil: { $gt: new Date() }
    })
    .sort({ createdAt: -1 })
    .select('deviceId provider status trustScore validUntil createdAt securityChecks')
    .lean();

    // Group by device
    const devicesMap = {};
    attestations.forEach(att => {
      if (!devicesMap[att.deviceId]) {
        devicesMap[att.deviceId] = {
          deviceId: att.deviceId,
          attestations: [],
          highestTrustScore: 0,
          latestAttestation: null
        };
      }

      devicesMap[att.deviceId].attestations.push(att);
      if (att.trustScore > devicesMap[att.deviceId].highestTrustScore) {
        devicesMap[att.deviceId].highestTrustScore = att.trustScore;
        devicesMap[att.deviceId].latestAttestation = att;
      }
    });

    const devices = Object.values(devicesMap);

    res.json({
      success: true,
      devices,
      count: devices.length
    });

  } catch (error) {
    console.error('[API] Device list error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get devices',
      message: error.message
    });
  }
});

/**
 * GET /api/device-attestation/cache-stats
 * Get cache statistics
 */
router.get('/cache-stats', async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const { timeRange = 24 } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const stats = await AttestationCache.getStatistics(userId, parseInt(timeRange));

    res.json({
      success: true,
      stats,
      timeRange: parseInt(timeRange)
    });

  } catch (error) {
    console.error('[API] Cache stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cache statistics',
      message: error.message
    });
  }
});

/**
 * POST /api/device-attestation/integrity-check
 * Perform immediate integrity check
 */
router.post('/integrity-check', extractDeviceInfo, async (req, res) => {
  try {
    const { deviceId } = req.deviceInfo;
    const userId = req.user?.id || req.userId;
    const sessionId = req.sessionId;

    if (!userId || !deviceId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Device ID required'
      });
    }

    // Get latest attestation
    const attestation = await DeviceAttestation.getLatestValid(userId, deviceId);

    if (!attestation) {
      return res.json({
        success: false,
        integrityStatus: 'NO_ATTESTATION',
        requiresAttestation: true
      });
    }

    // Check for integrity failures
    const failures = [];
    if (attestation.securityChecks) {
      const checks = attestation.securityChecks;
      
      if (checks.isRooted || checks.isJailbroken) {
        failures.push({
          type: 'DEVICE_COMPROMISED',
          severity: 'CRITICAL',
          description: 'Device is rooted or jailbroken'
        });
      }

      if (checks.isEmulator) {
        failures.push({
          type: 'EMULATOR_DETECTED',
          severity: 'HIGH',
          description: 'Running in emulator'
        });
      }

      if (checks.hasMalware) {
        failures.push({
          type: 'MALWARE_DETECTED',
          severity: 'CRITICAL',
          description: 'Malware detected'
        });
      }
    }

    // If failures detected, handle them
    if (failures.length > 0) {
      const action = await deviceTrustIntegrationService.handleIntegrityFailure(
        userId,
        deviceId,
        sessionId,
        failures[0]
      );

      return res.json({
        success: false,
        integrityStatus: 'FAILED',
        failures,
        action
      });
    }

    res.json({
      success: true,
      integrityStatus: 'PASS',
      attestation: {
        id: attestation._id,
        trustScore: attestation.trustScore,
        provider: attestation.provider,
        validUntil: attestation.validUntil
      }
    });

  } catch (error) {
    console.error('[API] Integrity check error:', error);
    res.status(500).json({
      success: false,
      error: 'Integrity check failed',
      message: error.message
    });
  }
});

module.exports = router;
