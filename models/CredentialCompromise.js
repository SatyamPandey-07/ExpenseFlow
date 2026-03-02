/**
 * Credential Compromise Model
 * Tracks compromised credentials from breach feeds and internal detections
 */

const mongoose = require('mongoose');

const credentialCompromiseSchema = new mongoose.Schema({
  // Identifier (hashed)
  identifier: {
    type: String,
    required: true,
    index: true
  },

  identifierType: {
    type: String,
    required: true,
    enum: ['EMAIL', 'USERNAME', 'PASSWORD_HASH', 'PHONE'],
    index: true
  },

  // Breach/Compromise details
  breachSources: [{
    provider: {
      type: String,
      enum: ['HIBP', 'INTERNAL', 'THIRD_PARTY', 'MANUAL', 'HONEYPOT', 'DARKWEB']
    },
    breachName: String,
    breachDate: Date,
    discoveredDate: Date,
    dataClasses: [String], // Email, Password, Phone, DOB, etc.
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    },
    verified: Boolean,
    sourceUrl: String,
    compromisedRecordCount: Number
  }],

  // Compromise metadata
  compromiseType: {
    type: String,
    required: true,
    enum: [
      'BREACH',           // Public data breach
      'PASTE',            // Paste site exposure
      'CREDENTIAL_STUFFING', // Detected stuffing attempt
      'PASSWORD_SPRAY',   // Spray attack
      'PHISHING',         // Phishing campaign
      'MALWARE',          // Malware theft
      'INTERNAL_LEAK',    // Internal detection
      'HONEYPOT'          // Honeypot detection
    ]
  },

  // Risk assessment
  riskScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 0,
    index: true
  },

  riskLevel: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM',
    index: true
  },

  // Status
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'RESOLVED', 'FALSE_POSITIVE', 'INVESTIGATING'],
    default: 'ACTIVE',
    index: true
  },

  // Associated users
  affectedUsers: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notified: {
      type: Boolean,
      default: false
    },
    notifiedAt: Date,
    actionTaken: {
      type: String,
      enum: ['NONE', 'PASSWORD_RESET_REQUIRED', 'ACCOUNT_LOCKED', 'MFA_ENFORCED', 'MONITORING']
    },
    actionTakenAt: Date,
    userAcknowledged: Boolean,
    acknowledgedAt: Date
  }],

  // Detection context
  detectionContext: {
    detectedBy: String,
    detectionMethod: String,
    confidence: Number,
    ipAddress: String,
    userAgent: String,
    location: {
      country: String,
      city: String,
      latitude: Number,
      longitude: Number
    }
  },

  // Related compromises (for correlation)
  relatedCompromises: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CredentialCompromise'
  }],

  // Exposure details
  exposureDetails: {
    passwordPlaintext: Boolean,
    passwordHashed: Boolean,
    hashAlgorithm: String,
    saltUsed: Boolean,
    additionalDataExposed: [String],
    publiclyAccessible: Boolean
  },

  // Resolution
  resolvedAt: Date,
  resolvedBy: String,
  resolutionNotes: String,

  // Metadata
  expiresAt: {
    type: Date,
    index: true
  },

  metadata: {
    sourceRef: String,
    tags: [String],
    notes: String
  }

}, {
  timestamps: true,
  collection: 'credential_compromises'
});

// Indexes for performance
credentialCompromiseSchema.index({ identifier: 1, status: 1 });
credentialCompromiseSchema.index({ 'affectedUsers.userId': 1, status: 1 });
credentialCompromiseSchema.index({ riskScore: -1, status: 1 });
credentialCompromiseSchema.index({ createdAt: -1, status: 1 });
credentialCompromiseSchema.index({ compromiseType: 1, status: 1 });

// TTL index for expired compromises
credentialCompromiseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for active breach count
credentialCompromiseSchema.virtual('activeBreachCount').get(function() {
  return this.breachSources.filter(b => b.verified).length;
});

