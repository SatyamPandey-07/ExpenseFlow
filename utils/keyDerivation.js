const crypto = require('crypto');

/**
 * Key Derivation Utility
 * Issue #770: Deriving secure encryption keys.
 * Uses pbkdf2 to expand master secrets into properly-sized byte arrays.
 * Updated for #921: Integration with Master Key Service
 */
class KeyDerivation {
    static getMasterKey() {
        // Try to get master key from Master Key Service first
        try {
            const MasterKeyService = require('../services/masterKeyService');
            const masterKeyService = new MasterKeyService();

            // Get active encryption master key
            const masterKey = masterKeyService.retrieveMasterKey('mk-encryption-active', {
                serviceAccount: 'key-derivation-service'
            });

            if (masterKey) {
                return masterKey;
            }
        } catch (error) {
            // Fall back to environment variable if Master Key Service not available
            console.warn('Master Key Service not available, falling back to environment variable');
        }

        // Fallback to environment variable (less secure, for backward compatibility)
        const masterSecret = process.env.ENCRYPTION_MASTER_KEY || 'default-insecure-master-key-must-change-in-prod';

        // Ensure the key is exactly 32 bytes (256 bits) for AES-256
        return crypto.pbkdf2Sync(masterSecret, 'expenseflow-salt', 100000, 32, 'sha512');
    }

    /**
     * Generate a new random AES-256 key for a tenant
     */
    static generateTenantKey() {
        return crypto.randomBytes(32);
    }

    /**
     * Derive a key from a master key and context
     */
    static deriveFromMaster(masterKey, context, length = 32) {
        const contextBuffer = Buffer.from(context, 'utf8');
        const hmac = crypto.createHmac('sha512', masterKey);
        hmac.update(contextBuffer);
        return hmac.digest().slice(0, length);
    }

    /**
     * Derive a tenant-specific key from master key
     */
    static deriveTenantKey(masterKey, tenantId) {
        return this.deriveFromMaster(masterKey, `tenant-${tenantId}`, 32);
    }

    /**
     * Derive a user-specific key from master key
     */
    static deriveUserKey(masterKey, userId) {
        return this.deriveFromMaster(masterKey, `user-${userId}`, 32);
    }
}

module.exports = KeyDerivation;
