/**
 * Device Attestation Service
 * Orchestrates device attestation across multiple providers
 */

const DeviceAttestation = require('../models/DeviceAttestation');
const AttestationCache = require('../models/AttestationCache');
const DeviceBindingHistory = require('../models/DeviceBindingHistory');

// Import attestation providers
const TPMAttestationProvider = require('./attestation-providers/TPMAttestationProvider');
const SafetyNetProvider = require('./attestation-providers/SafetyNetProvider');
const DeviceCheckProvider = require('./attestation-providers/DeviceCheckProvider');
const WebAuthNProvider = require('./attestation-providers/WebAuthNProvider');
const FallbackProvider = require('./attestation-providers/FallbackProvider');

class DeviceAttestationService {
  constructor() {
    // Initialize providers
    this.providers = {
      TPM: new TPMAttestationProvider(),
      SAFETYNET: new SafetyNetProvider(),
      DEVICECHECK: new DeviceCheckProvider(),
      WEBAUTHENTICATION: new WebAuthNProvider(),
      FALLBACK: new FallbackProvider()
    };

    // Cache configuration
    this.cacheConfig = {
      TPM: { ttl: 3600, enabled: true }, // 1 hour
      SAFETYNET: { ttl: 1800, enabled: true }, // 30 minutes
      DEVICECHECK: { ttl: 3600, enabled: true }, // 1 hour
      WEBAUTHENTICATION: { ttl: 7200, enabled: true }, // 2 hours
      FALLBACK: { ttl: 900, enabled: true } // 15 minutes
    };
  }

  /**
   * Perform device attestation
   * @param {Object} params - Attestation parameters
   * @returns {Object} Attestation result
   */
  async attestDevice(params) {
    const {
      userId,
      deviceId,
      provider,
      attestationData,
      sessionId,
      metadata = {}
    } = params;

    try {
      // Check cache first
      if (this.cacheConfig[provider]?.enabled) {
        const cached = await this._checkCache(userId, deviceId, provider);
        if (cached) {
          console.log(`[DeviceAttestation] Cache hit for ${provider}`);
          return {
            success: true,
            cached: true,
            attestation: cached
          };
        }
      }

      // Generate challenge nonce
      const challenge = this._generateChallenge();

      // Select appropriate provider
      const attestationProvider = this.providers[provider] || this.providers.FALLBACK;

      // Perform attestation
      console.log(`[DeviceAttestation] Performing ${provider} attestation for device ${deviceId}`);
      const result = await attestationProvider.verify({
        ...attestationData,
        challenge,
        deviceId,
        userId
      });

      // Calculate trust score
      const trustScore = this._calculateTrustScore(result, provider);

      // Determine status
      const status = this._determineStatus(result, trustScore);

      // Set validity period
      const validFrom = new Date();
      const validUntil = new Date(Date.now() + (this.cacheConfig[provider]?.ttl || 3600) * 1000);

      // Create attestation record
      const attestation = await DeviceAttestation.create({
        userId,
        deviceId,
        provider,
        status,
        trustScore,
        attestationData: result.data,
        securityChecks: result.securityChecks,
        browserIntegrity: result.browserIntegrity,
        binding: result.binding,
        location: metadata.location,
        riskFactors: result.riskFactors,
        validFrom,
        validUntil,
        challenge,
        sessionId,
        metadata: {
          ipAddress: metadata.ipAddress,
          requestId: metadata.requestId,
          apiVersion: '1.0',
          sdkVersion: result.sdkVersion
        }
      });

      // Cache the result
      if (this.cacheConfig[provider]?.enabled) {
        await this._cacheResult(userId, deviceId, provider, attestation);
      }

      // Record binding history
      await this._recordBindingHistory(userId, deviceId, attestation, result);

      console.log(`[DeviceAttestation] Attestation complete: ${status}, Trust Score: ${trustScore}`);

      return {
        success: true,
        cached: false,
        attestation,
        trustScore,
        status,
        riskFactors: result.riskFactors
      };

    } catch (error) {
      console.error('[DeviceAttestation] Attestation failed:', error);

      // Create failed attestation record
      await DeviceAttestation.create({
        userId,
        deviceId,
        provider,
        status: 'FAILED',
        trustScore: 0,
        failureReason: error.message,
        failureDetails: { stack: error.stack },
        validFrom: new Date(),
        validUntil: new Date(),
        sessionId,
        metadata
      });

      return {
        success: false,
        error: error.message,
        trustScore: 0,
        fallbackRequired: true
      };
    }
  }

