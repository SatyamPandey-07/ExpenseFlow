/**
 * Credential Compromise Service
 * Main orchestration for credential breach checking and risk assessment
 */

const HIBPProvider = require('./credential-intel-providers/HIBPProvider');
const InternalProvider = require('./credential-intel-providers/InternalProvider');
const HoneypotProvider = require('./credential-intel-providers/HoneypotProvider');
const CredentialCompromise = require('../models/CredentialCompromise');
const CredentialIntelCache = require('../models/CredentialIntelCache');
const crypto = require('crypto');

class CredentialCompromiseService {
  constructor() {
    // Initialize providers
    this.providers = {
      HIBP: new HIBPProvider(),
      INTERNAL: new InternalProvider(),
      HONEYPOT: new HoneypotProvider()
    };

    // Configuration
    this.config = {
      cacheEnabled: true,
      cacheTTL: 86400, // 24 hours
      staleThreshold: 604800, // 7 days
      maxProvidersPerCheck: 2,
      riskThresholds: {
        CRITICAL: 80,
        HIGH: 60,
        MEDIUM: 40,
        LOW: 20
      }
    };
  }

  /**
   * Check if credential is compromised (multi-provider)
   */
  async checkCompromise(identifier, identifierType = 'EMAIL', options = {}) {
    try {
      const {
        useCache = true,
        providers = ['HIBP', 'INTERNAL', 'HONEYPOT'],
        userId = null
      } = options;

      const identifierHash = this._hashIdentifier(identifier);

      // Check cache first
      if (useCache && this.config.cacheEnabled) {
        const cached = await this._checkCache(identifierHash, identifierType);
        if (cached) {
          return cached;
        }
      }

      // Query multiple providers in parallel
      const providerResults = await Promise.all(
        providers.map(async (providerName) => {
          try {
            const provider = this.providers[providerName];
            if (!provider) {
              console.warn(`[CompromiseService] Provider ${providerName} not found`);
              return null;
            }

            const result = await provider.checkCompromise(identifier, identifierType);
            return {
              provider: providerName,
              ...result
            };
          } catch (error) {
            console.error(`[CompromiseService] Provider ${providerName} error:`, error);
            return null;
          }
        })
      );

      // Filter out null results
      const validResults = providerResults.filter(r => r && r.success);

      // Aggregate results
      const aggregated = this._aggregateResults(validResults, identifierHash, identifierType);

      // Cache result
      if (useCache && this.config.cacheEnabled) {
        await this._cacheResult(identifierHash, identifierType, aggregated);
      }

      // If compromised, record or update
      if (aggregated.compromised) {
        await this._recordCompromise(identifierHash, identifierType, aggregated, userId);
      }

      return aggregated;

    } catch (error) {
      console.error('[CompromiseService] Check compromise error:', error);
      return {
        success: false,
        error: error.message,
        compromised: null
      };
    }
  }

  /**
   * Check password hash
   */
  async checkPasswordHash(password, options = {}) {
    try {
      const {
        useCache = true,
        providers = ['HIBP', 'INTERNAL']
      } = options;

      // Generate SHA-1 hash
      const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();

      // Check cache
      if (useCache && this.config.cacheEnabled) {
        const cached = await this._checkCache(hash, 'PASSWORD_HASH');
        if (cached) {
          return cached;
        }
      }

      // Query providers
      const providerResults = await Promise.all(
        providers.map(async (providerName) => {
          try {
            const provider = this.providers[providerName];
            if (!provider) return null;

            const result = await provider.checkPasswordHash(hash, 'SHA1');
            return {
              provider: providerName,
              ...result
            };
          } catch (error) {
            console.error(`[CompromiseService] Provider ${providerName} hash check error:`, error);
            return null;
          }
        })
      );

      const validResults = providerResults.filter(r => r && r.success);

      // Aggregate
      const aggregated = {
        success: true,
        compromised: validResults.some(r => r.compromised),
        totalBreachCount: validResults.reduce((sum, r) => sum + (r.breachCount || 0), 0),
        providers: validResults.map(r => ({
          name: r.provider,
          breachCount: r.breachCount || 0,
          severity: r.severity
        })),
        severity: this._assessOverallSeverity(validResults),
        checkedAt: new Date()
      };

      // Cache
      if (useCache && this.config.cacheEnabled) {
        await this._cacheResult(hash, 'PASSWORD_HASH', aggregated);
      }

      return aggregated;

    } catch (error) {
      console.error('[CompromiseService] Check password hash error:', error);
      return {
        success: false,
        error: error.message,
        compromised: null
      };
    }
  }

