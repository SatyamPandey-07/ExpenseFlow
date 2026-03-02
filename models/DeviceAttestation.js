/**
 * Device Attestation Model
 * Stores device attestation data from various providers (TPM, SafetyNet, DeviceCheck, Web)
 * Used for device trust scoring and session security
 */

const mongoose = require('mongoose');

const deviceAttestationSchema = new mongoose.Schema({
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

  // Attestation provider type
  provider: {
    type: String,
    required: true,
    enum: ['TPM', 'SAFETYNET', 'DEVICECHECK', 'WEBAUTHENTICATION', 'FALLBACK'],
    index: true
  },

  // Attestation status
  status: {
    type: String,
    required: true,
    enum: ['VALID', 'INVALID', 'EXPIRED', 'PENDING', 'FAILED'],
    default: 'PENDING'
  },

  // Trust score (0-100)
  trustScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 0
  },

  // Attestation result data
  attestationData: {
    // Raw attestation response (sanitized)
    raw: {
      type: mongoose.Schema.Types.Mixed
    },

    // TPM-specific data
    tpm: {
      aikCertificate: String,
      platformHash: String,
      pcrs: mongoose.Schema.Types.Mixed,
      bootIntegrity: Boolean,
      firmwareVersion: String
    },

    // SafetyNet-specific data (Android)
    safetyNet: {
      jws: String,
      nonce: String,
      ctsProfileMatch: Boolean,
      basicIntegrity: Boolean,
      evaluationType: String,
      advice: [String]
    },

    // DeviceCheck-specific data (iOS)
    deviceCheck: {
      token: String,
      timestamp: Date,
      isSupported: Boolean,
      bits: {
        bit0: Boolean,
        bit1: Boolean
      }
    },

    // Web Authentication data
    webAuthn: {
      credentialId: String,
      publicKey: String,
      counter: Number,
      aaguid: String,
      authenticatorData: String
    }
  },

  // Security checks
  securityChecks: {
    isRooted: { type: Boolean, default: false },
    isJailbroken: { type: Boolean, default: false },
    isEmulator: { type: Boolean, default: false },
    isDeveloperMode: { type: Boolean, default: false },
    hasDebugger: { type: Boolean, default: false },
    hasHooks: { type: Boolean, default: false },
    hasMalware: { type: Boolean, default: false }
  },

  // Browser integrity (for web clients)
  browserIntegrity: {
    userAgent: String,
    webdriver: Boolean,
    phantomjs: Boolean,
    selenium: Boolean,
    headless: Boolean,
    extensionsDetected: [String],
    automationTools: [String]
  },

  // Device binding information
  binding: {
    hardwareId: String,
    serialNumber: String,
    imei: String, // Mobile only
    macAddress: String,
    cpuId: String,
    biosVersion: String,
    diskId: String
  },

  // Geolocation at attestation time
  location: {
    country: String,
    region: String,
    city: String,
    timezone: String,
    latitude: Number,
    longitude: Number
  },

  // Risk factors
  riskFactors: [{
    type: {
      type: String,
      enum: ['ROOTED', 'EMULATOR', 'DEBUGGER', 'LOCATION_MISMATCH', 'HARDWARE_MISMATCH', 
             'SIGNATURE_INVALID', 'EXPIRED', 'REVOKED', 'AUTOMATION', 'MANIPULATION']
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    },
    description: String,
    impactScore: Number
  }],

  // Validity period
  validFrom: {
    type: Date,
    required: true,
    default: Date.now
  },

  validUntil: {
    type: Date,
    required: true,
    index: true
  },

  // Challenge-response data
  challenge: {
    nonce: String,
    timestamp: Date,
    method: String
  },

  // Verification metadata
  verifiedAt: {
    type: Date,
    default: Date.now
  },

  verifiedBy: {
    type: String,
    enum: ['SYSTEM', 'MANUAL', 'API'],
    default: 'SYSTEM'
  },

  // Associated session
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    index: true
  },

  // Failure information
  failureReason: String,
  failureDetails: mongoose.Schema.Types.Mixed,

  // Metadata
  metadata: {
    ipAddress: String,
    requestId: String,
    apiVersion: String,
    sdkVersion: String
  }

}, {
  timestamps: true,
  collection: 'device_attestations'
});

// Indexes for performance
deviceAttestationSchema.index({ userId: 1, deviceId: 1, createdAt: -1 });
deviceAttestationSchema.index({ status: 1, validUntil: 1 });
deviceAttestationSchema.index({ trustScore: 1, status: 1 });
deviceAttestationSchema.index({ 'securityChecks.isRooted': 1, 'securityChecks.isEmulator': 1 });

// Virtual for checking if attestation is currently valid
deviceAttestationSchema.virtual('isCurrentlyValid').get(function() {
  const now = new Date();
  return this.status === 'VALID' && 
         this.validFrom <= now && 
         this.validUntil > now;
});

// Method to check if attestation needs renewal
deviceAttestationSchema.methods.needsRenewal = function() {
  const expirationBuffer = 24 * 60 * 60 * 1000; // 24 hours before expiry
  return new Date(this.validUntil).getTime() - Date.now() < expirationBuffer;
};

// Method to calculate overall security posture
deviceAttestationSchema.methods.getSecurityPosture = function() {
  const checks = this.securityChecks;
  const criticalIssues = checks.isRooted || checks.isJailbroken || checks.hasMalware;
  const highRiskIssues = checks.isEmulator || checks.hasDebugger;
  const mediumRiskIssues = checks.isDeveloperMode || checks.hasHooks;

  if (criticalIssues) return 'CRITICAL';
  if (highRiskIssues) return 'HIGH';
  if (mediumRiskIssues) return 'MEDIUM';
  return 'LOW';
};

// Static method to get latest valid attestation for device
deviceAttestationSchema.statics.getLatestValid = async function(userId, deviceId) {
  const now = new Date();
  return this.findOne({
    userId,
    deviceId,
    status: 'VALID',
    validFrom: { $lte: now },
    validUntil: { $gt: now }
  }).sort({ createdAt: -1 });
};

// Static method to revoke all attestations for device
deviceAttestationSchema.statics.revokeDevice = async function(userId, deviceId, reason) {
  return this.updateMany(
    {
      userId,
      deviceId,
      status: 'VALID'
    },
    {
      $set: {
        status: 'INVALID',
        failureReason: reason,
        validUntil: new Date()
      }
    }
  );
};

module.exports = mongoose.model('DeviceAttestation', deviceAttestationSchema);
