/**
 * Have I Been Pwned (HIBP) Provider
 * Integrates with HIBP API v3 for breach checking
 */

const BaseCredentialIntelProvider = require('./BaseCredentialIntelProvider');
const crypto = require('crypto');
const https = require('https');

class HIBPProvider extends BaseCredentialIntelProvider {
  constructor() {
    super('HIBP');
    
    // API configuration
    this.config = {
      apiKey: process.env.HIBP_API_KEY || null,
      apiUrl: 'https://haveibeenpwned.com/api/v3',
      userAgent: 'ExpenseFlow-Security-Check',
      timeout: 10000
    };

    // Rate limiting (HIBP: 10 requests per minute with API key)
    this.rateLimit = {
      maxRequests: 10,
      windowMs: 60000, // 1 minute
      requests: []
    };
  }

  /**
   * Check if email is in breaches
   */
  async checkCompromise(identifier, identifierType = 'EMAIL') {
    try {
      if (!this.checkRateLimit()) {
        return this.errorResponse('Rate limit exceeded', 'RATE_LIMIT');
      }

      if (identifierType !== 'EMAIL') {
        return this.errorResponse('HIBP only supports email checking', 'UNSUPPORTED_TYPE');
      }

      // Make API request
      const breaches = await this._apiRequest(`/breachedaccount/${encodeURIComponent(identifier)}`, {
        truncateResponse: false
      });

      if (!breaches || breaches.length === 0) {
        return this.successResponse(false, []);
      }

      // Normalize breach data
      const normalizedBreaches = breaches.map(b => this.normalizeBreachData(b));

      return this.successResponse(true, normalizedBreaches, {
        totalBreaches: breaches.length
      });

    } catch (error) {
      if (error.statusCode === 404) {
        // No breaches found
        return this.successResponse(false, []);
      }
      
      console.error('[HIBP] Check compromise error:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Check password hash using k-anonymity
   */
  async checkPasswordHash(passwordHash, hashType = 'SHA1') {
    try {
      if (!this.checkRateLimit()) {
        return this.errorResponse('Rate limit exceeded', 'RATE_LIMIT');
      }

      // HIBP uses SHA-1
      let sha1Hash;
      if (hashType === 'SHA1') {
        sha1Hash = passwordHash.toUpperCase();
      } else {
        return this.errorResponse('HIBP requires SHA-1 hash', 'INVALID_HASH_TYPE');
      }

      // Use k-anonymity: send first 5 chars, get back suffixes
      const prefix = sha1Hash.substring(0, 5);
      const suffix = sha1Hash.substring(5);

      const response = await this._apiRequest(`/range/${prefix}`, {}, 'pwnedpasswords');

      if (!response) {
        return this.successResponse(false, [], { breachCount: 0 });
      }

      // Parse response
      const lines = response.split('\n');
      let breachCount = 0;

      for (const line of lines) {
        const [hashSuffix, count] = line.split(':');
        if (hashSuffix.trim() === suffix) {
          breachCount = parseInt(count.trim(), 10);
          break;
        }
      }

      return this.successResponse(breachCount > 0, [], { 
        breachCount,
        severity: this._assessPasswordSeverity(breachCount)
      });

    } catch (error) {
      console.error('[HIBP] Check password hash error:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Get all breaches
   */
  async getAllBreaches(identifier) {
    return this.checkCompromise(identifier, 'EMAIL');
  }

  /**
   * Get breach details
   */
  async getBreachDetails(breachName) {
    try {
      if (!this.checkRateLimit()) {
        return this.errorResponse('Rate limit exceeded', 'RATE_LIMIT');
      }

      const breach = await this._apiRequest(`/breach/${encodeURIComponent(breachName)}`);
      
      if (!breach) {
        return this.errorResponse('Breach not found', 'NOT_FOUND');
      }

      return {
        success: true,
        breach: this.normalizeBreachData(breach)
      };

    } catch (error) {
      console.error('[HIBP] Get breach details error:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Make HIBP API request
   */
  async _apiRequest(endpoint, params = {}, subdomain = 'haveibeenpwned') {
    return new Promise((resolve, reject) => {
      // Build URL
      const queryString = Object.keys(params).length > 0
        ? '?' + Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
        : '';

      const options = {
        hostname: `${subdomain}.com`,
        path: `/api/v3${endpoint}${queryString}`,
        method: 'GET',
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'application/json'
        },
        timeout: this.config.timeout
      };

      // Add API key if available (required for breach checking)
      if (this.config.apiKey && subdomain === 'haveibeenpwned') {
        options.headers['hibp-api-key'] = this.config.apiKey;
      }

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              // Try parsing as JSON first
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (e) {
              // Not JSON (e.g., password range response)
              resolve(data);
            }
          } else if (res.statusCode === 404) {
            resolve(null); // Not found is okay
          } else if (res.statusCode === 429) {
            const error = new Error('Rate limit exceeded');
            error.statusCode = 429;
            reject(error);
          } else {
            const error = new Error(`API request failed: ${res.statusCode}`);
            error.statusCode = res.statusCode;
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Assess password breach severity
   */
  _assessPasswordSeverity(count) {
    if (count > 100000) return 'CRITICAL';
    if (count > 10000) return 'HIGH';
    if (count > 1000) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Override normalization for HIBP format
   */
  normalizeBreachData(rawData) {
    return {
      provider: this.providerName,
      breachName: rawData.Name || rawData.Title,
      breachDate: new Date(rawData.BreachDate),
      discoveredDate: new Date(rawData.AddedDate),
      dataClasses: rawData.DataClasses || [],
      severity: this._assessSeverity({
        dataClasses: rawData.DataClasses,
        pwnCount: rawData.PwnCount
      }),
      verified: rawData.IsVerified,
      sourceUrl: rawData.Domain,
      compromisedRecordCount: rawData.PwnCount
    };
  }
}

module.exports = HIBPProvider;
