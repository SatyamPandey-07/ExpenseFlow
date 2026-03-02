/**
 * Honeypot Credential Intelligence Provider
 * Monitors honeypot accounts for credential compromise attempts
 */

const BaseCredentialIntelProvider = require('./BaseCredentialIntelProvider');
const CredentialCompromise = require('../../models/CredentialCompromise');
const CredentialAttackPattern = require('../../models/CredentialAttackPattern');

class HoneypotProvider extends BaseCredentialIntelProvider {
  constructor() {
    super('HONEYPOT');
    
    // Internal provider - no external rate limits
    this.rateLimit = {
      maxRequests: 1000,
      windowMs: 60000,
      requests: []
    };

    // Honeypot configuration
    this.config = {
      honeypotIdentifiers: new Set(), // Loaded from DB
      trapDomains: ['honeymail.net', 'trapmail.io', 'canary.local'],
      attributionWindow: 86400000 // 24 hours
    };

    // Load honeypots on init
    this._loadHoneypots();
  }

  /**
   * Load honeypot identifiers from database
   */
  async _loadHoneypots() {
    try {
      const honeypots = await CredentialCompromise.find({
        compromiseType: 'HONEYPOT',
        status: 'ACTIVE'
      }).select('identifier').lean();

      honeypots.forEach(hp => {
        this.config.honeypotIdentifiers.add(hp.identifier);
      });

      console.log(`[Honeypot] Loaded ${honeypots.length} honeypot identifiers`);
    } catch (error) {
      console.error('[Honeypot] Failed to load honeypots:', error);
    }
  }

  /**
   * Check if identifier is a honeypot or has triggered honeypots
   */
  async checkCompromise(identifier, identifierType = 'EMAIL') {
    try {
      const identifierHash = this.hashIdentifier(identifier);

      // Check if this IS a honeypot
      if (this.config.honeypotIdentifiers.has(identifierHash)) {
        return this.successResponse(true, [], {
          isHoneypot: true,
          message: 'This identifier is a honeypot'
        });
      }

      // Check if identifier appeared in honeypot attacks
      const attacks = await CredentialAttackPattern.find({
        'targetedUsers.honeypotTriggered': true,
        'attackDetails.endTime': { $gte: new Date(Date.now() - this.config.attributionWindow) },
        $or: [
          { 'attackDetails.userAgents': { $exists: true } },
          { 'attackDetails.sourceIPs': { $exists: true } }
        ]
      }).lean();

      if (attacks.length === 0) {
        return this.successResponse(false, []);
      }

      // Check if any attack patterns match this identifier's usage
      const compromises = await this._correlateWithHoneypots(identifierHash, attacks);

      return this.successResponse(compromises.length > 0, compromises, {
        honeypotTriggered: compromises.length > 0,
        attackCount: attacks.length
      });

    } catch (error) {
      console.error('[Honeypot] Check compromise error:', error);
      return this.errorResponse(error.message);
    }
  }

  /**
   * Correlate identifier with honeypot attacks
   */
  async _correlateWithHoneypots(identifierHash, attacks) {
    try {
      // Find recent authentications from same sources
      const compromises = [];

      for (const attack of attacks) {
        const sourceIPs = attack.attackDetails?.sourceIPs || [];
        const userAgents = attack.attackDetails?.userAgents || [];

        // Check if identifier was used from same IPs/user agents
        const relatedLogin = await CredentialCompromise.findOne({
          identifier: identifierHash,
          'detectionContext.sourceIP': { $in: sourceIPs },
          'detectionContext.userAgent': { $in: userAgents },
          createdAt: { $gte: new Date(attack.attackDetails.startTime) }
        }).lean();

        if (relatedLogin) {
          compromises.push({
            provider: this.providerName,
            breachName: `Honeypot Attack ${attack.attackId}`,
            breachDate: attack.createdAt,
            discoveredDate: new Date(),
            dataClasses: ['Email', 'Password'],
            severity: attack.severity,
            verified: true,
            sourceUrl: 'honeypot',
            compromisedRecordCount: attack.targetedUsers.length,
            attackType: attack.attackType,
            correlationConfidence: this._calculateConfidence(sourceIPs, userAgents)
          });
        }
      }

      return compromises;

    } catch (error) {
      console.error('[Honeypot] Correlation error:', error);
      return [];
    }
  }

  /**
   * Calculate correlation confidence
   */
  _calculateConfidence(sourceIPs, userAgents) {
    let confidence = 0;

    // More IPs = higher confidence
    if (sourceIPs.length > 10) confidence += 40;
    else if (sourceIPs.length > 5) confidence += 25;
    else if (sourceIPs.length > 1) confidence += 15;

    // More user agents = higher confidence
    if (userAgents.length > 5) confidence += 30;
    else if (userAgents.length > 2) confidence += 20;
    else if (userAgents.length > 0) confidence += 10;

    // Automated pattern bonus
    confidence += 30;

    return Math.min(confidence, 100);
  }

