/**
 * Device Trust Integration Service
 * Integrates device attestation with session trust scoring
 * Provides real-time trust component and handles trust downgrades
 */

const DeviceAttestation = require('../models/DeviceAttestation');
const DeviceBindingHistory = require('../models/DeviceBindingHistory');
const AttestationCache = require('../models/AttestationCache');
const deviceAttestationService = require('./deviceAttestationService');

class DeviceTrustIntegrationService {
  constructor() {
    // Trust weight configuration
    this.trustWeights = {
      ATTESTATION: 0.40,  // 40% weight on device attestation
      STABILITY: 0.25,     // 25% weight on device stability
      BEHAVIORAL: 0.20,    // 20% weight on behavioral consistency
      HISTORY: 0.15        // 15% weight on historical trust
    };

    // Trust thresholds
    this.thresholds = {
      HIGH_TRUST: 80,
      MEDIUM_TRUST: 60,
      LOW_TRUST: 40,
      CRITICAL: 20
    };

    // Active session monitoring
    this.monitoringInterval = null;
  }

  /**
   * Calculate device trust component for session
   * @param {String} userId 
   * @param {String} deviceId 
   * @param {String} sessionId 
   * @returns {Object} Trust component result
   */
  async calculateDeviceTrustComponent(userId, deviceId, sessionId) {
    try {
      console.log(`[DeviceTrust] Calculating trust for device ${deviceId}`);

      // Get device attestation score
      const attestationScore = await this._getAttestationScore(userId, deviceId);

      // Get device stability score
      const stabilityScore = await this._getStabilityScore(userId, deviceId);

      // Get behavioral consistency score
      const behavioralScore = await this._getBehavioralScore(userId, deviceId);

      // Get historical trust score
      const historicalScore = await this._getHistoricalScore(userId, deviceId);

      // Calculate weighted composite score
      const compositeScore = this._calculateWeightedScore({
        attestation: attestationScore,
        stability: stabilityScore,
        behavioral: behavioralScore,
        historical: historicalScore
      });

      // Determine trust level
      const trustLevel = this._getTrustLevel(compositeScore);

      // Check for integrity failures
      const integrityCheck = await this._checkIntegrity(userId, deviceId);

      // Return trust component
      const result = {
        deviceTrustScore: compositeScore,
        trustLevel,
        components: {
          attestation: attestationScore,
          stability: stabilityScore,
          behavioral: behavioralScore,
          historical: historicalScore
        },
        integrityStatus: integrityCheck.status,
        integrityFailures: integrityCheck.failures,
        requiresAttestation: attestationScore.needsAttestation,
        requiresRenewal: attestationScore.needsRenewal,
        recommendations: this._generateRecommendations(compositeScore, integrityCheck)
      };

      console.log(`[DeviceTrust] Trust score: ${compositeScore}, Level: ${trustLevel}`);

      return result;

    } catch (error) {
      console.error('[DeviceTrust] Error calculating trust:', error);
      return {
        deviceTrustScore: 0,
        trustLevel: 'NONE',
        error: error.message
      };
    }
  }

  /**
   * Handle immediate trust downgrade on integrity failure
   */
  async handleIntegrityFailure(userId, deviceId, sessionId, failure) {
    try {
      console.log(`[DeviceTrust] Integrity failure detected for device ${deviceId}:`, failure.type);

      // Determine severity
      const severity = this._assessFailureSeverity(failure);

      // Calculate trust penalty
      const trustPenalty = this._calculateTrustPenalty(severity);

      // Update device attestation status
      await deviceAttestationService.revokeDeviceAttestation(
        userId,
        deviceId,
        `INTEGRITY_FAILURE: ${failure.type}`
      );

      // Record in binding history
      await DeviceBindingHistory.create({
        userId,
        deviceId,
        eventType: 'TRUST_DOWNGRADED',
        riskAssessment: {
          level: severity,
          score: trustPenalty,
          indicators: [{
            type: failure.type,
            description: failure.description,
            severity
          }],
          recommendation: this._getFailureRecommendation(severity)
        },
        actionTaken: severity === 'CRITICAL' ? 'BLOCK' : 'STEPUP_AUTH',
        detectionContext: {
          sessionId,
          timestamp: new Date()
        }
      });

      // Return action to take
      return {
        action: severity === 'CRITICAL' ? 'TERMINATE_SESSION' : 'REQUIRE_STEPUP_AUTH',
        severity,
        trustPenalty,
        message: `Device integrity compromised: ${failure.description}`,
        requiresAttestation: true
      };

    } catch (error) {
      console.error('[DeviceTrust] Error handling integrity failure:', error);
      return {
        action: 'TERMINATE_SESSION',
        severity: 'CRITICAL',
        error: error.message
      };
    }
  }

