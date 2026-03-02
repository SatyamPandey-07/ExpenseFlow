/**
 * Base Credential Intelligence Provider Interface
 * All credential breach providers must implement this interface
 */

class BaseCredentialIntelProvider {
  constructor(providerName) {
    this.providerName = providerName;
    this.rateLimit = {
      maxRequests: 100,
      windowMs: 3600000, // 1 hour
      requests: []
    };
  }

  /**
   * Check if email/username is compromised
   * @param {String} identifier - Email or username
   * @param {String} identifierType - EMAIL or USERNAME
   * @returns {Promise<Object>} Compromise result
   */
  async checkCompromise(identifier, identifierType = 'EMAIL') {
    throw new Error('checkCompromise() must be implemented by provider');
  }

  /**
   * Check if password hash appears in breaches
   * @param {String} passwordHash - SHA-1 or other hash
   * @param {String} hashType - SHA1, SHA256, etc.
   * @returns {Promise<Object>} Breach count
   */
  async checkPasswordHash(passwordHash, hashType = 'SHA1') {
    throw new Error('checkPasswordHash() must be implemented by provider');
  }

  /**
   * Get breach details
   * @param {String} breachName - Name of the breach
   * @returns {Promise<Object>} Breach details
   */
  async getBreachDetails(breachName) {
    throw new Error('getBreachDetails() must be implemented by provider');
  }

  /**
   * Get all breaches for an identifier
   * @param {String} identifier - Email or username
   * @returns {Promise<Array>} Array of breaches
   */
  async getAllBreaches(identifier) {
    throw new Error('getAllBreaches() must be implemented by provider');
  }

  /**
   * Check rate limit
   * @returns {Boolean} True if within limit
   */
  checkRateLimit() {
    const now = Date.now();
    
    // Remove old requests outside window
    this.rateLimit.requests = this.rateLimit.requests.filter(
      timestamp => now - timestamp < this.rateLimit.windowMs
    );

    // Check if limit exceeded
    if (this.rateLimit.requests.length >= this.rateLimit.maxRequests) {
      return false;
    }

    // Record this request
    this.rateLimit.requests.push(now);
    return true;
  }

  /**
   * Get rate limit status
   */
  getRateLimitStatus() {
    const now = Date.now();
    const recentRequests = this.rateLimit.requests.filter(
      timestamp => now - timestamp < this.rateLimit.windowMs
    );

    return {
      remaining: this.rateLimit.maxRequests - recentRequests.length,
      limit: this.rateLimit.maxRequests,
      reset: recentRequests.length > 0 
        ? new Date(recentRequests[0] + this.rateLimit.windowMs)
        : new Date()
    };
  }

  /**
   * Hash identifier for privacy
   * @param {String} identifier
   * @returns {String} Hashed identifier
   */
  hashIdentifier(identifier) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(identifier.toLowerCase()).digest('hex');
  }

  /**
   * Normalize breach data to standard format
   */
  normalizeBreachData(rawData) {
    return {
      provider: this.providerName,
      breachName: rawData.name || rawData.title || 'Unknown',
      breachDate: rawData.breachDate || rawData.addedDate,
      discoveredDate: rawData.modifiedDate || rawData.discoveredDate,
      dataClasses: rawData.dataClasses || rawData.compromisedData || [],
      severity: this._assessSeverity(rawData),
      verified: rawData.verified || rawData.isVerified || false,
      sourceUrl: rawData.domain || rawData.url,
      compromisedRecordCount: rawData.pwnCount || rawData.recordCount || 0
    };
  }

  /**
   * Assess breach severity
   */
  _assessSeverity(breachData) {
    const dataClasses = breachData.dataClasses || [];
    
    // Check for critical data
    const criticalData = ['Passwords', 'Credit cards', 'Banking details', 'National IDs'];
    const hasCritical = dataClasses.some(dc => 
      criticalData.some(cd => dc.toLowerCase().includes(cd.toLowerCase()))
    );

    if (hasCritical) return 'CRITICAL';

    // Check for high-risk data
    const highRiskData = ['Email addresses', 'Phone numbers', 'Physical addresses'];
    const hasHighRisk = dataClasses.some(dc =>
      highRiskData.some(hrd => dc.toLowerCase().includes(hrd.toLowerCase()))
    );

    if (hasHighRisk && breachData.pwnCount > 1000000) return 'HIGH';
    if (hasHighRisk) return 'MEDIUM';

    return 'LOW';
  }

  /**
   * Standard error response
   */
  errorResponse(message, code = 'PROVIDER_ERROR') {
    return {
      success: false,
      error: message,
      code,
      provider: this.providerName,
      compromised: null,
      breaches: []
    };
  }

  /**
   * Standard success response
   */
  successResponse(compromised, breaches = [], metadata = {}) {
    return {
      success: true,
      provider: this.providerName,
      compromised,
      breachCount: breaches.length,
      breaches,
      checkedAt: new Date(),
      ...metadata
    };
  }
}

module.exports = BaseCredentialIntelProvider;
