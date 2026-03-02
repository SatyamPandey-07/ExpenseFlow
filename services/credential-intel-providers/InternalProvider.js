/**
 * Internal Credential Intelligence Provider
 * Uses internal honeypots, detection systems, and historical data
 */

const BaseCredentialIntelProvider = require('./BaseCredentialIntelProvider');
const CredentialCompromise = require('../../models/CredentialCompromise');
const CredentialAttackPattern = require('../../models/CredentialAttackPattern');

class InternalProvider extends BaseCredentialIntelProvider {
  constructor() {
    super('INTERNAL');
    
    // No external API rate limits
    this.rateLimit = {
      maxRequests: 1000,
      windowMs: 60000,
      requests: []
    };
  }

  /**
   * Check if credential is compromised in internal systems
   */
  async checkCompromise(identifier, identifierType = 'EMAIL') {
    try {
      const identifierHash = this.hashIdentifier(identifier);

      // Query internal database
      const compromises = await CredentialCompromise.find({
        identifier: identifierHash,
        identifierType,
        status: 'ACTIVE'
      }).lean();

      if (compromises.length === 0) {
        return this.successResponse(false, []);
      }

      // Normalize breaches
      const breaches = [];
      compromises.forEach(comp => {
        comp.breachSources.forEach(source => {
          breaches.push(this.normalizeBreachData({
            ...source,
            compromiseType: comp.compromiseType,
            riskScore: comp.riskScore
          }));
        });
      });

      return this.successResponse(true, breaches, {
        totalCompromises: compromises.length,
        highestRiskScore: Math.max(...compromises.map(c => c.riskScore))
      });

    } catch (error) {
      console.error('[Internal] Check compromise error:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Check password hash in internal honeypots/detections
   */
  async checkPasswordHash(passwordHash, hashType = 'SHA1') {
    try {
      const normalizedHash = passwordHash.toUpperCase();

      // Check internal password compromise database
      const compromises = await CredentialCompromise.find({
        identifier: normalizedHash,
        identifierType: 'PASSWORD_HASH',
        status: 'ACTIVE'
      }).lean();

      if (compromises.length === 0) {
        return this.successResponse(false, [], { breachCount: 0 });
      }

      let totalBreachCount = 0;
      compromises.forEach(comp => {
        comp.breachSources.forEach(source => {
          totalBreachCount += source.compromisedRecordCount || 1;
        });
      });

      return this.successResponse(true, [], {
        breachCount: totalBreachCount,
        compromiseCount: compromises.length,
        severity: this._assessPasswordSeverity(totalBreachCount)
      });

    } catch (error) {
      console.error('[Internal] Check password hash error:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Get all breaches for identifier
   */
  async getAllBreaches(identifier) {
    return this.checkCompromise(identifier);
  }

  /**
   * Get breach details
   */
  async getBreachDetails(breachName) {
    try {
      const compromise = await CredentialCompromise.findOne({
        'breachSources.breachName': breachName,
        status: 'ACTIVE'
      }).lean();

      if (!compromise) {
        return this.errorResponse('Breach not found', 'NOT_FOUND');
      }

      const breach = compromise.breachSources.find(b => b.breachName === breachName);

      return {
        success: true,
        breach: this.normalizeBreachData(breach)
      };

    } catch (error) {
      console.error('[Internal] Get breach details error:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Check for credential reuse patterns
   */
  async checkCredentialReuse(userId, identifier) {
    try {
      const identifierHash = this.hashIdentifier(identifier);

      // Find if this credential appears in attacks targeting other users
      const attacks = await CredentialAttackPattern.find({
        attackType: { $in: ['CREDENTIAL_STUFFING', 'PASSWORD_SPRAY'] },
        'targetedUsers.email': identifier,
        'targetedUsers.userId': { $ne: userId },
        status: { $in: ['DETECTED', 'IN_PROGRESS'] }
      }).lean();

      return {
        success: true,
        reuseDetected: attacks.length > 0,
        attackCount: attacks.length,
        attacks: attacks.map(a => ({
          attackId: a.attackId,
          attackType: a.attackType,
          severity: a.severity,
          detectedAt: a.createdAt
        }))
      };

    } catch (error) {
      console.error('[Internal] Check credential reuse error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Detect spray patterns targeting user
   */
  async detectSprayPattern(userId, timeWindow = 3600000) {
    try {
      const since = new Date(Date.now() - timeWindow);

      const sprayAttacks = await CredentialAttackPattern.find({
        attackType: 'PASSWORD_SPRAY',
        'targetedUsers.userId': userId,
        'attackDetails.startTime': { $gte: since },
        status: { $in: ['DETECTED', 'IN_PROGRESS'] }
      }).lean();

      return {
        success: true,
        sprayDetected: sprayAttacks.length > 0,
        attackCount: sprayAttacks.length,
        attacks: sprayAttacks
      };

    } catch (error) {
      console.error('[Internal] Detect spray pattern error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Record internal breach detection
   */
  async recordCompromise(data) {
    try {
      const identifierHash = this.hashIdentifier(data.identifier);

      // Check if already exists
      let compromise = await CredentialCompromise.findOne({
        identifier: identifierHash,
        identifierType: data.identifierType
      });

      const breachData = {
        provider: 'INTERNAL',
        breachName: data.breachName || 'Internal Detection',
        breachDate: data.breachDate || new Date(),
        discoveredDate: new Date(),
        dataClasses: data.dataClasses || [],
        severity: data.severity || 'MEDIUM',
        verified: true,
        sourceUrl: 'internal',
        compromisedRecordCount: 1
      };

      if (compromise) {
        // Add to existing
        await compromise.addBreachSource(breachData);
      } else {
        // Create new
        compromise = await CredentialCompromise.create({
          identifier: identifierHash,
          identifierType: data.identifierType,
          compromiseType: data.compromiseType || 'INTERNAL_LEAK',
          breachSources: [breachData],
          riskScore: data.riskScore || 50,
          riskLevel: data.riskLevel || 'MEDIUM',
          status: 'ACTIVE',
          affectedUsers: data.userId ? [{
            userId: data.userId,
            notified: false,
            actionTaken: 'NONE'
          }] : [],
          detectionContext: data.detectionContext || {}
        });
      }

      return {
        success: true,
        compromiseId: compromise._id,
        riskScore: compromise.riskScore
      };

    } catch (error) {
      console.error('[Internal] Record compromise error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Assess password breach severity
   */
  _assessPasswordSeverity(count) {
    if (count > 10000) return 'CRITICAL';
    if (count > 1000) return 'HIGH';
    if (count > 100) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Normalize internal breach data
   */
  normalizeBreachData(rawData) {
    return {
      provider: this.providerName,
      breachName: rawData.breachName || 'Internal Detection',
      breachDate: rawData.breachDate || new Date(),
      discoveredDate: rawData.discoveredDate || new Date(),
      dataClasses: rawData.dataClasses || [],
      severity: rawData.severity || 'MEDIUM',
      verified: rawData.verified !== false,
      sourceUrl: 'internal',
      compromisedRecordCount: rawData.compromisedRecordCount || 1
    };
  }
}

module.exports = InternalProvider;
