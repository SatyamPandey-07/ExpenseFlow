/**
 * Fallback Attestation Provider
 * Used when hardware attestation is unavailable
 * Relies on behavioral signals and device fingerprinting
 */

const BaseAttestationProvider = require('./BaseAttestationProvider');
const crypto = require('crypto');

class FallbackProvider extends BaseAttestationProvider {
  constructor() {
    super('FALLBACK');
  }

  /**
   * Verify using fallback methods
   */
  async verify(params) {
    try {
      const { fallbackData, challenge, deviceId, userId } = params;

      if (!fallbackData) {
        return this.errorResponse('Fallback data not provided');
      }

      // Collect all available signals
      const signals = this._collectSecuritySignals(fallbackData);

      // Calculate trust score based on signals
      const trustLevel = this._calculateTrustLevel(signals);

      // Extract security checks
      const securityChecks = this.extractSecurityChecks(signals);

      // Extract binding
      const binding = this.extractBinding(fallbackData);

      // Identify risk factors
      const riskFactors = this.identifyRiskFactors(signals, securityChecks);

      // Add fallback-specific notices
      riskFactors.push({
        type: 'FALLBACK_ATTESTATION',
        severity: 'MEDIUM',
        description: 'Using fallback attestation - hardware attestation unavailable',
        impactScore: 20
      });

      // Prepare attestation data
      const attestationData = {
        raw: {
          provider: 'FALLBACK',
          trustLevel,
          signals,
          timestamp: new Date()
        }
      };

      return this.successResponse(
        attestationData,
        securityChecks,
        binding,
        riskFactors
      );

    } catch (error) {
      console.error('[Fallback] Verification failed:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Validate fallback data
   */
  validateAttestationData(data) {
    return data && typeof data === 'object';
  }

  /**
   * Collect security signals
   */
  _collectSecuritySignals(data) {
    const signals = {
      deviceFingerprint: data.deviceFingerprint || null,
      userAgent: data.userAgent || null,
      platform: data.platform || null,
      screenResolution: data.screenResolution || null,
      timezone: data.timezone || null,
      language: data.language || null,
      hardwareConcurrency: data.hardwareConcurrency || null,
      deviceMemory: data.deviceMemory || null,
      
      // Browser features
      cookiesEnabled: data.cookiesEnabled !== false,
      doNotTrack: data.doNotTrack || null,
      
      // Canvas fingerprint
      canvasFingerprint: data.canvasFingerprint || null,
      webglFingerprint: data.webglFingerprint || null,
      
      // Audio fingerprint
      audioFingerprint: data.audioFingerprint || null,
      
      // Fonts
      fontsDetected: data.fontsDetected || [],
      
      // Plugins
      plugins: data.plugins || [],
      
      // Touch support
      touchSupport: data.touchSupport || false,
      maxTouchPoints: data.maxTouchPoints || 0,
      
      // Battery API
      batteryCharging: data.batteryCharging,
      batteryLevel: data.batteryLevel,
      
      // Network
      connectionType: data.connectionType || null,
      effectiveType: data.effectiveType || null,
      
      // Behavioral
      mouseMovements: data.mouseMovements || 0,
      keyboardActivity: data.keyboardActivity || 0,
      scrollActivity: data.scrollActivity || 0,
      
      // Timing
      performanceTiming: data.performanceTiming || null,
      
      // Automation indicators
      webdriverPresent: data.navigator?.webdriver === true,
      automationControlled: data.automationControlled === true,
      
      // Consistency checks
      consistencyScore: this._checkConsistency(data)
    };

    return signals;
  }

  /**
   * Check consistency of provided data
   */
  _checkConsistency(data) {
    let score = 100;

    // Check user agent vs platform
    if (data.userAgent && data.platform) {
      const uaLower = data.userAgent.toLowerCase();
      const platformLower = data.platform.toLowerCase();
      
      if (platformLower.includes('win') && !uaLower.includes('windows')) {
        score -= 20;
      }
      if (platformLower.includes('mac') && !uaLower.includes('mac')) {
        score -= 20;
      }
      if (platformLower.includes('linux') && !uaLower.includes('linux')) {
        score -= 20;
      }
    }

    // Check touch support vs mobile
    if (data.touchSupport && data.userAgent) {
      const isMobileUA = /mobile|android|iphone|ipad/i.test(data.userAgent);
      if (data.touchSupport !== isMobileUA) {
        score -= 15;
      }
    }

    // Check hardware concurrency
    if (data.hardwareConcurrency) {
      if (data.hardwareConcurrency < 1 || data.hardwareConcurrency > 128) {
        score -= 25; // Suspicious value
      }
    }

    // Check screen resolution
    if (data.screenResolution) {
      const [width, height] = data.screenResolution.split('x').map(Number);
      if (width < 320 || height < 240 || width > 7680 || height > 4320) {
        score -= 20; // Unusual resolution
      }
    }

    return Math.max(0, score);
  }

  /**
   * Calculate trust level from signals
   */
  _calculateTrustLevel(signals) {
    let score = 50; // Start at medium

    // Positive signals
    if (signals.consistencyScore > 90) score += 15;
    else if (signals.consistencyScore > 70) score += 10;
    else if (signals.consistencyScore > 50) score += 5;

    if (signals.deviceFingerprint) score += 10;
    if (signals.canvasFingerprint) score += 5;
    if (signals.webglFingerprint) score += 5;
    if (signals.audioFingerprint) score += 5;

    if (signals.mouseMovements > 10) score += 5;
    if (signals.keyboardActivity > 5) score += 5;
    if (signals.scrollActivity > 3) score += 3;

    // Negative signals
    if (signals.webdriverPresent) score -= 30;
    if (signals.automationControlled) score -= 25;
    if (!signals.cookiesEnabled) score -= 10;

    if (signals.consistencyScore < 50) score -= 20;
    if (signals.consistencyScore < 30) score -= 30;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Extract security checks
   */
  extractSecurityChecks(signals) {
    const checks = {
      isRooted: false,
      isJailbroken: false,
      isEmulator: false,
      isDeveloperMode: false,
      hasDebugger: false,
      hasHooks: false,
      hasMalware: false
    };

    // Browser automation detection
    if (signals.webdriverPresent || signals.automationControlled) {
      checks.hasHooks = true;
    }

    // Consistency failures might indicate tampering
    if (signals.consistencyScore < 30) {
      checks.hasHooks = true;
    }

    // Unusual behavioral indicators
    if (signals.mouseMovements === 0 && signals.keyboardActivity === 0) {
      // No human interaction - possible bot
      checks.hasHooks = true;
    }

    return checks;
  }

  /**
   * Extract device binding
   */
  extractBinding(data) {
    const fingerprint = data.deviceFingerprint || this._generateFingerprint(data);
    
    return {
      hardwareId: fingerprint,
      serialNumber: null,
      imei: null,
      macAddress: null,
      cpuId: data.hardwareConcurrency?.toString() || null,
      biosVersion: data.userAgent || null,
      diskId: null
    };
  }

  /**
   * Generate device fingerprint
   */
  _generateFingerprint(data) {
    const components = [
      data.userAgent,
      data.platform,
      data.screenResolution,
      data.timezone,
      data.language,
      data.hardwareConcurrency,
      data.deviceMemory,
      data.canvasFingerprint,
      data.webglFingerprint,
      data.audioFingerprint,
      (data.fontsDetected || []).sort().join(','),
      (data.plugins || []).sort().join(',')
    ].filter(Boolean).join('|');

    return crypto.createHash('sha256').update(components).digest('hex');
  }
}

module.exports = FallbackProvider;