  /**
   * Get compromise details for user
   */
  async getUserCompromises(userId, options = {}) {
    try {
      const {
        status = 'ACTIVE',
        minRiskScore = 0,
        limit = 50
      } = options;

      const query = {
        'affectedUsers.userId': userId
      };

      if (status) {
        query.status = status;
      }

      if (minRiskScore > 0) {
        query.riskScore = { $gte: minRiskScore };
      }

      const compromises = await CredentialCompromise.find(query)
        .sort({ riskScore: -1, createdAt: -1 })
        .limit(limit)
        .lean();

      return {
        success: true,
        count: compromises.length,
        compromises: compromises.map(c => ({
          compromiseId: c._id,
          compromiseType: c.compromiseType,
          riskScore: c.riskScore,
          riskLevel: c.riskLevel,
          status: c.status,
          breachCount: c.breachSources.length,
          breaches: c.breachSources.map(b => ({
            name: b.breachName,
            date: b.breachDate,
            severity: b.severity,
            dataClasses: b.dataClasses
          })),
          userStatus: c.affectedUsers.find(u => u.userId.toString() === userId.toString()),
          discoveredAt: c.createdAt
        }))
      };

    } catch (error) {
      console.error('[CompromiseService] Get user compromises error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Mark user as notified
   */
  async markUserNotified(compromiseId, userId) {
    try {
      const compromise = await CredentialCompromise.findById(compromiseId);
      if (!compromise) {
        return { success: false, error: 'Compromise not found' };
      }

      await compromise.markUserNotified(userId);

      return {
        success: true,
        compromiseId,
        userId
      };

    } catch (error) {
      console.error('[CompromiseService] Mark user notified error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Record user action on compromise
   */
  async recordUserAction(compromiseId, userId, action, context = {}) {
    try {
      const compromise = await CredentialCompromise.findById(compromiseId);
      if (!compromise) {
        return { success: false, error: 'Compromise not found' };
      }

      await compromise.recordUserAction(userId, action, context);

      return {
        success: true,
        compromiseId,
        userId,
        action
      };

    } catch (error) {
      console.error('[CompromiseService] Record user action error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Resolve compromise
   */
  async resolveCompromise(compromiseId, resolvedBy, resolution) {
    try {
      const compromise = await CredentialCompromise.findByIdAndUpdate(
        compromiseId,
        {
          status: 'RESOLVED',
          $push: {
            resolutionHistory: {
              resolvedBy,
              resolution,
              resolvedAt: new Date()
            }
          }
        },
        { new: true }
      );

      if (!compromise) {
        return { success: false, error: 'Compromise not found' };
      }

      return {
        success: true,
        compromiseId,
        status: 'RESOLVED'
      };

    } catch (error) {
      console.error('[CompromiseService] Resolve compromise error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check cache
   */
  async _checkCache(identifierHash, identifierType) {
    try {
      const cache = await CredentialIntelCache.getOrCreate(identifierHash, identifierType);

      // Check if valid
      if (!cache.isExpired() && !cache.isStale()) {
        await cache.recordHit();
        
        return {
          success: true,
          cached: true,
          ...cache.result,
          cacheAge: Date.now() - cache.lastChecked.getTime()
        };
      }

      // Mark stale if needed
      if (cache.isStale() && !cache.stale) {
        await cache.markStale();
      }

      return null;

    } catch (error) {
      console.error('[CompromiseService] Cache check error:', error);
      return null;
    }
  }

  /**
   * Cache result
   */
  async _cacheResult(identifierHash, identifierType, result) {
    try {
      const cache = await CredentialIntelCache.getOrCreate(identifierHash, identifierType);
      
      await cache.updateWithResult({
        compromised: result.compromised,
        breachCount: result.totalBreaches,
        riskScore: result.riskScore,
        providers: result.providers.map(p => p.name),
        breaches: result.breaches
      });

    } catch (error) {
      console.error('[CompromiseService] Cache result error:', error);
    }
  }

  /**
   * Aggregate results from multiple providers
   */
  _aggregateResults(results, identifierHash, identifierType) {
    // Check if any provider found compromise
    const compromised = results.some(r => r.compromised);

    // Collect all breaches
    const allBreaches = [];
    results.forEach(r => {
      if (r.breaches && Array.isArray(r.breaches)) {
        allBreaches.push(...r.breaches);
      }
    });

    // Deduplicate by breach name
    const uniqueBreaches = Array.from(
      new Map(allBreaches.map(b => [b.breachName, b])).values()
    );

    // Calculate overall risk score
    const riskScore = compromised ? this._calculateRiskScore(uniqueBreaches) : 0;
    const riskLevel = this._getRiskLevel(riskScore);

    return {
      success: true,
      compromised,
      identifier: identifierHash,
      identifierType,
      totalBreaches: uniqueBreaches.length,
      breaches: uniqueBreaches,
      providers: results.map(r => ({
        name: r.provider,
        compromised: r.compromised,
        breachCount: r.breachCount || r.breaches?.length || 0
      })),
      riskScore,
      riskLevel,
      checkedAt: new Date()
    };
  }

  /**
   * Calculate risk score based on breaches
   */
  _calculateRiskScore(breaches) {
    if (!breaches || breaches.length === 0) return 0;

    let score = 50; // Base score

    // Breach count factor (max +20)
    score += Math.min(breaches.length * 5, 20);

    // Severity factor (max +20)
    const criticalCount = breaches.filter(b => b.severity === 'CRITICAL').length;
    const highCount = breaches.filter(b => b.severity === 'HIGH').length;
    score += criticalCount * 10;
    score += highCount * 5;

    // Recency factor (max +10)
    const recentBreaches = breaches.filter(b => {
      const breachDate = new Date(b.breachDate);
      const monthsAgo = (Date.now() - breachDate.getTime()) / (30 * 24 * 60 * 60 * 1000);
      return monthsAgo < 12;
    });
    score += Math.min(recentBreaches.length * 2, 10);

    return Math.min(score, 100);
  }

  /**
   * Get risk level from score
   */
  _getRiskLevel(score) {
    if (score >= this.config.riskThresholds.CRITICAL) return 'CRITICAL';
    if (score >= this.config.riskThresholds.HIGH) return 'HIGH';
    if (score >= this.config.riskThresholds.MEDIUM) return 'MEDIUM';
    if (score >= this.config.riskThresholds.LOW) return 'LOW';
    return 'INFO';
  }

  /**
   * Assess overall severity
   */
  _assessOverallSeverity(results) {
    const severities = results.map(r => r.severity).filter(Boolean);
    
    if (severities.includes('CRITICAL')) return 'CRITICAL';
    if (severities.includes('HIGH')) return 'HIGH';
    if (severities.includes('MEDIUM')) return 'MEDIUM';
    if (severities.includes('LOW')) return 'LOW';
    
    return 'INFO';
  }

  /**
   * Record or update compromise
   */
  async _recordCompromise(identifierHash, identifierType, aggregated, userId) {
    try {
      // Check if exists
      let compromise = await CredentialCompromise.findOne({
        identifier: identifierHash,
        identifierType
      });

      if (compromise) {
        // Update existing
        aggregated.breaches.forEach(breach => {
          const exists = compromise.breachSources.some(
            b => b.breachName === breach.breachName
          );
          if (!exists) {
            compromise.breachSources.push(breach);
          }
        });

        // Update risk score
        compromise.riskScore = aggregated.riskScore;
        compromise.riskLevel = aggregated.riskLevel;

        // Add user if not exists
        if (userId && !compromise.affectedUsers.some(u => u.userId.toString() === userId.toString())) {
          compromise.affectedUsers.push({
            userId,
            notified: false,
            actionTaken: 'NONE'
          });
        }

        await compromise.save();

      } else {
        // Create new
        compromise = await CredentialCompromise.create({
          identifier: identifierHash,
          identifierType,
          compromiseType: this._inferCompromiseType(aggregated),
          breachSources: aggregated.breaches,
          riskScore: aggregated.riskScore,
          riskLevel: aggregated.riskLevel,
          status: 'ACTIVE',
          affectedUsers: userId ? [{
            userId,
            notified: false,
            actionTaken: 'NONE'
          }] : [],
          detectionContext: {
            providers: aggregated.providers.map(p => p.name),
            detectedAt: new Date()
          }
        });
      }

      return compromise;

    } catch (error) {
      console.error('[CompromiseService] Record compromise error:', error);
      return null;
    }
  }

  /**
   * Infer compromise type from results
   */
  _inferCompromiseType(aggregated) {
    const providerNames = aggregated.providers.map(p => p.name);
    
    if (providerNames.includes('HONEYPOT')) return 'HONEYPOT';
    if (providerNames.includes('INTERNAL')) return 'INTERNAL_LEAK';
    if (providerNames.includes('HIBP')) return 'EXTERNAL_BREACH';
    
    return 'UNKNOWN';
  }

  /**
   * Hash identifier
   */
  _hashIdentifier(identifier) {
    return crypto.createHash('sha256').update(identifier.toLowerCase()).digest('hex');
  }
}

module.exports = new CredentialCompromiseService();
