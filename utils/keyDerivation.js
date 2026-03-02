const crypto = require('crypto');

/**
 * Key Derivation Utility
 * Issue #770: Deriving secure encryption keys.
 * Uses pbkdf2 to expand master secrets into properly-sized byte arrays.
 */
class KeyDerivation {
    static getMasterKey() {
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
}

module.exports = KeyDerivation;
