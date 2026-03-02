/**
 * Attestation Cache Model
 * Caches device attestation results to reduce API calls and improve performance
 */

const mongoose = require('mongoose');

const attestationCacheSchema = new mongoose.Schema({
  // Cache key (composite of userId + deviceId + provider)
  cacheKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

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

  provider: {
    type: String,
    required: true,
    enum: ['TPM', 'SAFETYNET', 'DEVICECHECK', 'WEBAUTHENTICATION', 'FALLBACK']
  },

  // Cached attestation result
  attestationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeviceAttestation',
    required: true
  },

  // Cached trust score
  trustScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },

  // Cached status
  status: {
    type: String,
    required: true,
    enum: ['VALID', 'INVALID', 'EXPIRED', 'PENDING', 'FAILED']
  },

  // Security checks (cached)
  securityChecks: {
    isRooted: Boolean,
    isJailbroken: Boolean,
    isEmulator: Boolean,
    isDeveloperMode: Boolean,
    hasDebugger: Boolean,
    hasHooks: Boolean,
    hasMalware: Boolean
  },

  // Cache metadata
  cacheMetadata: {
    hitCount: {
      type: Number,
      default: 0
    },
    lastHitAt: Date,
    source: {
      type: String,
      enum: ['ATTESTATION', 'MANUAL', 'IMPORT']
    },
    ttlSeconds: Number
  },

  // Expiration
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },

  // Invalidation tracking
  invalidated: {
    type: Boolean,
    default: false
  },

  invalidatedAt: Date,
  invalidationReason: String

}, {
  timestamps: true,
  collection: 'attestation_cache'
});

// Compound indexes
attestationCacheSchema.index({ userId: 1, deviceId: 1, provider: 1 });
attestationCacheSchema.index({ expiresAt: 1, invalidated: 1 });

// TTL index - MongoDB will automatically delete expired documents
attestationCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual to check if cache is valid
attestationCacheSchema.virtual('isValid').get(function() {
  return !this.invalidated && 
         this.expiresAt > new Date() && 
         this.status === 'VALID';
});

// Method to record cache hit
attestationCacheSchema.methods.recordHit = async function() {
  this.cacheMetadata.hitCount += 1;
  this.cacheMetadata.lastHitAt = new Date();
  return this.save();
};

// Method to invalidate cache
attestationCacheSchema.methods.invalidate = async function(reason) {
  this.invalidated = true;
  this.invalidatedAt = new Date();
  this.invalidationReason = reason;
  return this.save();
};

// Static method to get or create cache entry
attestationCacheSchema.statics.getOrCreate = async function(userId, deviceId, provider, attestationData, ttlSeconds = 3600) {
  const cacheKey = `${userId}_${deviceId}_${provider}`;
  const expiresAt = new Date(Date.now() + (ttlSeconds * 1000));

  let cache = await this.findOne({ cacheKey, invalidated: false });

  if (cache && cache.expiresAt > new Date()) {
    await cache.recordHit();
    return { cached: true, data: cache };
  }

  // Create new cache entry
  cache = await this.create({
    cacheKey,
    userId,
    deviceId,
    provider,
    attestationId: attestationData.attestationId,
    trustScore: attestationData.trustScore,
    status: attestationData.status,
    securityChecks: attestationData.securityChecks,
    cacheMetadata: {
      hitCount: 0,
      source: 'ATTESTATION',
      ttlSeconds
    },
    expiresAt
  });

  return { cached: false, data: cache };
};

// Static method to invalidate all cache for a device
attestationCacheSchema.statics.invalidateDevice = async function(userId, deviceId, reason) {
  return this.updateMany(
    { userId, deviceId, invalidated: false },
    { 
      $set: { 
        invalidated: true, 
        invalidatedAt: new Date(),
        invalidationReason: reason
      }
    }
  );
};

// Static method to get cache statistics
attestationCacheSchema.statics.getStatistics = async function(userId, timeRange = 24) {
  const since = new Date(Date.now() - (timeRange * 60 * 60 * 1000));

  const stats = await this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: since }
      }
    },
    {
      $group: {
        _id: '$provider',
        totalEntries: { $sum: 1 },
        totalHits: { $sum: '$cacheMetadata.hitCount' },
        validEntries: {
          $sum: {
            $cond: [{ $eq: ['$status', 'VALID'] }, 1, 0]
          }
        },
        avgTrustScore: { $avg: '$trustScore' }
      }
    }
  ]);

  return stats;
};

module.exports = mongoose.model('AttestationCache', attestationCacheSchema);