  /**
   * Verify device attestation (check existing attestation)
   */
  async verifyDeviceAttestation(userId, deviceId, provider = null) {
    try {
      let attestation;

      if (provider) {
        // Check specific provider
        attestation = await DeviceAttestation.getLatestValid(userId, deviceId);
        if (attestation && attestation.provider !== provider) {
          attestation = null;
        }
      } else {
        // Get any valid attestation
        attestation = await DeviceAttestation.getLatestValid(userId, deviceId);
      }

      if (!attestation) {
        return {
          valid: false,
          reason: 'NO_VALID_ATTESTATION',
          requiresAttestation: true
        };
      }

      // Check if renewal needed
      if (attestation.needsRenewal()) {
        return {
          valid: true,
          attestation,
          renewalRequired: true,
          expiresAt: attestation.validUntil
        };
      }

      return {
        valid: true,
        attestation,
        trustScore: attestation.trustScore,
        expiresAt: attestation.validUntil
      };

    } catch (error) {
      console.error('[DeviceAttestation] Verification failed:', error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Revoke device attestation
   */
  async revokeDeviceAttestation(userId, deviceId, reason = 'MANUAL_REVOCATION') {
    try {
      // Revoke all attestations
      await DeviceAttestation.revokeDevice(userId, deviceId, reason);

      // Invalidate cache
      await AttestationCache.invalidateDevice(userId, deviceId, reason);

      // Record in history
      await DeviceBindingHistory.create({
        userId,
        deviceId,
        eventType: 'BINDING_REVOKED',
        riskAssessment: {
          level: 'HIGH',
          recommendation: 'Device attestation revoked'
        },
        actionTaken: 'REVOKE'
      });

      console.log(`[DeviceAttestation] Revoked attestation for device ${deviceId}`);

      return { success: true };
    } catch (error) {
      console.error('[DeviceAttestation] Revocation failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get device trust score
   */
  async getDeviceTrustScore(userId, deviceId) {
    try {
      // Get latest attestation
      const attestation = await DeviceAttestation.getLatestValid(userId, deviceId);
      
      if (!attestation) {
        return {
          trustScore: 0,
          level: 'NONE',
          reason: 'NO_ATTESTATION'
        };
      }

      // Get binding stability score
      const stabilityScore = await DeviceBindingHistory.calculateStabilityScore(userId, deviceId);

      // Get anomaly data
      const anomalies = await DeviceBindingHistory.detectAnomalies(userId, deviceId);

      // Calculate composite trust score
      const compositeTrustScore = this._calculateCompositeTrustScore(
        attestation.trustScore,
        stabilityScore,
        anomalies
      );

      return {
        trustScore: compositeTrustScore,
        attestationScore: attestation.trustScore,
        stabilityScore,
        anomalies: anomalies.hasAnomalies,
        level: this._getTrustLevel(compositeTrustScore),
        expiresAt: attestation.validUntil,
        provider: attestation.provider
      };

    } catch (error) {
      console.error('[DeviceAttestation] Error getting trust score:', error);
      return {
        trustScore: 0,
        level: 'ERROR',
        error: error.message
      };
    }
  }

  /**
   * Check cache for existing attestation
   */
  async _checkCache(userId, deviceId, provider) {
    try {
      const cacheKey = `${userId}_${deviceId}_${provider}`;
      const cached = await AttestationCache.findOne({
        cacheKey,
        invalidated: false,
        expiresAt: { $gt: new Date() }
      }).populate('attestationId');

      if (cached && cached.isValid) {
        await cached.recordHit();
        return cached.attestationId;
      }

      return null;
    } catch (error) {
      console.error('[DeviceAttestation] Cache check failed:', error);
      return null;
    }
  }

  /**
   * Cache attestation result
   */
  async _cacheResult(userId, deviceId, provider, attestation) {
    try {
      const ttl = this.cacheConfig[provider]?.ttl || 3600;
      
      await AttestationCache.getOrCreate(
        userId,
        deviceId,
        provider,
        {
          attestationId: attestation._id,
          trustScore: attestation.trustScore,
          status: attestation.status,
          securityChecks: attestation.securityChecks
        },
        ttl
      );
    } catch (error) {
      console.error('[DeviceAttestation] Cache creation failed:', error);
    }
  }

  /**
   * Record binding history
   */
  async _recordBindingHistory(userId, deviceId, attestation, result) {
    try {
      // Get previous binding
      const previousBindings = await DeviceBindingHistory.find({ userId, deviceId })
        .sort({ createdAt: -1 })
        .limit(1);

      const previousBinding = previousBindings.length > 0 ? previousBindings[0].currentBinding : null;

      // Detect changes
      const changes = this._detectBindingChanges(previousBinding, result.binding);

      // Determine event type
      let eventType = 'BINDING_VERIFIED';
      if (!previousBinding) {
        eventType = 'FIRST_SEEN';
      } else if (changes.suspicious.length > 0) {
        eventType = 'SUSPICIOUS_CHANGE';
      } else if (changes.all.length > 0) {
        eventType = 'BINDING_CHANGED';
      }

      // Calculate risk
      const riskAssessment = this._assessBindingRisk(changes, attestation);

      // Create history record
      await DeviceBindingHistory.create({
        userId,
        deviceId,
        eventType,
        previousBinding,
        currentBinding: result.binding,
        changes: changes.all,
        trustImpact: {
          previousScore: previousBinding ? 50 : 0,
          newScore: attestation.trustScore,
          scoreDelta: attestation.trustScore - (previousBinding ? 50 : 0),
          reason: `Attestation via ${attestation.provider}`
        },
        detectionContext: {
          attestationId: attestation._id,
          sessionId: attestation.sessionId,
          ipAddress: attestation.metadata?.ipAddress,
          location: attestation.location
        },
        riskAssessment,
        actionTaken: riskAssessment.level === 'CRITICAL' ? 'BLOCK' : 'NONE'
      });

    } catch (error) {
      console.error('[DeviceAttestation] Binding history recording failed:', error);
    }
  }

  /**
   * Generate challenge nonce
   */
  _generateChallenge() {
    const crypto = require('crypto');
    return {
      nonce: crypto.randomBytes(32).toString('base64'),
      timestamp: new Date(),
      method: 'RANDOM'
    };
  }

  /**
   * Calculate trust score based on attestation result
   */
  _calculateTrustScore(result, provider) {
    let score = 100;

    // Provider base score
    const providerScores = {
      TPM: 100,
      SAFETYNET: 95,
      DEVICECHECK: 95,
      WEBAUTHENTICATION: 90,
      FALLBACK: 50
    };
    score = providerScores[provider] || 50;

    // Security checks penalties
    const checks = result.securityChecks || {};
    if (checks.isRooted || checks.isJailbroken) score -= 50;
    if (checks.isEmulator) score -= 40;
    if (checks.hasMalware) score -= 60;
    if (checks.hasDebugger) score -= 30;
    if (checks.hasHooks) score -= 25;
    if (checks.isDeveloperMode) score -= 15;

    // Browser integrity penalties
    if (result.browserIntegrity) {
      if (result.browserIntegrity.headless) score -= 40;
      if (result.browserIntegrity.webdriver) score -= 35;
      if (result.browserIntegrity.selenium) score -= 35;
      if (result.browserIntegrity.phantomjs) score -= 40;
    }

    // Risk factors penalties
    if (result.riskFactors && result.riskFactors.length > 0) {
      result.riskFactors.forEach(factor => {
        const penalties = { LOW: 5, MEDIUM: 15, HIGH: 25, CRITICAL: 40 };
        score -= penalties[factor.severity] || 10;
      });
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Determine attestation status
   */
  _determineStatus(result, trustScore) {
    if (result.error) return 'FAILED';
    if (trustScore < 30) return 'INVALID';
    if (trustScore >= 30) return 'VALID';
    return 'PENDING';
  }

  /**
   * Detect binding changes
   */
  _detectBindingChanges(previous, current) {
    const changes = { all: [], suspicious: [] };

    if (!previous || !current) return changes;

    const fields = ['hardwareId', 'serialNumber', 'imei', 'macAddress', 'cpuId', 'biosVersion', 'diskId'];

    fields.forEach(field => {
      if (previous[field] !== current[field]) {
        const change = {
          field,
          oldValue: previous[field],
          newValue: current[field],
          changeType: this._classifyChange(field, previous[field], current[field])
        };
        changes.all.push(change);
        if (change.changeType === 'SUSPICIOUS' || change.changeType === 'CRITICAL') {
          changes.suspicious.push(change);
        }
      }
    });

    return changes;
  }

  /**
   * Classify binding change type
   */
  _classifyChange(field, oldValue, newValue) {
    const criticalFields = ['hardwareId', 'cpuId', 'serialNumber'];
    const suspiciousFields = ['imei', 'macAddress'];

    if (criticalFields.includes(field)) return 'CRITICAL';
    if (suspiciousFields.includes(field)) return 'SUSPICIOUS';
    return 'EXPECTED';
  }

  /**
   * Assess binding risk
   */
  _assessBindingRisk(changes, attestation) {
    let riskScore = 0;
    const indicators = [];

    // Change-based risk
    if (changes.suspicious.length > 0) {
      riskScore += 40;
      indicators.push({
        type: 'SUSPICIOUS_BINDING_CHANGE',
        description: `${changes.suspicious.length} suspicious binding changes detected`,
        severity: 'HIGH'
      });
    }

    // Attestation-based risk
    if (attestation.trustScore < 50) {
      riskScore += 30;
      indicators.push({
        type: 'LOW_TRUST_SCORE',
        description: 'Device attestation trust score is low',
        severity: 'MEDIUM'
      });
    }

    // Security check risk
    if (attestation.securityChecks) {
      if (attestation.securityChecks.isRooted || attestation.securityChecks.isJailbroken) {
        riskScore += 50;
        indicators.push({
          type: 'COMPROMISED_DEVICE',
          description: 'Device is rooted or jailbroken',
          severity: 'CRITICAL'
        });
      }
    }

    const level = riskScore >= 75 ? 'CRITICAL' : riskScore >= 50 ? 'HIGH' : riskScore >= 25 ? 'MEDIUM' : 'LOW';

    return {
      level,
      score: Math.min(100, riskScore),
      indicators,
      recommendation: this._getRiskRecommendation(level)
    };
  }

  /**
   * Get risk recommendation
   */
  _getRiskRecommendation(level) {
    const recommendations = {
      LOW: 'Continue normal monitoring',
      MEDIUM: 'Increase monitoring and require additional verification',
      HIGH: 'Challenge user with step-up authentication',
      CRITICAL: 'Block session and require full re-authentication'
    };
    return recommendations[level] || 'Monitor closely';
  }

  /**
   * Calculate composite trust score
   */
  _calculateCompositeTrustScore(attestationScore, stabilityScore, anomalies) {
    // Weighted average
    let composite = (attestationScore * 0.6) + (stabilityScore * 0.4);

    // Penalty for anomalies
    if (anomalies.hasAnomalies) {
      composite -= (anomalies.highRiskChanges * 10);
      composite -= (anomalies.changeCount * 2);
    }

    return Math.max(0, Math.min(100, composite));
  }

  /**
   * Get trust level
   */
  _getTrustLevel(score) {
    if (score >= 80) return 'HIGH';
    if (score >= 60) return 'MEDIUM';
    if (score >= 40) return 'LOW';
    return 'VERY_LOW';
  }
}

module.exports = new DeviceAttestationService();
