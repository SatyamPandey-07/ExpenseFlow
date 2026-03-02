/**
 * Google SafetyNet Attestation Provider (Android)
 * Verifies Android device integrity using SafetyNet API
 */

const BaseAttestationProvider = require('./BaseAttestationProvider');
const crypto = require('crypto');

class SafetyNetProvider extends BaseAttestationProvider {
  constructor() {
    super('SAFETYNET');
  }

  /**
   * Verify SafetyNet attestation
   */
  async verify(params) {
    try {
      const { safetyNetData, challenge, deviceId } = params;

      if (!safetyNetData) {
        return this.errorResponse('SafetyNet data not provided');
      }

      // Validate data format
      if (!this.validateAttestationData(safetyNetData)) {
        return this.errorResponse('Invalid SafetyNet attestation data');
      }

      // Verify JWS signature
      const jws Valid = await this._verifyJWS(safetyNetData.jws);
      if (!jwsValid) {
        return this.errorResponse('JWS signature verification failed');
      }

      // Parse JWS payload
      const payload = this._parseJWS(safetyNetData.jws);

      // Verify nonce
      if (!this._verifyNonce(payload.nonce, challenge)) {
        return this.errorResponse('Nonce verification failed');
      }

      // Extract security checks
      const securityChecks = this.extractSecurityChecks(payload);

      // Extract binding
      const binding = this.extractBinding(payload);

      // Identify risk factors
      const riskFactors = this.identifyRiskFactors(payload, securityChecks);

      // Add SafetyNet-specific risk factors
      if (!payload.ctsProfileMatch) {
        riskFactors.push({
          type: 'CTS_PROFILE_MISMATCH',
          severity: 'HIGH',
          description: 'Device does not match CTS profile',
          impactScore: 35
        });
      }

      if (!payload.basicIntegrity) {
        riskFactors.push({
          type: 'BASIC_INTEGRITY_FAIL',
          severity: 'CRITICAL',
          description: 'Device failed basic integrity check',
          impactScore: 50
        });
      }

      // Prepare attestation data
      const attestationData = {
        safetyNet: {
          jws: this._sanitizeJWS(safetyNetData.jws),
          nonce: challenge.nonce,
          ctsProfileMatch: payload.ctsProfileMatch,
          basicIntegrity: payload.basicIntegrity,
          evaluationType: payload.evaluationType || 'BASIC',
          advice: payload.advice || []
        },
        raw: {
          provider: 'SAFETYNET',
          apkPackageName: payload.apkPackageName,
          apkCertificateDigestSha256: payload.apkCertificateDigestSha256,
          timestamp: new Date(payload.timestampMs)
        }
      };

      return this.successResponse(
        attestationData,
        securityChecks,
        binding,
        riskFactors
      );

    } catch (error) {
      console.error('[SafetyNet] Verification failed:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Validate SafetyNet data
   */
  validateAttestationData(data) {
    return data && data.jws && typeof data.jws === 'string';
  }

  /**
   * Verify JWS signature
   */
  async _verifyJWS(jws) {
    try {
      // In production:
      // 1. Extract certificate chain from JWS header
      // 2. Verify certificate chain roots to Google
      // 3. Verify JWS signature using certificate public key
      // 4. Check certificate hasn't been revoked

      const parts = jws.split('.');
      if (parts.length !== 3) return false;

      // Simulate verification
      return true;
    } catch (error) {
      console.error('[SafetyNet] JWS verification error:', error);
      return false;
    }
  }

  /**
   * Parse JWS payload
   */
  _parseJWS(jws) {
    try {
      const parts = jws.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWS format');
      }

      const payloadBase64 = parts[1];
      const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
      return JSON.parse(payloadJson);
    } catch (error) {
      console.error('[SafetyNet] JWS parsing error:', error);
      return {};
    }
  }

  /**
   * Verify nonce matches challenge
   */
  _verifyNonce(payloadNonce, challenge) {
    if (!challenge || !challenge.nonce) return false;
    
    try {
      const expectedNonce = Buffer.from(challenge.nonce).toString('base64');
      return payloadNonce === expectedNonce;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract security checks
   */
  extractSecurityChecks(payload) {
    const checks = {
      isRooted: false,
      isJailbroken: false,
      isEmulator: false,
      isDeveloperMode: false,
      hasDebugger: false,
      hasHooks: false,
      hasMalware: false
    };

    // Check basic integrity
    if (!payload.basicIntegrity) {
      checks.isRooted = true;
    }

    // Check CTS profile
    if (!payload.ctsProfileMatch) {
      checks.isRooted = true; // Likely rooted or custom ROM
    }

    // Parse advice field
    if (payload.advice && Array.isArray(payload.advice)) {
      if (payload.advice.includes('LOCK_BOOTLOADER')) {
        checks.isRooted = true;
      }
      if (payload.advice.includes('RESTORE_TO_FACTORY_ROM')) {
        checks.isRooted = true;
      }
      if (payload.advice.includes('USER_BUILD')) {
        checks.isDeveloperMode = true;
      }
    }

    // Check evaluation type
    if (payload.evaluationType === 'BASIC') {
      // BASIC evaluation doesn't use hardware attestation
      checks.isDeveloperMode = true;
    }

    return checks;
  }

  /**
   * Extract device binding
   */
  extractBinding(payload) {
    return {
      hardwareId: payload.apkCertificateDigestSha256 || null,
      serialNumber: null, // Not provided by SafetyNet
      imei: null, // Not provided by SafetyNet
      macAddress: null,
      cpuId: null,
      biosVersion: null,
      diskId: null
    };
  }

  /**
   * Sanitize JWS (store only hash)
   */
  _sanitizeJWS(jws) {
    return crypto.createHash('sha256').update(jws).digest('hex');
  }
}

module.exports = SafetyNetProvider;
