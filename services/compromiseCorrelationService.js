/**
 * Compromise Correlation Service
 * Cross-session correlation and attack pattern analysis
 */

const CredentialCompromise = require('../models/CredentialCompromise');
const CredentialAttackPattern = require('../models/CredentialAttackPattern');
const crypto = require('crypto');

class CompromiseCorrelationService {
  constructor() {
    this.config = {
      correlationWindow: 3600000, // 1 hour
      sprayThreshold: 5, // Min users for spray detection
      stuffingThreshold: 10, // Min attempts for stuffing detection
      ipClusterRadius: 24, // CIDR for IP clustering
      minCorrelationScore: 0.6
    };
  }

  /**
   * Correlate login attempt with known compromises and attacks
   */
  async correlateLoginAttempt(attempt) {
    try {
      const {
        userId,
        email,
        success,
        sourceIP,
        userAgent,
        timestamp = new Date(),
        geoLocation
      } = attempt;

      const emailHash = this._hashIdentifier(email);

      // Check if credential is compromised
      const compromise = await CredentialCompromise.findOne({
        identifier: emailHash,
        identifierType: 'EMAIL',
        status: 'ACTIVE'
      }).lean();

      // Check for ongoing attack patterns
      const attackPatterns = await this._findRelatedAttackPatterns(sourceIP, userAgent, timestamp);

      // Calculate correlation score
      const correlationScore = this._calculateCorrelationScore({
        compromise,
        attackPatterns,
        attempt
      });

      // Determine risk boost
      const riskBoost = this._calculateRiskBoost(correlationScore, compromise, attackPatterns);

      return {
        success: true,
        correlated: correlationScore >= this.config.minCorrelationScore,
        correlationScore,
        riskBoost,
        compromise: compromise ? {
          compromiseId: compromise._id,
          riskScore: compromise.riskScore,
          breachCount: compromise.breachSources.length
        } : null,
        attackPatterns: attackPatterns.map(ap => ({
          attackId: ap.attackId,
          attackType: ap.attackType,
          severity: ap.severity
        })),
        recommendations: this._generateRecommendations(correlationScore, compromise, attackPatterns)
      };

    } catch (error) {
      console.error('[CorrelationService] Correlate login attempt error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Find related attack patterns
   */
  async _findRelatedAttackPatterns(sourceIP, userAgent, timestamp) {
    try {
      const windowStart = new Date(timestamp.getTime() - this.config.correlationWindow);

      const patterns = await CredentialAttackPattern.find({
        $or: [
          { 'attackDetails.sourceIPs': sourceIP },
          { 'attackDetails.userAgents': userAgent }
        ],
        'attackDetails.endTime': { $gte: windowStart },
        status: { $in: ['DETECTED', 'IN_PROGRESS'] }
      }).lean();

      return patterns;

    } catch (error) {
      console.error('[CorrelationService] Find attack patterns error:', error);
      return [];
    }
  }

  /**
   * Calculate correlation score
   */
  _calculateCorrelationScore({ compromise, attackPatterns, attempt }) {
    let score = 0;

    // Compromised credential (40 points)
    if (compromise) {
      score += 0.4;
      
      // Boost for high-risk compromise
      if (compromise.riskScore >= 80) score += 0.1;
    }

    // Part of attack pattern (30 points)
    if (attackPatterns.length > 0) {
      score += 0.3;
      
      // Boost for severe attacks
      const hasCritical = attackPatterns.some(ap => ap.severity === 'CRITICAL');
      if (hasCritical) score += 0.1;
    }

    // Failed login attempt (20 points)
    if (!attempt.success) {
      score += 0.2;
    }

    // Suspicious characteristics (10 points)
    if (this._isSuspiciousAttempt(attempt)) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Check if attempt is suspicious
   */
  _isSuspiciousAttempt(attempt) {
    const suspicious = [];

    // Uncommon user agent
    if (attempt.userAgent && attempt.userAgent.includes('curl')) {
      suspicious.push('automated_client');
    }

    // Known attack IPs (simplified check)
    if (attempt.sourceIP && attempt.sourceIP.startsWith('10.')) {
      // Private IP - could be proxy/VPN
      suspicious.push('private_ip');
    }

    return suspicious.length > 0;
  }

  /**
   * Calculate risk boost for trust scoring
   */
  _calculateRiskBoost(correlationScore, compromise, attackPatterns) {
    let boost = 0;

    // Compromised credential risks
    if (compromise) {
      boost += compromise.riskScore * 0.3; // Up to 30 points

      // Extra boost for recent breaches
      const recentBreach = compromise.breachSources.some(b => {
        const breachDate = new Date(b.breachDate);
        const daysAgo = (Date.now() - breachDate.getTime()) / (24 * 60 * 60 * 1000);
        return daysAgo < 90;
      });

      if (recentBreach) boost += 10;
    }

    // Attack pattern risks
    if (attackPatterns.length > 0) {
      const maxSeverity = this._getMaxSeverity(attackPatterns);
      
      switch (maxSeverity) {
        case 'CRITICAL': boost += 40; break;
        case 'HIGH': boost += 30; break;
        case 'MEDIUM': boost += 20; break;
        case 'LOW': boost += 10; break;
      }
    }

    // Correlation strength multiplier
    boost *= correlationScore;

    return Math.round(boost);
  }

  /**
   * Get maximum severity from patterns
   */
  _getMaxSeverity(patterns) {
    const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
    
    for (const severity of severityOrder) {
      if (patterns.some(p => p.severity === severity)) {
        return severity;
      }
    }
    
    return 'INFO';
  }

  /**
   * Generate recommendations based on correlation
   */
  _generateRecommendations(score, compromise, attackPatterns) {
    const recommendations = [];

    if (score >= 0.8) {
      recommendations.push({
        action: 'BLOCK_LOGIN',
        priority: 'CRITICAL',
        reason: 'High correlation with active attack pattern'
      });
    } else if (score >= 0.6) {
      recommendations.push({
        action: 'REQUIRE_MFA',
        priority: 'HIGH',
        reason: 'Moderate correlation detected'
      });
    }

    if (compromise && compromise.riskScore >= 70) {
      recommendations.push({
        action: 'FORCE_PASSWORD_RESET',
        priority: 'HIGH',
        reason: 'Credential appears in high-risk breach'
      });
    }

    if (attackPatterns.length > 0) {
      const sprayPatterns = attackPatterns.filter(ap => ap.attackType === 'PASSWORD_SPRAY');
      if (sprayPatterns.length > 0) {
        recommendations.push({
          action: 'RATE_LIMIT',
          priority: 'MEDIUM',
          reason: 'Source involved in password spray attack'
        });
      }
    }

    return recommendations;
  }

  /**
   * Correlate multiple user accounts for lateral movement detection
   */
  async detectLateralMovement(sessionData) {
    try {
      const {
        userId,
        sourceIP,
        userAgent,
        timestamp = new Date(),
        privilegeLevel
      } = sessionData;

      const recentWindow = new Date(timestamp.getTime() - this.config.correlationWindow);

      // Find other users accessed from same source
      const relatedUsers = await this._findUsersFromSource(sourceIP, userAgent, recentWindow);

      if (relatedUsers.length <= 1) {
        return {
          success: true,
          lateralMovement: false,
          relatedUsers: []
        };
      }

      // Check for privilege escalation
      const privilegeEscalation = this._detectPrivilegeEscalation(relatedUsers, privilegeLevel);

      // Check if users are compromised
      const compromisedUsers = await this._checkUsersCompromised(relatedUsers);

      return {
        success: true,
        lateralMovement: relatedUsers.length > 1,
        relatedUserCount: relatedUsers.length,
        privilegeEscalation,
        compromisedCount: compromisedUsers.length,
        severity: this._assessLateralMovementSeverity(relatedUsers.length, privilegeEscalation, compromisedUsers.length),
        recommendation: relatedUsers.length >= 3 ? 'INVESTIGATE' : 'MONITOR'
      };

    } catch (error) {
      console.error('[CorrelationService] Detect lateral movement error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Find users accessed from same source
   */
  async _findUsersFromSource(sourceIP, userAgent, since) {
    // This would query session logs - simplified here
    // In production, integrate with session management system
    return [];
  }

  /**
   * Detect privilege escalation
   */
  _detectPrivilegeEscalation(users, currentPrivilege) {
    // Check if privilege increased across accounts
    const privileges = ['user', 'admin', 'superadmin'];
    const currentIndex = privileges.indexOf(currentPrivilege);
    
    return users.some(u => {
      const userIndex = privileges.indexOf(u.privilegeLevel);
      return userIndex > currentIndex;
    });
  }

  /**
   * Check if users are compromised
   */
  async _checkUsersCompromised(users) {
    try {
      const userIds = users.map(u => u.userId);
      
      const compromised = await CredentialCompromise.find({
        'affectedUsers.userId': { $in: userIds },
        status: 'ACTIVE',
        riskScore: { $gte: 60 }
      }).lean();

      return compromised;

    } catch (error) {
      console.error('[CorrelationService] Check users compromised error:', error);
      return [];
    }
  }

  /**
   * Assess lateral movement severity
   */
  _assessLateralMovementSeverity(userCount, privilegeEscalation, compromisedCount) {
    let score = userCount * 10;
    
    if (privilegeEscalation) score += 30;
    if (compromisedCount > 0) score += compromisedCount * 20;
    
    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Batch correlate multiple attempts for pattern detection
   */
  async batchCorrelate(attempts) {
    try {
      // Group by source
      const bySource = new Map();
      attempts.forEach(attempt => {
        const key = `${attempt.sourceIP}:${attempt.userAgent}`;
        if (!bySource.has(key)) {
          bySource.set(key, []);
        }
        bySource.get(key).push(attempt);
      });

      // Analyze each source
      const results = [];
      for (const [source, sourceAttempts] of bySource) {
        const analysis = await this._analyzeSourcePattern(sourceAttempts);
        results.push({
          source,
          attemptCount: sourceAttempts.length,
          ...analysis
        });
      }

      // Detect coordinated attacks
      const coordinated = this._detectCoordinatedAttack(results);

      return {
        success: true,
        totalAttempts: attempts.length,
        uniqueSources: bySource.size,
        sourceAnalysis: results,
        coordinated,
        severity: this._assessBatchSeverity(results, coordinated)
      };

    } catch (error) {
      console.error('[CorrelationService] Batch correlate error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Analyze pattern from single source
   */
  async _analyzeSourcePattern(attempts) {
    const uniqueUsers = new Set(attempts.map(a => a.email)).size;
    const failureRate = attempts.filter(a => !a.success).length / attempts.length;
    const timeSpan = Math.max(...attempts.map(a => a.timestamp)) - Math.min(...attempts.map(a => a.timestamp));
    const rate = attempts.length / (timeSpan / 1000); // attempts per second

    let patternType = null;
    if (uniqueUsers > this.config.sprayThreshold && failureRate > 0.8) {
      patternType = 'PASSWORD_SPRAY';
    } else if (uniqueUsers === 1 && attempts.length > this.config.stuffingThreshold) {
      patternType = 'CREDENTIAL_STUFFING';
    } else if (rate > 5) {
      patternType = 'BRUTE_FORCE';
    }

    return {
      patternType,
      uniqueUsers,
      failureRate,
      rate: rate.toFixed(2),
      timeSpan
    };
  }

  /**
   * Detect coordinated attack across sources
   */
  _detectCoordinatedAttack(results) {
    // Check for same pattern type from multiple sources
    const patternCounts = {};
    results.forEach(r => {
      if (r.patternType) {
        patternCounts[r.patternType] = (patternCounts[r.patternType] || 0) + 1;
      }
    });

    const coordinated = Object.entries(patternCounts).some(([type, count]) => count >= 3);

    return {
      detected: coordinated,
      patterns: patternCounts
    };
  }

  /**
   * Assess overall batch severity
   */
  _assessBatchSeverity(results, coordinated) {
    let score = results.length * 5;
    
    if (coordinated.detected) score += 40;
    
    const hasSpray = results.some(r => r.patternType === 'PASSWORD_SPRAY');
    if (hasSpray) score += 20;
    
    const highRateCount = results.filter(r => parseFloat(r.rate) > 10).length;
    score += highRateCount * 10;
    
    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Hash identifier
   */
  _hashIdentifier(identifier) {
    return crypto.createHash('sha256').update(identifier.toLowerCase()).digest('hex');
  }
}

module.exports = new CompromiseCorrelationService();