// Method to check if compromise is stale
credentialCompromiseSchema.methods.isStale = function(staleDays = 90) {
  const daysSinceDetection = (Date.now() - this.createdAt.getTime()) / (24 * 60 * 60 * 1000);
  return daysSinceDetection > staleDays;
};

// Method to add breach source
credentialCompromiseSchema.methods.addBreachSource = async function(breachData) {
  this.breachSources.push(breachData);
  
  // Recalculate risk score
  this.riskScore = this._calculateRiskScore();
  this.riskLevel = this._determineRiskLevel(this.riskScore);
  
  return this.save();
};

// Method to mark user as notified
credentialCompromiseSchema.methods.markUserNotified = async function(userId) {
  const user = this.affectedUsers.find(u => u.userId.toString() === userId.toString());
  if (user) {
    user.notified = true;
    user.notifiedAt = new Date();
    return this.save();
  }
};

// Internal method to calculate risk score
credentialCompromiseSchema.methods._calculateRiskScore = function() {
  let score = 50; // Base score

  // Breach severity
  const highSeverityBreaches = this.breachSources.filter(b => 
    b.severity === 'CRITICAL' || b.severity === 'HIGH'
  ).length;
  score += (highSeverityBreaches * 15);

  // Compromise type
  const criticalTypes = ['CREDENTIAL_STUFFING', 'PASSWORD_SPRAY', 'PHISHING'];
  if (criticalTypes.includes(this.compromiseType)) {
    score += 20;
  }

  // Exposure details
  if (this.exposureDetails?.passwordPlaintext) {
    score += 25;
  } else if (this.exposureDetails?.passwordHashed && !this.exposureDetails?.saltUsed) {
    score += 15;
  }

  // Publicly accessible
  if (this.exposureDetails?.publiclyAccessible) {
    score += 10;
  }

  // Multiple breaches
  if (this.breachSources.length > 2) {
    score += 10;
  }

  // Recent detection (more critical)
  const daysSinceDetection = (Date.now() - this.createdAt.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceDetection < 7) {
    score += 10;
  }

  return Math.min(100, score);
};

// Internal method to determine risk level
credentialCompromiseSchema.methods._determineRiskLevel = function(score) {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
};

// Static method to find compromises by email
credentialCompromiseSchema.statics.findByEmail = async function(emailHash) {
  return this.find({
    identifier: emailHash,
    identifierType: 'EMAIL',
    status: 'ACTIVE'
  }).sort({ createdAt: -1 });
};

// Static method to find active compromises for user
credentialCompromiseSchema.statics.findActiveForUser = async function(userId) {
  return this.find({
    'affectedUsers.userId': userId,
    status: 'ACTIVE'
  }).sort({ riskScore: -1 });
};

// Static method to get compromise statistics
credentialCompromiseSchema.statics.getStatistics = async function(timeRange = 30) {
  const since = new Date(Date.now() - (timeRange * 24 * 60 * 60 * 1000));

  const stats = await this.aggregate([
    {
      $match: {
        createdAt: { $gte: since }
      }
    },
    {
      $group: {
        _id: null,
        totalCompromises: { $sum: 1 },
        criticalCount: {
          $sum: { $cond: [{ $eq: ['$riskLevel', 'CRITICAL'] }, 1, 0] }
        },
        highCount: {
          $sum: { $cond: [{ $eq: ['$riskLevel', 'HIGH'] }, 1, 0] }
        },
        resolvedCount: {
          $sum: { $cond: [{ $eq: ['$status', 'RESOLVED'] }, 1, 0] }
        },
        avgRiskScore: { $avg: '$riskScore' },
        totalAffectedUsers: { $sum: { $size: '$affectedUsers' } }
      }
    }
  ]);

  return stats.length > 0 ? stats[0] : null;
};

module.exports = mongoose.model('CredentialCompromise', credentialCompromiseSchema);
