/**
 * Attack Pattern Detection Service
 * Real-time detection of credential-based attacks
 */

const CredentialAttackPattern = require('../models/CredentialAttackPattern');
const CredentialCompromise = require('../models/CredentialCompromise');

class AttackPatternDetectionService {
  constructor() {
    this.config = {
      sprayDetection: {
        uniqueUsersThreshold: 5,
        timeWindow: 300000, // 5 minutes
        failureRateThreshold: 0.8,
        maxAttemptsPerUser: 2
      },
      stuffingDetection: {
        attemptsThreshold: 10,
        timeWindow: 600000, // 10 minutes
        velocityThreshold: 5 // attempts per minute
      },
      bruteForceDetection: {
        attemptsThreshold: 20,
        timeWindow: 300000, // 5 minutes
        singleUserWindow: 60000 // 1 minute
      }
    };

    // In-memory buffers for recent attempts (production: use Redis)
    this.attemptBuffers = new Map();
    
    // Cleanup old buffers every 5 minutes
    setInterval(() => this._cleanupBuffers(), 300000);
  }

  /**
   * Process login attempt and detect patterns
   */
  async processLoginAttempt(attempt) {
    try {
      const {
        email,
        success,
        sourceIP,
        userAgent,
        timestamp = new Date(),
        geoLocation
      } = attempt;

      // Buffer the attempt
      this._bufferAttempt(sourceIP, attempt);

      // Get recent attempts from this source
      const recentAttempts = this._getRecentAttempts(sourceIP);

      // Run detection algorithms in parallel
      const [sprayResult, stuffingResult, bruteForceResult] = await Promise.all([
        this._detectPasswordSpray(sourceIP, recentAttempts),
        this._detectCredentialStuffing(sourceIP, email, recentAttempts),
        this._detectBruteForce(sourceIP, email, recentAttempts)
      ]);

      // Determine detected pattern
      const detected = sprayResult.detected || stuffingResult.detected || bruteForceResult.detected;

      if (detected) {
        // Record or update attack pattern
        const pattern = await this._recordAttackPattern({
          sourceIP,
          userAgent,
          timestamp,
          geoLocation,
          sprayResult,
          stuffingResult,
          bruteForceResult,
          recentAttempts
        });

        return {
          success: true,
          detected: true,
          attackId: pattern?.attackId,
          attackType: pattern?.attackType,
          severity: pattern?.severity,
          shouldBlock: this._shouldBlockSource(pattern),
          recommendations: this._generateRecommendations(pattern)
        };
      }

      return {
        success: true,
        detected: false,
        monitoredAttemptsCount: recentAttempts.length
      };

    } catch (error) {
      console.error('[AttackDetectionService] Process login attempt error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Detect password spray attack
   */
  async _detectPasswordSpray(sourceIP, attempts) {
    const config = this.config.sprayDetection;

    // Get unique users targeted
    const uniqueUsers = new Set(attempts.map(a => a.email));

    if (uniqueUsers.size < config.uniqueUsersThreshold) {
      return { detected: false };
    }

    // Check attempts per user (spray uses few attempts per user)
    const attemptsByUser = new Map();
    attempts.forEach(a => {
      attemptsByUser.set(a.email, (attemptsByUser.get(a.email) || 0) + 1);
    });

    const lowAttemptsPerUser = Array.from(attemptsByUser.values())
      .every(count => count <= config.maxAttemptsPerUser);

    // Check failure rate
    const failures = attempts.filter(a => !a.success).length;
    const failureRate = failures / attempts.length;

    const detected = lowAttemptsPerUser && 
                    failureRate >= config.failureRateThreshold &&
                    uniqueUsers.size >= config.uniqueUsersThreshold;

    return {
      detected,
      uniqueUsers: uniqueUsers.size,
      failureRate,
      totalAttempts: attempts.length,
      confidence: detected ? this._calculateSprayConfidence(uniqueUsers.size, failureRate) : 0
    };
  }

  /**
   * Calculate spray detection confidence
   */
  _calculateSprayConfidence(uniqueUsers, failureRate) {
    let confidence = 0;

    // More unique users = higher confidence
    if (uniqueUsers >= 20) confidence += 40;
    else if (uniqueUsers >= 10) confidence += 30;
    else confidence += 20;

    // High failure rate = higher confidence
    if (failureRate >= 0.95) confidence += 35;
    else if (failureRate >= 0.85) confidence += 25;
    else confidence += 15;

    // Pattern consistency bonus
    confidence += 25;

    return Math.min(confidence, 100);
  }

  /**
   * Detect credential stuffing attack
   */
  async _detectCredentialStuffing(sourceIP, email, attempts) {
    const config = this.config.stuffingDetection;

    // Filter attempts for this email
    const emailAttempts = attempts.filter(a => a.email === email);

    if (emailAttempts.length < config.attemptsThreshold) {
      return { detected: false };
    }

    // Calculate velocity (attempts per minute)
    const timeSpan = Math.max(...emailAttempts.map(a => a.timestamp)) - 
                    Math.min(...emailAttempts.map(a => a.timestamp));
    const velocity = (emailAttempts.length / (timeSpan / 60000));

    // Check if email is in known breaches
    const emailHash = this._hashIdentifier(email);
    const knownCompromise = await CredentialCompromise.findOne({
      identifier: emailHash,
      identifierType: 'EMAIL',
      status: 'ACTIVE'
    }).lean();

    const detected = velocity >= config.velocityThreshold && 
                    emailAttempts.length >= config.attemptsThreshold;

    return {
      detected,
      attempts: emailAttempts.length,
      velocity: velocity.toFixed(2),
      knownCompromise: !!knownCompromise,
      confidence: detected ? this._calculateStuffingConfidence(velocity, knownCompromise) : 0
    };
  }

  /**
   * Calculate stuffing detection confidence
   */
  _calculateStuffingConfidence(velocity, knownCompromise) {
    let confidence = 0;

    // High velocity = automated
    if (velocity >= 10) confidence += 40;
    else if (velocity >= 5) confidence += 30;
    else confidence += 20;

    // Known compromise = likely stuffing
    if (knownCompromise) confidence += 40;
    else confidence += 20;

    // Pattern consistency
    confidence += 20;

    return Math.min(confidence, 100);
  }

  /**
   * Detect brute force attack
   */
  async _detectBruteForce(sourceIP, email, attempts) {
    const config = this.config.bruteForceDetection;

    // Filter attempts for this email
    const emailAttempts = attempts.filter(a => a.email === email);

    if (emailAttempts.length < config.attemptsThreshold) {
      return { detected: false };
    }

    // Check recent burst (within 1 minute)
    const now = Date.now();
    const recentBurst = emailAttempts.filter(a => 
      now - a.timestamp < config.singleUserWindow
    );

    const detected = emailAttempts.length >= config.attemptsThreshold;

    return {
      detected,
      attempts: emailAttempts.length,
      recentBurst: recentBurst.length,
      confidence: detected ? this._calculateBruteForceConfidence(emailAttempts.length, recentBurst.length) : 0
    };
  }

  /**
   * Calculate brute force confidence
   */
  _calculateBruteForceConfidence(totalAttempts, burstAttempts) {
    let confidence = 0;

    // High total attempts
    if (totalAttempts >= 50) confidence += 40;
    else if (totalAttempts >= 30) confidence += 30;
    else confidence += 20;

    // Recent burst indicates active attack
    if (burstAttempts >= 10) confidence += 35;
    else if (burstAttempts >= 5) confidence += 25;
    else confidence += 15;

    // Pattern bonus
    confidence += 25;

    return Math.min(confidence, 100);
  }

  /**
   * Record attack pattern
   */
  async _recordAttackPattern(data) {
    try {
      const {
        sourceIP,
        userAgent,
        timestamp,
        geoLocation,
        sprayResult,
        stuffingResult,
        bruteForceResult,
        recentAttempts
      } = data;

      // Determine attack type
      let attackType = 'BRUTE_FORCE';
      let confidence = 0;

      if (sprayResult.detected && sprayResult.confidence > confidence) {
        attackType = 'PASSWORD_SPRAY';
        confidence = sprayResult.confidence;
      }
      if (stuffingResult.detected && stuffingResult.confidence > confidence) {
        attackType = 'CREDENTIAL_STUFFING';
        confidence = stuffingResult.confidence;
      }
      if (bruteForceResult.detected && bruteForceResult.confidence > confidence) {
        attackType = 'BRUTE_FORCE';
        confidence = bruteForceResult.confidence;
      }

      // Check for existing pattern from this source
      const existingPattern = await CredentialAttackPattern.findOne({
        'attackDetails.sourceIPs': sourceIP,
        status: 'IN_PROGRESS',
        'attackDetails.endTime': { $gte: new Date(Date.now() - 600000) } // 10 min window
      });

      if (existingPattern) {
        // Update existing pattern
        existingPattern.attackDetails.endTime = timestamp;
        existingPattern.attackDetails.attackCount += 1;
        existingPattern.attackDetails.attackRate = this._calculateAttackRate(existingPattern);
        
        // Add user agents if new
        if (!existingPattern.attackDetails.userAgents.includes(userAgent)) {
          existingPattern.attackDetails.userAgents.push(userAgent);
        }

        // Update severity
        existingPattern.severity = this._assessAttackSeverity(
          existingPattern.targetedUsers.length,
          existingPattern.attackDetails.attackCount
        );

        await existingPattern.save();
        return existingPattern;

      } else {
        // Create new pattern
        const pattern = await CredentialAttackPattern.create({
          attackId: `${attackType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          attackType,
          severity: this._assessAttackSeverity(
            new Set(recentAttempts.map(a => a.email)).size,
            recentAttempts.length
          ),
          status: 'IN_PROGRESS',
          attackDetails: {
            sourceIPs: [sourceIP],
            userAgents: [userAgent],
            startTime: new Date(Math.min(...recentAttempts.map(a => a.timestamp))),
            endTime: timestamp,
            attackCount: recentAttempts.length,
            successCount: recentAttempts.filter(a => a.success).length,
            attackRate: recentAttempts.length / 60 // per second
          },
          targetedUsers: Array.from(new Set(recentAttempts.map(a => a.email))).map(email => ({
            email,
            attemptCount: recentAttempts.filter(a => a.email === email).length
          })),
          geoLocation,
          detectionConfidence: confidence,
          correlationMetadata: {
            sprayScore: sprayResult.confidence || 0,
            stuffingScore: stuffingResult.confidence || 0,
            bruteForceScore: bruteForceResult.confidence || 0
          }
        });

        console.log(`[AttackDetectionService] New ${attackType} pattern detected: ${pattern.attackId}`);
        return pattern;
      }

    } catch (error) {
      console.error('[AttackDetectionService] Record attack pattern error:', error);
      return null;
    }
  }

  /**
   * Calculate attack rate
   */
  _calculateAttackRate(pattern) {
    const duration = (pattern.attackDetails.endTime - pattern.attackDetails.startTime) / 1000;
    return duration > 0 ? pattern.attackDetails.attackCount / duration : 0;
  }

  /**
   * Assess attack severity
   */
  _assessAttackSeverity(targetedUsers, attemptCount) {
    let score = 0;

    // Targeted users factor
    if (targetedUsers >= 50) score += 40;
    else if (targetedUsers >= 20) score += 30;
    else if (targetedUsers >= 10) score += 20;
    else score += 10;

    // Attempt count factor
    if (attemptCount >= 100) score += 40;
    else if (attemptCount >= 50) score += 30;
    else if (attemptCount >= 20) score += 20;
    else score += 10;

    // Impact factor
    score += 20;

    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Should block source
   */
  _shouldBlockSource(pattern) {
    if (!pattern) return false;

    // Block critical severity
    if (pattern.severity === 'CRITICAL') return true;

    // Block high confidence attacks
    if (pattern.detectionConfidence >= 85) return true;

    // Block high-rate attacks
    if (pattern.attackDetails.attackRate > 10) return true;

    return false;
  }

  /**
   * Generate recommendations
   */
  _generateRecommendations(pattern) {
    const recommendations = [];

    if (pattern.severity === 'CRITICAL' || pattern.severity === 'HIGH') {
      recommendations.push({
        action: 'BLOCK_IP',
        target: pattern.attackDetails.sourceIPs,
        duration: '24h',
        priority: 'IMMEDIATE'
      });
    }

    if (pattern.attackType === 'PASSWORD_SPRAY') {
      recommendations.push({
        action: 'ENABLE_RATE_LIMITING',
        target: 'LOGIN_ENDPOINT',
        priority: 'HIGH'
      });
    }

    if (pattern.targetedUsers.length > 20) {
      recommendations.push({
        action: 'NOTIFY_USERS',
        target: pattern.targetedUsers.map(u => u.email),
        priority: 'MEDIUM'
      });
    }

    return recommendations;
  }

  /**
   * Buffer attempt in memory
   */
  _bufferAttempt(sourceIP, attempt) {
    if (!this.attemptBuffers.has(sourceIP)) {
      this.attemptBuffers.set(sourceIP, []);
    }

    this.attemptBuffers.get(sourceIP).push({
      email: attempt.email,
      success: attempt.success,
      timestamp: attempt.timestamp || Date.now(),
      userAgent: attempt.userAgent
    });

    // Keep only recent attempts (last 10 minutes)
    const cutoff = Date.now() - 600000;
    this.attemptBuffers.set(
      sourceIP,
      this.attemptBuffers.get(sourceIP).filter(a => a.timestamp > cutoff)
    );
  }

  /**
   * Get recent attempts from buffer
   */
  _getRecentAttempts(sourceIP) {
    return this.attemptBuffers.get(sourceIP) || [];
  }

  /**
   * Cleanup old buffers
   */
  _cleanupBuffers() {
    const cutoff = Date.now() - 600000;
    
    for (const [sourceIP, attempts] of this.attemptBuffers) {
      const recent = attempts.filter(a => a.timestamp > cutoff);
      
      if (recent.length === 0) {
        this.attemptBuffers.delete(sourceIP);
      } else {
        this.attemptBuffers.set(sourceIP, recent);
      }
    }
  }

  /**
   * Hash identifier
   */
  _hashIdentifier(identifier) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(identifier.toLowerCase()).digest('hex');
  }

  /**
   * Get attack statistics
   */
  async getAttackStatistics(timeWindow = 86400000) {
    try {
      const since = new Date(Date.now() - timeWindow);

      const stats = await CredentialAttackPattern.aggregate([
        {
          $match: {
            createdAt: { $gte: since }
          }
        },
        {
          $group: {
            _id: '$attackType',
            count: { $sum: 1 },
            totalTargetedUsers: { $sum: { $size: '$targetedUsers' } },
            avgSeverity: { $avg: { $cond: [
              { $eq: ['$severity', 'CRITICAL'] }, 4,
              { $cond: [
                { $eq: ['$severity', 'HIGH'] }, 3,
                { $cond: [
                  { $eq: ['$severity', 'MEDIUM'] }, 2, 1
                ]}
              ]}
            ]}},
            attacks: { $push: { attackId: '$attackId', severity: '$severity', createdAt: '$createdAt' } }
          }
        }
      ]);

      return {
        success: true,
        timeWindow: timeWindow / 1000,
        stats
      };

    } catch (error) {
      console.error('[AttackDetectionService] Get statistics error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new AttackPatternDetectionService();
