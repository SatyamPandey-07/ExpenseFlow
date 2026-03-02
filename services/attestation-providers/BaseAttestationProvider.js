/**
 * Base Attestation Provider Interface
 * All attestation providers must implement this interface
 */

class BaseAttestationProvider {
  constructor(providerName) {
    this.providerName = providerName;
  }

  /**
   * Verify device attestation
   * @param {Object} params - Attestation parameters
   * @returns {Object} Verification result
   */
  async verify(params) {
    throw new Error('verify() must be implemented by attestation provider');
  }

  /**
   * Validate attestation data format
   */
  validateAttestationData(data) {
    throw new Error('validateAttestationData() must be implemented');
  }

  /**
   * Extract security checks from attestation
   */
  extractSecurityChecks(attestationResult) {
    return {
      isRooted: false,
      isJailbroken: false,
      isEmulator: false,
      isDeveloperMode: false,
      hasDebugger: false,
      hasHooks: false,
      hasMalware: false
    };
  }

  /**
   * Extract device binding information
   */
  extractBinding(attestationResult) {
    return {
      hardwareId: null,
      serialNumber: null,
      imei: null,
      macAddress: null,
      cpuId: null,
      biosVersion: null,
      diskId: null
    };
  }

  /**
   * Identify risk factors
   */
  identifyRiskFactors(attestationResult, securityChecks) {
    const riskFactors = [];

    if (securityChecks.isRooted || securityChecks.isJailbroken) {
      riskFactors.push({
        type: 'ROOTED',
        severity: 'CRITICAL',
        description: 'Device is rooted or jailbroken',
        impactScore: 50
      });
    }

    if (securityChecks.isEmulator) {
      riskFactors.push({
        type: 'EMULATOR',
        severity: 'HIGH',
        description: 'Running in emulator environment',
        impactScore: 40
      });
    }

    if (securityChecks.hasDebugger) {
      riskFactors.push({
        type: 'DEBUGGER',
        severity: 'HIGH',
        description: 'Debugger detected',
        impactScore: 30
      });
    }

    if (securityChecks.hasMalware) {
      riskFactors.push({
        type: 'MALWARE',
        severity: 'CRITICAL',
        description: 'Malware detected on device',
        impactScore: 60
      });
    }

    return riskFactors;
  }

  /**
   * Generate standard error response
   */
  errorResponse(message, details = {}) {
    return {
      success: false,
      error: message,
      data: {},
      securityChecks: this.extractSecurityChecks({}),
      binding: this.extractBinding({}),
      riskFactors: [],
      ...details
    };
  }

  /**
   * Generate standard success response
   */
  successResponse(data, securityChecks, binding, riskFactors = []) {
    return {
      success: true,
      data,
      securityChecks,
      binding,
      riskFactors,
      browserIntegrity: null,
      sdkVersion: this.getSDKVersion()
    };
  }

  /**
   * Get SDK version
   */
  getSDKVersion() {
    return '1.0.0';
  }
}

module.exports = BaseAttestationProvider;
