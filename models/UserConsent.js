const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * User Consent Tracking Model
 * Tracks user consent for GDPR, CCPA, and other privacy regulations
 * Issue #920: Compliance & Audit Logging Framework
 */

const userConsentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  consentType: {
    type: String,
    required: true,
    enum: [
      'terms_of_service',
      'privacy_policy',
      'data_processing',
      'marketing_communications',
      'analytics_tracking',
      'cookie_usage',
      'data_sharing',
      'third_party_integrations',
      'biometric_data',
      'health_data',
      'financial_data_processing',
      'cross_border_data_transfer',
      'automated_decision_making',
      'profiling'
    ],
    index: true
  },
  consentGiven: {
    type: Boolean,
    required: true,
    default: false
  },
  consentVersion: {
    type: String,
    required: true
  },
  legalBasis: {
    type: String,
    enum: [
      'consent',          // GDPR Article 6(1)(a)
      'contract',         // GDPR Article 6(1)(b)
      'legal_obligation', // GDPR Article 6(1)(c)
      'vital_interests',  // GDPR Article 6(1)(d)
      'public_task',      // GDPR Article 6(1)(e)
      'legitimate_interest' // GDPR Article 6(1)(f)
    ],
    default: 'consent'
  },
  consentMethod: {
    type: String,
    enum: ['explicit', 'implicit', 'opt_in', 'opt_out', 'granular'],
    required: true
  },
  consentTimestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  withdrawnAt: {
    type: Date,
    index: true
  },
  expiresAt: {
    type: Date,
    index: true
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    geolocation: {
      country: String,
      region: String,
      city: String
    },
    deviceInfo: {
      type: String,
      os: String,
      browser: String
    },
    sessionId: String,
    requestId: String
  },
  proofOfConsent: {
    checkboxText: String,
    buttonClicked: String,
    formData: mongoose.Schema.Types.Mixed,
    screenshot: String,  // Base64 or URL to screenshot
    digitalSignature: String,
    witnessedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  regulations: [{
    type: String,
    enum: ['GDPR', 'CCPA', 'PIPEDA', 'LGPD', 'HIPAA', 'SOC2', 'ISO27001']
  }],
  auditTrail: [{
    action: {
      type: String,
      enum: ['consent_given', 'consent_withdrawn', 'consent_updated', 'consent_renewed', 'consent_expired']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    reason: String,
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    metadata: mongoose.Schema.Types.Mixed
  }],
  // Immutability verification
  consentHash: {
    type: String,
    required: true
  },
  previousConsentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserConsent'
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
userConsentSchema.index({ userId: 1, consentType: 1, consentGiven: 1 });
userConsentSchema.index({ workspaceId: 1, consentType: 1 });
userConsentSchema.index({ consentTimestamp: -1 });
userConsentSchema.index({ withdrawnAt: 1 }, { sparse: true });
userConsentSchema.index({ expiresAt: 1 }, { sparse: true });
userConsentSchema.index({ 'regulations': 1 });

// Pre-save middleware to generate consent hash for immutability
userConsentSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('consentGiven') || this.isModified('consentTimestamp')) {
    const dataToHash = JSON.stringify({
      userId: this.userId,
      workspaceId: this.workspaceId,
      consentType: this.consentType,
      consentGiven: this.consentGiven,
      consentVersion: this.consentVersion,
      consentTimestamp: this.consentTimestamp,
      metadata: this.metadata
    });
    
    this.consentHash = crypto
      .createHash('sha256')
      .update(dataToHash)
      .digest('hex');
  }
  next();
});

// Method to verify consent integrity
userConsentSchema.methods.verifyIntegrity = function() {
  const dataToHash = JSON.stringify({
    userId: this.userId,
    workspaceId: this.workspaceId,
    consentType: this.consentType,
    consentGiven: this.consentGiven,
    consentVersion: this.consentVersion,
    consentTimestamp: this.consentTimestamp,
    metadata: this.metadata
  });
  
  const expectedHash = crypto
    .createHash('sha256')
    .update(dataToHash)
    .digest('hex');
  
  return this.consentHash === expectedHash;
};

// Method to check if consent is currently valid
userConsentSchema.methods.isValid = function() {
  if (!this.consentGiven) return false;
  if (this.withdrawnAt) return false;
  if (this.expiresAt && this.expiresAt < new Date()) return false;
  return true;
};

// Method to withdraw consent
userConsentSchema.methods.withdraw = async function(reason, performedBy) {
  this.withdrawnAt = new Date();
  this.consentGiven = false;
  this.auditTrail.push({
    action: 'consent_withdrawn',
    timestamp: new Date(),
    reason,
    performedBy
  });
  return this.save();
};

// Static method to get active consents for a user
userConsentSchema.statics.getActiveConsents = async function(userId, workspaceId = null) {
  const query = {
    userId,
    consentGiven: true,
    withdrawnAt: null,
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  };
  
  if (workspaceId) query.workspaceId = workspaceId;
  
  return this.find(query).sort({ consentTimestamp: -1 });
};

// Static method to check if specific consent exists
userConsentSchema.statics.hasConsent = async function(userId, consentType, workspaceId = null) {
  const query = {
    userId,
    consentType,
    consentGiven: true,
    withdrawnAt: null,
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  };
  
  if (workspaceId) query.workspaceId = workspaceId;
  
  const consent = await this.findOne(query);
  return consent !== null;
};

module.exports = mongoose.model('UserConsent', userConsentSchema);
