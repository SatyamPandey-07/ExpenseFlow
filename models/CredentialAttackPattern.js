/**
 * Credential Attack Pattern Model
 * Tracks credential spray, stuffing, and post-compromise activity patterns
 */

const mongoose = require('mongoose');

const credentialAttackPatternSchema = new mongoose.Schema({
  // Attack identification
  attackId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  attackType: {
    type: String,
    required: true,
    enum: [
      'PASSWORD_SPRAY',       // Single password, multiple accounts
      'CREDENTIAL_STUFFING',  // Known compromised creds
      'BRUTE_FORCE',          // Multiple password attempts
      'PRIVILEGE_ESCALATION', // Post-compromise privilege movement
      'LATERAL_MOVEMENT',     // Cross-account access patterns
      'ACCOUNT_ENUMERATION'   // Account discovery attempts
    ],
    index: true
  },

  // Attack metadata
  status: {
    type: String,
    required: true,
    enum: ['DETECTED', 'IN_PROGRESS', 'BLOCKED', 'INVESTIGATING', 'FALSE_POSITIVE'],
    default: 'DETECTED',
    index: true
  },

  // Severity
  severity: {
    type: String,
    required: true,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM'
  },

  confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 50
  },

  // Attack details
  attackDetails: {
    // For password spray
    commonPassword: String,
    targetedAccounts: Number,
    successfulAttempts: Number,
    failedAttempts: Number,

    // For credential stuffing
    compromisedCredentialSource: String,
    credentialCount: Number,
    reuseDetected: Boolean,

    // For privilege escalation
    initialAccessLevel: String,
    targetAccessLevel: String,
    escalationPath: [String],

    // Timing
    startTime: Date,
    endTime: Date,
    duration: Number, // milliseconds
    attemptRate: Number // attempts per second
  },

  // Targeted users/accounts
  targetedUsers: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    username: String,
    email: String,
    attemptCount: Number,
    successful: Boolean,
    timestamp: Date,
    ipAddress: String,
    userAgent: String,
    location: {
      country: String,
      city: String
    }
  }],

  // Source attribution
  sourceAttribution: {
    ipAddresses: [{
      ip: String,
      attemptCount: Number,
      firstSeen: Date,
      lastSeen: Date,
      reputation: {
        type: String,
        enum: ['CLEAN', 'SUSPICIOUS', 'MALICIOUS', 'UNKNOWN']
      }
    }],
    
    userAgents: [String],
    
    geolocation: {
      countries: [String],
      cities: [String],
      suspicious: Boolean // Multiple distant locations
    },

    fingerprints: [String],

    knownThreatActor: {
      identified: Boolean,
      actorId: String,
      actorName: String,
      confidence: Number
    }
  },

  // Detection metadata
  detectionContext: {
    detectedBy: String,
    detectionMethod: {
      type: String,
      enum: ['RATE_ANALYSIS', 'PATTERN_MATCHING', 'ML_MODEL', 'CORRELATION', 'MANUAL']
    },
    detectionRules: [String],
    correlatedEvents: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CredentialAttackPattern'
    }]
  },

  // Cross-session correlation
  correlation: {
    relatedAttacks: [{
      attackId: String,
      relationship: {
        type: String,
        enum: ['SAME_ACTOR', 'SAME_CAMPAIGN', 'FOLLOW_ON', 'COORDINATED']
      },
      confidence: Number
    }],
    
    campaignId: String,
    attackChain: [String],
    
    indicators: [{
      type: String,
      value: String,
      ioc: Boolean // Indicator of Compromise
    }]
  },

  // Impact assessment
  impact: {
    accountsCompromised: Number,
    dataAccessed: [String],
    privilegesEscalated: Number,
    lateralMovement: Boolean,
    estimatedLoss: Number,
    affectedSessions: Number
  },

  // Response
  response: {
    actionTaken: {
      type: String,
      enum: ['NONE', 'RATE_LIMIT', 'BLOCK_IP', 'LOCK_ACCOUNTS', 'ALERT_SECURITY', 'AUTOMATED_MITIGATION']
    },
    actionTakenAt: Date,
    blockedIPs: [String],
    lockedAccounts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    notificationsSent: [{
      userId: mongoose.Schema.Types.ObjectId,
      channel: String,
      sentAt: Date
    }]
  },

  // Resolution
  resolved: {
    type: Boolean,
    default: false
  },
  resolvedAt: Date,
  resolvedBy: String,
  resolutionNotes: String,

  // Metadata
  metadata: {
    tags: [String],
    notes: String,
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    }
  }

}, {
  timestamps: true,
  collection: 'credential_attack_patterns'
});

