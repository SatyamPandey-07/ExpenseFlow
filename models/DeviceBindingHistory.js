/**
 * Device Binding History Model
 * Tracks device binding changes and history for trust scoring
 */

const mongoose = require('mongoose');

const deviceBindingHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  deviceId: {
    type: String,
    required: true,
    index: true
  },

  // Event type
  eventType: {
    type: String,
    required: true,
    enum: [
      'FIRST_SEEN',
      'BINDING_ESTABLISHED',
      'BINDING_VERIFIED',
      'BINDING_CHANGED',
      'HARDWARE_CHANGED',
      'SUSPICIOUS_CHANGE',
      'BINDING_REVOKED',
      'TRUST_UPGRADED',
      'TRUST_DOWNGRADED'
    ]
  },

  // Previous and current binding data
  previousBinding: {
    hardwareId: String,
    serialNumber: String,
    imei: String,
    macAddress: String,
    cpuId: String,
    biosVersion: String,
    diskId: String,
    fingerprint: String
  },

  currentBinding: {
    hardwareId: String,
    serialNumber: String,
    imei: String,
    macAddress: String,
    cpuId: String,
    biosVersion: String,
    diskId: String,
    fingerprint: String
  },

  // What changed
  changes: [{
    field: String,
    oldValue: String,
    newValue: String,
    changeType: {
      type: String,
      enum: ['EXPECTED', 'SUSPICIOUS', 'CRITICAL']
    }
  }],

  // Trust impact
  trustImpact: {
    previousScore: Number,
    newScore: Number,
    scoreDelta: Number,
    reason: String
  },

  // Detection context
  detectionContext: {
    attestationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeviceAttestation'
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session'
    },
    ipAddress: String,
    userAgent: String,
    location: {
      country: String,
      city: String,
      latitude: Number,
      longitude: Number
    }
  },

  // Risk assessment
  riskAssessment: {
    level: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    },
    score: Number,
    indicators: [{
      type: String,
      description: String,
      severity: String
    }],
    recommendation: String
  },

  // Action taken
  actionTaken: {
    type: String,
    enum: ['NONE', 'MONITOR', 'CHALLENGE', 'STEPUP_AUTH', 'BLOCK', 'REVOKE'],
    default: 'NONE'
  },

  actionDetails: String,

  // Verification
  verified: {
    type: Boolean,
    default: false
  },

  verifiedAt: Date,
  verifiedBy: String,

  // Metadata
  metadata: {
    deviceType: String,
    osVersion: String,
    appVersion: String,
    requestId: String
  }

}, {
  timestamps: true,
  collection: 'device_binding_history'
});

// Indexes
deviceBindingHistorySchema.index({ userId: 1, deviceId: 1, createdAt: -1 });
deviceBindingHistorySchema.index({ eventType: 1, createdAt: -1 });
deviceBindingHistorySchema.index({ 'riskAssessment.level': 1 });
deviceBindingHistorySchema.index({ actionTaken: 1 });

// Static method to get device binding timeline
deviceBindingHistorySchema.statics.getDeviceTimeline = async function(userId, deviceId, limit = 50) {
  return this.find({ userId, deviceId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// Static method to detect binding anomalies
deviceBindingHistorySchema.statics.detectAnomalies = async function(userId, deviceId) {
  const recentChanges = await this.find({
    userId,
    deviceId,
    eventType: { $in: ['BINDING_CHANGED', 'HARDWARE_CHANGED', 'SUSPICIOUS_CHANGE'] },
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
  }).sort({ createdAt: -1 });

  return {
    hasAnomalies: recentChanges.length > 0,
    changeCount: recentChanges.length,
    highRiskChanges: recentChanges.filter(c => 
      c.riskAssessment && ['HIGH', 'CRITICAL'].includes(c.riskAssessment.level)
    ).length,
    recentChanges: recentChanges.slice(0, 10)
  };
};

// Static method to calculate device stability score
deviceBindingHistorySchema.statics.calculateStabilityScore = async function(userId, deviceId) {
  const history = await this.find({ userId, deviceId })
    .sort({ createdAt: 1 })
    .lean();

  if (history.length === 0) return 0;

  const ageInDays = (Date.now() - new Date(history[0].createdAt).getTime()) / (24 * 60 * 60 * 1000);
  const changeCount = history.filter(h => 
    ['BINDING_CHANGED', 'HARDWARE_CHANGED'].includes(h.eventType)
  ).length;
  const suspiciousCount = history.filter(h => 
    h.eventType === 'SUSPICIOUS_CHANGE'
  ).length;

  // Scoring formula
  let score = 50; // Base score

  // Age factor (older = more stable)
  if (ageInDays > 365) score += 20;
  else if (ageInDays > 180) score += 15;
  else if (ageInDays > 90) score += 10;
  else if (ageInDays > 30) score += 5;

  // Change frequency factor
  const changesPerMonth = (changeCount / ageInDays) * 30;
  if (changesPerMonth < 0.5) score += 15;
  else if (changesPerMonth < 1) score += 10;
  else if (changesPerMonth < 2) score += 5;
  else score -= (changesPerMonth * 5);

  // Suspicious activity factor
  score -= (suspiciousCount * 10);

  // Verification factor
  const verifiedEvents = history.filter(h => h.verified).length;
  score += Math.min(verifiedEvents * 2, 15);

  return Math.max(0, Math.min(100, score));
};

module.exports = mongoose.model('DeviceBindingHistory', deviceBindingHistorySchema);