  /**
   * Register new honeypot
   */
  async registerHoneypot(identifier, identifierType, metadata = {}) {
    try {
      const identifierHash = this.hashIdentifier(identifier);

      // Create honeypot record
      const honeypot = await CredentialCompromise.create({
        identifier: identifierHash,
        identifierType,
        compromiseType: 'HONEYPOT',
        breachSources: [{
          provider: this.providerName,
          breachName: 'Honeypot Registration',
          breachDate: new Date(),
          discoveredDate: new Date(),
          dataClasses: ['Honeypot'],
          severity: 'INFO',
          verified: true,
          sourceUrl: 'honeypot'
        }],
        riskScore: 0,
        riskLevel: 'INFO',
        status: 'ACTIVE',
        detectionContext: {
          honeypotType: metadata.honeypotType || 'CREDENTIAL',
          deployedAt: new Date(),
          ...metadata
        }
      });

      // Add to memory cache
      this.config.honeypotIdentifiers.add(identifierHash);

      return {
        success: true,
        honeypotId: honeypot._id,
        identifier: identifierHash
      };

    } catch (error) {
      console.error('[Honeypot] Register honeypot error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Record honeypot trigger
   */
  async recordTrigger(honeypotId, triggerData) {
    try {
      const {
        sourceIP,
        userAgent,
        attemptedPassword,
        geoLocation,
        timestamp = new Date()
      } = triggerData;

      // Update honeypot record
      const honeypot = await CredentialCompromise.findById(honeypotId);
      if (!honeypot) {
        return { success: false, error: 'Honeypot not found' };
      }

      // Record trigger in detection context
      if (!honeypot.detectionContext.triggers) {
        honeypot.detectionContext.triggers = [];
      }

      honeypot.detectionContext.triggers.push({
        sourceIP,
        userAgent,
        attemptedPasswordHash: attemptedPassword ? this.hashIdentifier(attemptedPassword) : null,
        geoLocation,
        timestamp
      });

      await honeypot.save();

      // Check if this is part of larger attack pattern
      await this._checkForAttackPattern(sourceIP, userAgent, timestamp);

      return {
        success: true,
        triggerId: honeypot.detectionContext.triggers.length - 1,
        totalTriggers: honeypot.detectionContext.triggers.length
      };

    } catch (error) {
      console.error('[Honeypot] Record trigger error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if trigger is part of attack pattern
   */
  async _checkForAttackPattern(sourceIP, userAgent, timestamp) {
    try {
      const recentWindow = new Date(timestamp.getTime() - 3600000); // 1 hour window

      // Find recent attacks from same source
      const existingPattern = await CredentialAttackPattern.findOne({
        'attackDetails.sourceIPs': sourceIP,
        'attackDetails.endTime': { $gte: recentWindow },
        status: { $in: ['DETECTED', 'IN_PROGRESS'] }
      });

      if (existingPattern) {
        // Add honeypot trigger to existing pattern
        existingPattern.targetedUsers.push({
          honeypotTriggered: true,
          triggeredAt: timestamp
        });
        await existingPattern.save();

        console.log(`[Honeypot] Added trigger to existing attack pattern ${existingPattern.attackId}`);
      } else {
        // Create new attack pattern if multiple honeypots triggered
        const recentTriggers = await CredentialCompromise.countDocuments({
          compromiseType: 'HONEYPOT',
          'detectionContext.triggers': {
            $elemMatch: {
              sourceIP,
              timestamp: { $gte: recentWindow }
            }
          }
        });

        if (recentTriggers >= 3) {
          // Create new attack pattern
          const pattern = await CredentialAttackPattern.create({
            attackId: `HP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            attackType: 'CREDENTIAL_STUFFING',
            severity: 'HIGH',
            status: 'DETECTED',
            attackDetails: {
              sourceIPs: [sourceIP],
              userAgents: [userAgent],
              startTime: recentWindow,
              endTime: timestamp,
              attackRate: recentTriggers / 3600 // per second
            },
            targetedUsers: [{
              honeypotTriggered: true,
              triggeredAt: timestamp
            }],
            correlationMetadata: {
              honeypotDetection: true,
              triggerCount: recentTriggers
            }
          });

          console.log(`[Honeypot] Created new attack pattern ${pattern.attackId} from ${recentTriggers} triggers`);
        }
      }

    } catch (error) {
      console.error('[Honeypot] Check attack pattern error:', error);
    }
  }

  /**
   * Get honeypot statistics
   */
  async getStatistics(timeWindow = 86400000) {
    try {
      const since = new Date(Date.now() - timeWindow);

      const triggers = await CredentialCompromise.aggregate([
        {
          $match: {
            compromiseType: 'HONEYPOT',
            'detectionContext.triggers.timestamp': { $gte: since }
          }
        },
        {
          $project: {
            triggers: {
              $filter: {
                input: '$detectionContext.triggers',
                cond: { $gte: ['$$this.timestamp', since] }
              }
            }
          }
        },
        {
          $unwind: '$triggers'
        },
        {
          $group: {
            _id: null,
            totalTriggers: { $sum: 1 },
            uniqueIPs: { $addToSet: '$triggers.sourceIP' },
            uniqueUserAgents: { $addToSet: '$triggers.userAgent' }
          }
        }
      ]);

      const stats = triggers[0] || {
        totalTriggers: 0,
        uniqueIPs: [],
        uniqueUserAgents: []
      };

      return {
        success: true,
        timeWindow: timeWindow / 1000, // seconds
        totalHoneypots: this.config.honeypotIdentifiers.size,
        totalTriggers: stats.totalTriggers,
        uniqueIPs: stats.uniqueIPs.length,
        uniqueUserAgents: stats.uniqueUserAgents.length,
        triggersPerHour: (stats.totalTriggers / (timeWindow / 3600000)).toFixed(2)
      };

    } catch (error) {
      console.error('[Honeypot] Get statistics error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Not supported for honeypots
   */
  async checkPasswordHash(passwordHash, hashType) {
    return this.errorResponse('Password hash checking not supported for honeypots', 'UNSUPPORTED');
  }

  async getAllBreaches(identifier) {
    return this.checkCompromise(identifier);
  }

  async getBreachDetails(breachName) {
    return this.errorResponse('Breach details not supported for honeypots', 'UNSUPPORTED');
  }
}

module.exports = HoneypotProvider;
