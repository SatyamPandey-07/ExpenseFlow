/**
 * Credential Intelligence Cache Model
 * Caches credential breach lookups to reduce API calls and improve performance
 */

const mongoose = require('mongoose');

const credentialIntelCacheSchema = new mongoose.Schema({
  // Cache key (hashed identifier)
  cacheKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  identifierType: {
    type: String,
    required: true,
    enum: ['EMAIL', 'PASSWORD_HASH', 'USERNAME']
  },

  // Provider that performed the check
  provider: {
    type: String,
    required: true,
    enum: ['HIBP', 'INTERNAL', 'THIRD_PARTY', 'HONEYPOT']
  },

  // Check result
  compromised: {
    type: Boolean,
    required: true,
    default: false
  },

  // Breach count
  breachCount: {
    type: Number,
    default: 0
  },

  // Breach names (if compromised)
  breaches: [{
    name: String,
    date: Date,
    severity: String,
    dataClasses: [String]
  }],

  // Cache metadata
  cacheMetadata: {
    checkDate: {
      type: Date,
      required: true,
      default: Date.now
    },
    hitCount: {
      type: Number,
      default: 0
    },
    lastHitAt: Date,
    ttlSeconds: {
      type: Number,
      default: 86400 // 24 hours default
    },
    stale: {
      type: Boolean,
      default: false
    }
  },

  // Rate limiting
  rateLimit: {
    requestCount: {
      type: Number,
      default: 0
    },
    windowStart: Date,
    limited: {
      type: Boolean,
      default: false
    },
    limitExpiresAt: Date
  },

  // Expiration
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }

}, {
  timestamps: true,
  collection: 'credential_intel_cache'
});

// Indexes
credentialIntelCacheSchema.index({ cacheKey: 1, provider: 1 });
credentialIntelCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
credentialIntelCacheSchema.index({ 'cacheMetadata.stale': 1 });

// Virtual to check if cache is valid
credentialIntelCacheSchema.virtual('isValid').get(function() {
  return !this.cacheMetadata.stale && 
         this.expiresAt > new Date() &&
         !this.rateLimit.limited;
});

// Method to record cache hit
credentialIntelCacheSchema.methods.recordHit = async function() {
  this.cacheMetadata.hitCount += 1;
  this.cacheMetadata.lastHitAt = new Date();
  return this.save();
};

// Method to mark as stale
credentialIntelCacheSchema.methods.markStale = async function() {
  this.cacheMetadata.stale = true;
  return this.save();
};

// Method to check rate limit
credentialIntelCacheSchema.methods.checkRateLimit = function(maxRequests = 100, windowMs = 3600000) {
  const now = Date.now();
  
  // Reset window if expired
  if (!this.rateLimit.windowStart || 
      now - this.rateLimit.windowStart.getTime() > windowMs) {
    this.rateLimit.windowStart = new Date(now);
    this.rateLimit.requestCount = 0;
    this.rateLimit.limited = false;
  }

  // Check limit
  if (this.rateLimit.requestCount >= maxRequests) {
    this.rateLimit.limited = true;
    this.rateLimit.limitExpiresAt = new Date(
      this.rateLimit.windowStart.getTime() + windowMs
    );
    return false;
  }

  return true;
};

// Method to increment rate limit counter
credentialIntelCacheSchema.methods.incrementRateLimit = async function() {
  this.rateLimit.requestCount += 1;
  return this.save();
};

// Static method to get or create cache
credentialIntelCacheSchema.statics.getOrCreate = async function(
  cacheKey, 
  identifierType, 
  provider, 
  ttlSeconds = 86400
) {
  let cache = await this.findOne({ cacheKey, provider });

  if (cache) {
    // Check if valid
    if (cache.isValid) {
      await cache.recordHit();
      return { cached: true, data: cache };
    }
  }

  // Create new cache entry (placeholder)
  const expiresAt = new Date(Date.now() + (ttlSeconds * 1000));
  cache = await this.create({
    cacheKey,
    identifierType,
    provider,
    compromised: false,
    breachCount: 0,
    breaches: [],
    cacheMetadata: {
      checkDate: new Date(),
      hitCount: 0,
      ttlSeconds
    },
    expiresAt
  });

  return { cached: false, data: cache };
};

// Static method to update cache with result
credentialIntelCacheSchema.statics.updateWithResult = async function(
  cacheKey,
  provider,
  result
) {
  return this.findOneAndUpdate(
    { cacheKey, provider },
    {
      $set: {
        compromised: result.compromised,
        breachCount: result.breachCount || 0,
        breaches: result.breaches || [],
        'cacheMetadata.checkDate': new Date(),
        'cacheMetadata.stale': false
      }
    },
    { new: true }
  );
};

// Static method to invalidate stale caches
credentialIntelCacheSchema.statics.markStale = async function(identifierType, olderThanDays = 30) {
  const staleDate = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000));
  
  return this.updateMany(
    {
      identifierType,
      'cacheMetadata.checkDate': { $lt: staleDate },
      'cacheMetadata.stale': false
    },
    {
      $set: { 'cacheMetadata.stale': true }
    }
  );
};

// Static method to get cache statistics
credentialIntelCacheSchema.statics.getStatistics = async function(provider = null) {
  const match = provider ? { provider } : {};

  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$provider',
        totalEntries: { $sum: 1 },
        compromisedEntries: {
          $sum: { $cond: ['$compromised', 1, 0] }
        },
        totalHits: { $sum: '$cacheMetadata.hitCount' },
        staleEntries: {
          $sum: { $cond: ['$cacheMetadata.stale', 1, 0] }
        },
        avgBreachCount: { $avg: '$breachCount' }
      }
    }
  ]);

  return stats;
};

module.exports = mongoose.model('CredentialIntelCache', credentialIntelCacheSchema);