  /**
   * Monitor active session device trust
   */
  async monitorActiveSession(userId, deviceId, sessionId, callback) {
    try {
      const intervalMs = 60000; // Check every minute

      const monitor = setInterval(async () => {
        try {
          // Calculate current trust
          const trust = await this.calculateDeviceTrustComponent(userId, deviceId, sessionId);

          // Check for critical trust loss
          if (trust.deviceTrustScore < this.thresholds.CRITICAL) {
            console.log(`[DeviceTrust] Critical trust loss detected for session ${sessionId}`);
            
            await callback({
              type: 'CRITICAL_TRUST_LOSS',
              trust,
              action: 'TERMINATE'
            });

            clearInterval(monitor);
            return;
          }

          // Check for medium trust loss
          if (trust.deviceTrustScore < this.thresholds.LOW_TRUST) {
            await callback({
              type: 'LOW_TRUST',
              trust,
              action: 'CHALLENGE'
            });
          }

          // Check for integrity failures
          if (trust.integrityFailures && trust.integrityFailures.length > 0) {
            const criticalFailures = trust.integrityFailures.filter(f => 
              f.severity === 'CRITICAL'
            );

            if (criticalFailures.length > 0) {
              await this.handleIntegrityFailure(
                userId,
                deviceId,
                sessionId,
                criticalFailures[0]
              );

              await callback({
                type: 'INTEGRITY_FAILURE',
                failures: criticalFailures,
                action: 'TERMINATE'
              });

              clearInterval(monitor);
            }
          }

        } catch (error) {
          console.error('[DeviceTrust] Monitor error:', error);
        }
      }, intervalMs);

      // Store monitor reference
      return monitor;

    } catch (error) {
      console.error('[DeviceTrust] Error starting monitor:', error);
      throw error;
    }
  }

  /**
   * Stop monitoring session
   */
  stopMonitoring(monitor) {
    if (monitor) {
      clearInterval(monitor);
    }
  }

  /**
   * Get attestation score component
   */
  async _getAttestationScore(userId, deviceId) {
    try {
      const result = await deviceAttestationService.getDeviceTrustScore(userId, deviceId);
      
      return {
        score: result.attestationScore || 0,
        level: result.level,
        provider: result.provider,
        needsAttestation: result.trustScore === 0,
        needsRenewal: result.expiresAt && 
                      (new Date(result.expiresAt).getTime() - Date.now()) < 3600000
      };
    } catch (error) {
      return { score: 0, needsAttestation: true, error: error.message };
    }
  }

  /**
   * Get stability score component
   */
  async _getStabilityScore(userId, deviceId) {
    try {
      const stabilityScore = await DeviceBindingHistory.calculateStabilityScore(userId, deviceId);
      const anomalies = await DeviceBindingHistory.detectAnomalies(userId, deviceId);

      let score = stabilityScore;

      // Penalize for anomalies
      if (anomalies.hasAnomalies) {
        score -= (anomalies.highRiskChanges * 10);
      }

      return {
        score: Math.max(0, score),
        hasAnomalies: anomalies.hasAnomalies,
        changeCount: anomalies.changeCount
      };
    } catch (error) {
      return { score: 50, error: error.message };
    }
  }

  /**
   * Get behavioral consistency score
   */
  async _getBehavioralScore(userId, deviceId) {
    try {
      // Get recent binding history
      const history = await DeviceBindingHistory.getDeviceTimeline(userId, deviceId, 20);

      let score = 70; // Base behavioral score

      // Check for consistency in recent activity
      const recentChanged = history.filter(h => 
        h.eventType === 'BINDING_CHANGED' &&
        new Date(h.createdAt).getTime() > Date.now() - (7 * 24 * 60 * 60 * 1000)
      );

      // Penalize for frequent changes
      score -= (recentChanged.length * 5);

      // Check for verified events (positive signal)
      const verifiedCount = history.filter(h => h.verified).length;
      score += Math.min(verifiedCount * 2, 20);

      return {
        score: Math.max(0, Math.min(100, score)),
        recentChanges: recentChanged.length,
        verifiedEvents: verifiedCount
      };
    } catch (error) {
      return { score: 50, error: error.message };
    }
  }

  /**
   * Get historical trust score
   */
  async _getHistoricalScore(userId, deviceId) {
    try {
      // Get device age
      const firstSeen = await DeviceBindingHistory.findOne({ userId, deviceId })
        .sort({ createdAt: 1 })
        .select('createdAt');

      if (!firstSeen) {
        return { score: 30, isNew: true };
      }

      const ageInDays = (Date.now() - new Date(firstSeen.createdAt).getTime()) / (24 * 60 * 60 * 1000);

      // Score increases with age
      let score = 30; // Base score for new devices
      if (ageInDays > 365) score = 90;
      else if (ageInDays > 180) score = 80;
      else if (ageInDays > 90) score = 70;
      else if (ageInDays > 30) score = 60;
      else if (ageInDays > 7) score = 50;

      // Check historical trust events
      const trustEvents = await DeviceBindingHistory.find({
        userId,
        deviceId,
        eventType: { $in: ['TRUST_UPGRADED', 'TRUST_DOWNGRADED'] }
      }).sort({ createdAt: -1 }).limit(10);

      // Adjust based on recent trust changes
      const recentDowngrades = trustEvents.filter(e => 
        e.eventType === 'TRUST_DOWNGRADED' &&
        new Date(e.createdAt).getTime() > Date.now() - (30 * 24 * 60 * 60 * 1000)
      );

      score -= (recentDowngrades.length * 10);

      return {
        score: Math.max(0, Math.min(100, score)),
        ageInDays: Math.floor(ageInDays),
        isNew: ageInDays < 7,
        recentDowngrades: recentDowngrades.length
      };
    } catch (error) {
      return { score: 30, error: error.message };
    }
  }

