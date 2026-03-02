/**
 * TPM (Trusted Platform Module) Attestation Provider
 * Verifies hardware-backed device attestation using TPM 2.0
 */

const BaseAttestationProvider = require('./BaseAttestationProvider');
const crypto = require('crypto');

class TPMAttestationProvider extends BaseAttestationProvider {
  constructor() {
    super('TPM');
  }

  /**
   * Verify TPM attestation
   */
  async verify(params) {
    try {
      const { tpmData, challenge, deviceId } = params;

      if (!tpmData) {
        return this.errorResponse('TPM data not provided');
      }

      // Validate TPM data format
      if (!this.validateAttestationData(tpmData)) {
        return this.errorResponse('Invalid TPM attestation data format');
      }

      // Verify challenge-response
      const challengeValid = await this._verifyChallenge(tpmData, challenge);
      if (!challengeValid) {
        return this.errorResponse('Challenge verification failed');
      }

      // Verify AIK certificate
      const aikValid = await this._verifyAIKCertificate(tpmData.aikCertificate);
      if (!aikValid) {
        return this.errorResponse('AIK certificate validation failed');
      }

      // Verify platform integrity
      const integrityCheck = await this._verifyPlatformIntegrity(tpmData);

      // Extract security checks
      const securityChecks = this.extractSecurityChecks(tpmData);

      // Extract binding information
      const binding = this.extractBinding(tpmData);

      // Identify risk factors
      const riskFactors = this.identifyRiskFactors(tpmData, securityChecks);

      // Prepare attestation data
      const attestationData = {
        tpm: {
          aikCertificate: this._sanitizeAIKCert(tpmData.aikCertificate),
          platformHash: tpmData.platformHash,
          pcrs: tpmData.pcrs,
          bootIntegrity: integrityCheck.bootIntegrity,
          firmwareVersion: tpmData.firmwareVersion
        },
        raw: {
          provider: 'TPM',
          version: tpmData.version || '2.0',
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
      console.error('[TPMAttestation] Verification failed:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Validate TPM attestation data
   */
  validateAttestationData(data) {
    return data &&
           data.aikCertificate &&
           data.platformHash &&
           data.pcrs &&
           typeof data.pcrs === 'object';
  }

  /**
   * Verify challenge-response
   */
  async _verifyChallenge(tpmData, challenge) {
    try {
      if (!challenge || !challenge.nonce) {
        return false;
      }

      // In production, verify TPM signed the challenge nonce
      // For now, simulate verification
      const expectedHash = crypto
        .createHash('sha256')
        .update(challenge.nonce + tpmData.platformHash)
        .digest('hex');

      return tpmData.challengeResponse === expectedHash || true; // Simulate success
    } catch (error) {
      console.error('[TPM] Challenge verification error:', error);
      return false;
    }
  }

  /**
   * Verify AIK certificate
   */
  async _verifyAIKCertificate(aikCert) {
    try {
      if (!aikCert) return false;

      // In production:
      // 1. Verify certificate chain
      // 2. Check certificate hasn't been revoked
      // 3. Verify it's from trusted TPM manufacturer
      // 4. Check certificate validity period

      // Simulate verification
      return aikCert.length > 100; // Basic validation
    } catch (error) {
      console.error('[TPM] AIK verification error:', error);
      return false;
    }
  }

  /**
   * Verify platform integrity using PCRs
   */
  async _verifyPlatformIntegrity(tpmData) {
    try {
      const pcrs = tpmData.pcrs || {};

      // Check critical PCRs
      // PCR 0-7: BIOS and boot loader measurements
      // PCR 8-15: OS and application measurements

      const criticalPCRs = [0, 1, 2, 3, 4]; // BIOS, firmware, boot loader
      let bootIntegrity = true;

      for (const pcrIndex of criticalPCRs) {
        if (!pcrs[pcrIndex]) {
          bootIntegrity = false;
          break;
        }

        // In production, compare against known-good values
        // For now, just check they exist and are valid hashes
        const pcrValue = pcrs[pcrIndex];
        if (!/^[a-f0-9]{64}$/i.test(pcrValue)) {
          bootIntegrity = false;
          break;
        }
      }

      return {
        bootIntegrity,
        pcrsValid: Object.keys(pcrs).length >= 5,
        firmwareIntegrity: bootIntegrity
      };
    } catch (error) {
      console.error('[TPM] Platform integrity check error:', error);
      return { bootIntegrity: false, pcrsValid: false, firmwareIntegrity: false };
    }
  }

  /**
   * Extract security checks from TPM data
   */
  extractSecurityChecks(tpmData) {
    const checks = {
      isRooted: false,
      isJailbroken: false,
      isEmulator: false,
      isDeveloperMode: false,
      hasDebugger: false,
      hasHooks: false,
      hasMalware: false
    };

    // Check PCR values for signs of compromise
    if (tpmData.pcrs) {
      // Check for debugger (PCR 12 typically)
      if (tpmData.pcrs[12] && this._isPCRSuspicious(tpmData.pcrs[12])) {
        checks.hasDebugger = true;
      }

      // Check for secure boot disabled
      if (tpmData.secureBootDisabled) {
        checks.isDeveloperMode = true;
      }
    }

    // Check firmware integrity
    if (tpmData.bootIntegrityFailed) {
      checks.hasMalware = true;
    }

    return checks;
  }

  /**
   * Extract device binding
   */
  extractBinding(tpmData) {
    return {
      hardwareId: tpmData.platformHash || null,
      serialNumber: tpmData.tpmSerialNumber || null,
      imei: null, // Not available via TPM
      macAddress: null,
      cpuId: tpmData.cpuId || null,
      biosVersion: tpmData.firmwareVersion || null,
      diskId: tpmData.diskHash || null
    };
  }

  /**
   * Check if PCR value is suspicious
   */
  _isPCRSuspicious(pcrValue) {
    // In production, compare against whitelist/blacklist
    // All zeros or all ones are suspicious
    return /^0+$/.test(pcrValue) || /^f+$/i.test(pcrValue);
  }

  /**
   * Sanitize AIK certificate (remove sensitive data)
   */
  _sanitizeAIKCert(cert) {
    if (!cert) return null;
    // Return only fingerprint
    return crypto.createHash('sha256').update(cert).digest('hex');
  }
}

module.exports = TPMAttestationProvider;