// Indexes
credentialAttackPatternSchema.index({ attackType: 1, status: 1 });
credentialAttackPatternSchema.index({ severity: 1, status: 1 });
credentialAttackPatternSchema.index({ 'attackDetails.startTime': -1 });
credentialAttackPatternSchema.index({ 'sourceAttribution.ipAddresses.ip': 1 });
credentialAttackPatternSchema.index({ 'targetedUsers.userId': 1 });
credentialAttackPatternSchema.index({ 'correlation.campaignId': 1 });

// Method to add targeted user
credentialAttackPatternSchema.methods.addTargetedUser = async function(userData) {
  this.targetedUsers.push(userData);
  this.attackDetails.targetedAccounts = this.targetedUsers.length;
  
  if (userData.successful) {
    this.attackDetails.successfulAttempts = (this.attackDetails.successfulAttempts || 0) + 1;
    this.impact.accountsCompromised = (this.impact.accountsCompromised || 0) + 1;
  } else {
    this.attackDetails.failedAttempts = (this.attackDetails.failedAttempts || 0) + 1;
  }

  return this.save();
};

// Method to calculate attack rate
credentialAttackPatternSchema.methods.calculateAttackRate = function() {
  if (!this.attackDetails.startTime || !this.attackDetails.endTime) {
    return 0;
  }

  const duration = this.attackDetails.endTime - this.attackDetails.startTime;
  const totalAttempts = (this.attackDetails.successfulAttempts || 0) + 
                        (this.attackDetails.failedAttempts || 0);

  if (duration === 0) return 0;
  
  return (totalAttempts / duration) * 1000; // attempts per second
};

// Method to assess severity
credentialAttackPatternSchema.methods.assessSeverity = function() {
  let score = 0;

  // Success rate
  const successRate = this.attackDetails.successfulAttempts / 
                     (this.attackDetails.targetedAccounts || 1);
  if (successRate > 0.5) score += 40;
  else if (successRate > 0.2) score += 25;
  else if (successRate > 0) score += 10;

  // Attack scale
  if (this.attackDetails.targetedAccounts > 100) score += 30;
  else if (this.attackDetails.targetedAccounts > 50) score += 20;
  else if (this.attackDetails.targetedAccounts > 10) score += 10;

  // Attack type severity
  const criticalTypes = ['PRIVILEGE_ESCALATION', 'LATERAL_MOVEMENT'];
  const highTypes = ['CREDENTIAL_STUFFING', 'PASSWORD_SPRAY'];
  
  if (criticalTypes.includes(this.attackType)) score += 30;
  else if (highTypes.includes(this.attackType)) score += 20;

  // Determine severity
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
};

// Static method to find active attacks
credentialAttackPatternSchema.statics.findActiveAttacks = async function(attackType = null) {
  const query = { 
    status: { $in: ['DETECTED', 'IN_PROGRESS', 'INVESTIGATING'] }
  };
  
  if (attackType) {
    query.attackType = attackType;
  }

  return this.find(query).sort({ createdAt: -1 });
};

// Static method to correlate attacks
credentialAttackPatternSchema.statics.correlateAttacks = async function(attackId, timeWindow = 3600000) {
  const attack = await this.findOne({ attackId });
  if (!attack) return [];

  const timeRange = {
    $gte: new Date(attack.createdAt.getTime() - timeWindow),
    $lte: new Date(attack.createdAt.getTime() + timeWindow)
  };

  // Find attacks with overlapping IPs or users
  const ipAddresses = attack.sourceAttribution.ipAddresses.map(ip => ip.ip);
  const userIds = attack.targetedUsers.map(u => u.userId);

  const correlatedAttacks = await this.find({
    _id: { $ne: attack._id },
    createdAt: timeRange,
    $or: [
      { 'sourceAttribution.ipAddresses.ip': { $in: ipAddresses } },
      { 'targetedUsers.userId': { $in: userIds } }
    ]
  });

  return correlatedAttacks;
};

// Static method to detect spray pattern
credentialAttackPatternSchema.statics.detectSprayPattern = async function(
  ipAddress,
  timeWindow = 300000, // 5 minutes
  threshold = 10
) {
  const since = new Date(Date.now() - timeWindow);

  const attempts = await this.aggregate([
    {
      $match: {
        'sourceAttribution.ipAddresses.ip': ipAddress,
        'attackDetails.startTime': { $gte: since }
      }
    },
    {
      $group: {
        _id: '$sourceAttribution.ipAddresses.ip',
        totalAttempts: { $sum: '$attackDetails.targetedAccounts' },
        uniqueUsers: { $addToSet: '$targetedUsers.userId' }
      }
    }
  ]);

  if (attempts.length > 0 && attempts[0].totalAttempts >= threshold) {
    return {
      isSpray: true,
      attempts: attempts[0].totalAttempts,
      uniqueUsers: attempts[0].uniqueUsers.length
    };
  }

  return { isSpray: false };
};

module.exports = mongoose.model('CredentialAttackPattern', credentialAttackPatternSchema);