  /**
   * Calculate weighted composite score
   */
  _calculateWeightedScore(components) {
    return Math.round(
      (components.attestation.score * this.trustWeights.ATTESTATION) +
      (components.stability.score * this.trustWeights.STABILITY) +
      (components.behavioral.score * this.trustWeights.BEHAVIORAL) +
      (components.historical.score * this.trustWeights.HISTORY)
    );
  }

  /**
   * Get trust level from score
   */
  _getTrustLevel(score) {
    if (score >= this.thresholds.HIGH_TRUST) return 'HIGH';
    if (score >= this.thresholds.MEDIUM_TRUST) return 'MEDIUM';
    if (score >= this.thresholds.LOW_TRUST) return 'LOW';
    if (score >= this.thresholds.CRITICAL) return 'VERY_LOW';
    return 'NONE';
  }

  /**
   * Check device integrity
   */
  async _checkIntegrity(userId, deviceId) {
    try {
      const attestation = await DeviceAttestation.getLatestValid(userId, deviceId);
      
      if (!attestation) {
        return { status: 'UNKNOWN', failures: [] };
      }

      const failures = [];

      // Check security checks
      if (attestation.securityChecks) {
        const checks = attestation.securityChecks;

        if (checks.isRooted || checks.isJailbroken) {
          failures.push({
            type: 'DEVICE_COMPROMISED',
            description: 'Device is rooted or jailbroken',
            severity: 'CRITICAL'
          });
        }

        if (checks.isEmulator) {
          failures.push({
            type: 'EMULATOR_DETECTED',
            description: 'Running in emulator',
            severity: 'HIGH'
          });
        }

        if (checks.hasMalware) {
          failures.push({
            type: 'MALWARE_DETECTED',
            description: 'Malware detected on device',
            severity: 'CRITICAL'
          });
        }

        if (checks.hasDebugger) {
          failures.push({
            type: 'DEBUGGER_ACTIVE',
            description: 'Debugger detected',
            severity: 'MEDIUM'
          });
        }
      }

      return {
        status: failures.length === 0 ? 'PASS' : 'FAIL',
        failures
      };
    } catch (error) {
      return {
        status: 'ERROR',
        failures: [],
        error: error.message
      };
    }
  }

  /**
   * Assess failure severity
   */
  _assessFailureSeverity(failure) {
    const criticalTypes = ['DEVICE_COMPROMISED', 'MALWARE_DETECTED'];
    const highTypes = ['EMULATOR_DETECTED', 'SIGNATURE_INVALID'];
    const mediumTypes = ['DEBUGGER_ACTIVE', 'HARDWARE_MISMATCH'];

    if (criticalTypes.includes(failure.type)) return 'CRITICAL';
    if (highTypes.includes(failure.type)) return 'HIGH';
    if (mediumTypes.includes(failure.type)) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Calculate trust penalty
   */
  _calculateTrustPenalty(severity) {
    const penalties = {
      CRITICAL: 80,
      HIGH: 50,
      MEDIUM: 30,
      LOW: 10
    };
    return penalties[severity] || 20;
  }

  /**
   * Get failure recommendation
   */
  _getFailureRecommendation(severity) {
    const recommendations = {
      CRITICAL: 'Terminate session immediately and require full re-authentication',
      HIGH: 'Require step-up authentication and new device attestation',
      MEDIUM: 'Challenge user with additional verification',
      LOW: 'Monitor closely and log for review'
    };
    return recommendations[severity] || 'Review and assess risk';
  }

  /**
   * Generate recommendations
   */
  _generateRecommendations(score, integrityCheck) {
    const recommendations = [];

    if (score < this.thresholds.CRITICAL) {
      recommendations.push({
        priority: 'CRITICAL',
        action: 'BLOCK_SESSION',
        message: 'Device trust is critically low - block session'
      });
    } else if (score < this.thresholds.LOW_TRUST) {
      recommendations.push({
        priority: 'HIGH',
        action: 'REQUIRE_STEPUP',
        message: 'Device trust is low - require additional authentication'
      });
    } else if (score < this.thresholds.MEDIUM_TRUST) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'MONITOR',
        message: 'Device trust is moderate - increase monitoring'
      });
    }

    if (integrityCheck.failures && integrityCheck.failures.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        action: 'REVOKE_ATTESTATION',
        message: 'Integrity failures detected - revoke device attestation'
      });
    }

    return recommendations;
  }
}

module.exports = new DeviceTrustIntegrationService();
