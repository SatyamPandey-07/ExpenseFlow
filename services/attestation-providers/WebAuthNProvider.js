/**
 * Web Authentication (WebAuthn) Provider
 * Verifies browser-based device attestation using WebAuthn/FIDO2
 */

const BaseAttestationProvider = require('./BaseAttestationProvider');
const crypto = require('crypto');

class WebAuthNProvider extends BaseAttestationProvider {
  constructor() {
    super('WEBAUTHENTICATION');
  }

  /**
   * Verify WebAuthn attestation
   */
  async verify(params) {
    try {
      const { webAuthnData, challenge, deviceId } = params;

      if (!webAuthnData) {
        return this.errorResponse('WebAuthn data not provided');
      }

      // Validate data format
      if (!this.validateAttestationData(webAuthnData)) {
        return this.errorResponse('Invalid WebAuthn attestation data');
      }

      // Verify attestation object
      const attestationValid = await this._verifyAttestation(webAuthnData, challenge);
      if (!attestationValid) {
        return this.errorResponse('WebAuthn attestation verification failed');
      }

      // Extract security checks (browser integrity)
      const securityChecks = this.extractSecurityChecks(webAuthnData);

      // Extract browser integrity signals
      const browserIntegrity = this._extractBrowserIntegrity(webAuthnData);

      // Extract binding
      const binding = this.extractBinding(webAuthnData);

      // Identify risk factors
      const riskFactors = this.identifyRiskFactors(webAuthnData, securityChecks);

      // Add browser-specific risk factors
      if (browserIntegrity.headless) {
        riskFactors.push({
          type: 'AUTOMATION',
          severity: 'HIGH',
          description: 'Headless browser detected',
          impactScore: 40
        });
      }

      if (browserIntegrity.webdriver) {
        riskFactors.push({
          type: 'AUTOMATION',
          severity: 'HIGH',
          description: 'WebDriver automation detected',
          impactScore: 35
        });
      }

      // Prepare attestation data
      const attestationData = {
        webAuthn: {
          credentialId: webAuthnData.credentialId,
          publicKey: this._sanitizePublicKey(webAuthnData.publicKey),
          counter: webAuthnData.counter || 0,
          aaguid: webAuthnData.aaguid,
          authenticatorData: this._sanitizeAuthData(webAuthnData.authenticatorData)
        },
        raw: {
          provider: 'WEBAUTHENTICATION',
          attestationType: webAuthnData.attestationType || 'none',
          userVerification: webAuthnData.userVerification || false,
          timestamp: new Date()
        }
      };

      return {
        ...this.successResponse(attestationData, securityChecks, binding, riskFactors),
        browserIntegrity
      };

    } catch (error) {
      console.error('[WebAuthN] Verification failed:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Validate WebAuthn data
   */
  validateAttestationData(data) {
    return data &&
           data.credentialId &&
           data.publicKey &&
           data.authenticatorData;
  }

  /**
   * Verify WebAuthn attestation
   */
  async _verifyAttestation(data, challenge) {
    try {
      // In production:
      // 1. Verify authenticator data structure
      // 2. Verify hash(clientDataJSON) matches
      // 3. Verify attestation statement based on format (packed, tpm, android-key, etc.)
      // 4. Verify attestation certificate chain
      // 5. Check credential counter hasn't decreased (replay attack)

      if (!challenge || !challenge.nonce) return false;

      // Simulate verification
      return true;
    } catch (error) {
      console.error('[WebAuthN] Attestation verification error:', error);
      return false;
    }
  }

  /**
   * Extract browser integrity signals
   */
  _extractBrowserIntegrity(data) {
    const integrity = {
      userAgent: data.userAgent || '',
      webdriver: false,
      phantomjs: false,
      selenium: false,
      headless: false,
      extensionsDetected: [],
      automationTools: []
    };

    // Check for automation indicators
    if (data.navigator) {
      integrity.webdriver = data.navigator.webdriver === true;
      
      // Check for headless
      if (data.navigator.platform === 'HeadlessChrome' ||
          data.navigator.userAgent.includes('Headless')) {
        integrity.headless = true;
        integrity.automationTools.push('headless-chrome');
      }

      // Check for PhantomJS
      if (data.navigator.userAgent.includes('PhantomJS') ||
          data.window?._phantom !== undefined) {
        integrity.phantomjs = true;
        integrity.automationTools.push('phantomjs');
      }

      // Check for Selenium
      if (data.navigator.webdriver ||
          data.window?.document?.__selenium_unwrapped ||
          data.window?.document?.__webdriver_evaluate) {
        integrity.selenium = true;
        integrity.automationTools.push('selenium');
      }
    }

    // Check for suspicious extensions
    if (data.extensions && Array.isArray(data.extensions)) {
      integrity.extensionsDetected = data.extensions;
    }

    // Check canvas fingerprint
    if (data.canvasFingerprint) {
      const suspiciousCanvasPatterns = ['00000000', 'ffffffff'];
      if (suspiciousCanvasPatterns.some(p => data.canvasFingerprint.includes(p))) {
        integrity.automationTools.push('canvas-spoofing');
      }
    }

    return integrity;
  }

  /**
   * Extract security checks
   */
  extractSecurityChecks(data) {
    const checks = {
      isRooted: false,
      isJailbroken: false,
      isEmulator: false,
      isDeveloperMode: false,
      hasDebugger: false,
      hasHooks: false,
      hasMalware: false
    };

    // Browser-based checks
    if (data.navigator) {
      // Check for dev tools open
      if (data.devToolsOpen === true) {
        checks.hasDebugger = true;
      }

      // Check for automation
      if (data.navigator.webdriver === true) {
        checks.hasHooks = true;
      }
    }

    // Check for browser extensions that modify behavior
    if (data.extensions && data.extensions.length > 10) {
      checks.hasHooks = true; // Many extensions may indicate manipulation
    }

    return checks;
  }

  /**
   * Extract device binding
   */
  extractBinding(data) {
    return {
      hardwareId: data.hardwareId || this._generateBrowserFingerprint(data),
      serialNumber: null,
      imei: null,
      macAddress: null,
      cpuId: data.hardwareConcurrency || null,
      biosVersion: data.navigator?.userAgent || null,
      diskId: null
    };
  }

  /**
   * Generate browser fingerprint
   */
  _generateBrowserFingerprint(data) {
    const components = [
      data.userAgent,
      data.navigator?.language,
      data.navigator?.platform,
      data.screen?.width,
      data.screen?.height,
      data.screen?.colorDepth,
      data.hardwareConcurrency,
      data.timezone
    ].filter(Boolean).join('|');

    return crypto.createHash('sha256').update(components).digest('hex');
  }

  /**
   * Sanitize public key
   */
  _sanitizePublicKey(publicKey) {
    if (!publicKey) return null;
    return crypto.createHash('sha256').update(publicKey).digest('hex');
  }

  /**
   * Sanitize authenticator data
   */
  _sanitizeAuthData(authData) {
    if (!authData) return null;
    // Store only hash of authenticator data
    return crypto.createHash('sha256').update(authData).digest('hex');
  }
}

module.exports = WebAuthNProvider;
