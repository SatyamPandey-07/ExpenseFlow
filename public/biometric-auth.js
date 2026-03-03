/**
 * Biometric Authentication - WebAuthn/Credential Management API
 * Supports Face ID, Touch ID, fingerprint, and platform authenticators
 */

class BiometricAuthentication {
    constructor() {
        this.isAvailable = false;
        this.isSupported = false;
        this.platformAuthenticator = null;
        this.registeredCredentials = [];
        this.credentials = {};
    }

    /**
     * Initialize biometric authentication
     */
    async init() {
        try {
            // Check WebAuthn support
            this.isSupported = !!(
                window.PublicKeyCredential &&
                navigator.credentials &&
                navigator.credentials.create &&
                navigator.credentials.get
            );

            if (this.isSupported) {
                // Check if platform authenticator is available
                this.isAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.();

                // Try to get credentials if available
                if (navigator.credentials) {
                    this.credentials = navigator.credentials;
                }

                console.log('Biometric authentication initialized');
                console.log('Platform authenticator available:', this.isAvailable);
            } else {
                console.warn('WebAuthn not supported on this device');
            }
        } catch (error) {
            console.error('Biometric init failed:', error);
        }
    }

    /**
     * Register biometric credential
     */
    async registerBiometric(userId, userName, userEmail) {
        try {
            if (!this.isSupported) {
                throw new Error('WebAuthn not supported');
            }

            // Create credential request
            const credential = await navigator.credentials.create({
                publicKey: {
                    challenge: this.generateChallenge(),
                    rp: {
                        name: 'ExpenseFlow',
                        id: this.getRpId()
                    },
                    user: {
                        id: this.stringToArrayBuffer(userId),
                        name: userEmail,
                        displayName: userName
                    },
                    pubKeyCredParams: [
                        { type: 'public-key', alg: -7 }, // ES256
                        { type: 'public-key', alg: -257 } // RS256
                    ],
                    timeout: 60000,
                    attestation: 'direct',
                    authenticatorSelection: {
                        authenticatorAttachment: 'platform',
                        residentKey: 'preferred',
                        userVerification: 'preferred'
                    }
                }
            });

            if (!credential) {
                throw new Error('Credential creation failed');
            }

            // Store credential
            const credentialData = {
                id: this.arrayBufferToString(credential.id),
                rawId: credential.id,
                type: credential.type,
                response: {
                    clientDataJSON: this.arrayBufferToString(credential.response.clientDataJSON),
                    attestationObject: this.arrayBufferToString(credential.response.attestationObject)
                },
                registeredAt: new Date().toISOString()
            };

            this.registeredCredentials.push(credentialData);

            // Save to database
            await offlineDB.saveSyncMetadata(`biometric_${userId}`, {
                credentials: this.registeredCredentials,
                enabled: true,
                userId
            });

            console.log('Biometric credential registered successfully');

            return credential;

        } catch (error) {
            console.error('Biometric registration failed:', error);
            throw this.handleBiometricError(error);
        }
    }

    /**
     * Authenticate with biometric
     */
    async authenticate(userId) {
        try {
            if (!this.isSupported) {
                throw new Error('WebAuthn not supported');
            }

            // Get available credentials for user
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: this.generateChallenge(),
                    timeout: 60000,
                    userVerification: 'preferred',
                    rpId: this.getRpId()
                },
                mediation: 'optional'
            });

            if (!assertion) {
                throw new Error('Authentication cancelled or failed');
            }

            const authData = {
                id: this.arrayBufferToString(assertion.id),
                rawId: assertion.id,
                type: assertion.type,
                response: {
                    clientDataJSON: this.arrayBufferToString(assertion.response.clientDataJSON),
                    authenticatorData: this.arrayBufferToString(assertion.response.authenticatorData),
                    signature: this.arrayBufferToString(assertion.response.signature),
                    userHandle: assertion.response.userHandle ? 
                        this.arrayBufferToString(assertion.response.userHandle) : null
                },
                authenticatedAt: new Date().toISOString()
            };

            console.log('Biometric authentication successful');

            return authData;

        } catch (error) {
            console.error('Biometric authentication failed:', error);
            throw this.handleBiometricError(error);
        }
    }

    /**
     * Check if biometric auth is enabled
     */
    async isBiometricEnabled(userId) {
        try {
            const metadata = await offlineDB.getSyncMetadata(`biometric_${userId}`);
            return metadata?.enabled || false;
        } catch (error) {
            return false;
        }
    }

    /**
     * Enable biometric for user
     */
    async enableBiometric(userId, userName, userEmail) {
        try {
            await this.registerBiometric(userId, userName, userEmail);

            // Save settings
            await offlineDB.saveSyncMetadata(`biometric_settings_${userId}`, {
                enabled: true,
                userId,
                enabledAt: new Date().toISOString()
            });

            return true;

        } catch (error) {
            console.error('Failed to enable biometric:', error);
            throw error;
        }
    }

    /**
     * Disable biometric for user
     */
    async disableBiometric(userId) {
        try {
            this.registeredCredentials = [];

            await offlineDB.saveSyncMetadata(`biometric_settings_${userId}`, {
                enabled: false,
                userId,
                disabledAt: new Date().toISOString()
            });

            console.log('Biometric disabled');

            return true;

        } catch (error) {
            console.error('Failed to disable biometric:', error);
            throw error;
        }
    }

    /**
     * Verify biometric locally (without server)
     */
    async verifyBiometricLocally(userId) {
        try {
            const isEnabled = await this.isBiometricEnabled(userId);
            if (!isEnabled) {
                throw new Error('Biometric not enabled for this user');
            }

            const authData = await this.authenticate(userId);
            return authData;

        } catch (error) {
            console.error('Local biometric verification failed:', error);
            throw error;
        }
    }

    /**
     * Set up biometric for transaction confirmation
     */
    async setupBiometricConfirmation(userId) {
        try {
            await this.enableBiometric(userId, 'ExpenseFlow User', 'user@expenseflow.com');

            // Save confirmation preference
            await offlineDB.saveSyncMetadata(`biometric_confirmation_${userId}`, {
                requireBiometric: true,
                userId,
                setupDate: new Date().toISOString()
            });

            return true;

        } catch (error) {
            console.error('Failed to set up biometric confirmation:', error);
            throw error;
        }
    }

    /**
     * Require biometric for payment/expense creation
     */
    async requireBiometricForTransaction(userId, amount) {
        try {
            const settings = await offlineDB.getSyncMetadata(`biometric_confirmation_${userId}`);

            if (!settings?.requireBiometric) {
                return true; // Not required
            }

            if (amount < 100) {
                return true; // Only require for large amounts
            }

            // Verify biometric
            const authData = await this.authenticate(userId);
            return authData ? true : false;

        } catch (error) {
            console.error('Biometric transaction verification failed:', error);
            return false;
        }
    }

    /**
     * Get supported authenticator types
     */
    async getSupportedAuthenticators() {
        const supported = {
            platform: false,
            crossPlatform: false,
            residentKey: false
        };

        try {
            if (!this.isSupported) {
                return supported;
            }

            // Check platform authenticator
            if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
                supported.platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            }

            // Check resident key support
            if (PublicKeyCredential.isConditionalMediationAvailable) {
                supported.residentKey = await PublicKeyCredential.isConditionalMediationAvailable();
            }

            // Cross-platform is usually available if WebAuthn is supported
            supported.crossPlatform = this.isSupported;

            return supported;

        } catch (error) {
            console.error('Failed to check authenticators:', error);
            return supported;
        }
    }

    /**
     * Generate random challenge
     */
    generateChallenge() {
        const buffer = new Uint8Array(32);
        crypto.getRandomValues(buffer);
        return buffer;
    }

    /**
     * Get RP ID (domain)
     */
    getRpId() {
        const domain = window.location.hostname;
        // Remove www. prefix if present
        return domain.replace(/^www\./, '');
    }

    /**
     * Convert string to ArrayBuffer
     */
    stringToArrayBuffer(str) {
        const encoder = new TextEncoder();
        return encoder.encode(str);
    }

    /**
     * Convert ArrayBuffer to string
     */
    arrayBufferToString(buffer) {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }

    /**
     * Handle biometric errors
     */
    handleBiometricError(error) {
        if (error.name === 'NotSupportedError') {
            return new Error('WebAuthn not supported on this device');
        } else if (error.name === 'InvalidStateError') {
            return new Error('This credential is already registered');
        } else if (error.name === 'NotAllowedError') {
            return new Error('Biometric operation cancelled or not allowed');
        } else if (error.name === 'SecurityError') {
            return new Error('Biometric requires secure context (HTTPS)');
        }
        return error;
    }

    /**
     * Get biometric status
     */
    getStatus() {
        return {
            isSupported: this.isSupported,
            isAvailable: this.isAvailable,
            registeredCount: this.registeredCredentials.length,
            lastRegistration: this.registeredCredentials.length > 0 ?
                this.registeredCredentials[this.registeredCredentials.length - 1].registeredAt : null
        };
    }

    /**
     * Migrate biometric settings to new device
     */
    async migrateBiometricSettings(userId, backupCode) {
        try {
            // Verify backup code first
            const isValid = await this.verifyBackupCode(userId, backupCode);
            if (!isValid) {
                throw new Error('Invalid backup code');
            }

            // Re-register biometric on new device
            await this.registerBiometric(userId, 'ExpenseFlow User', 'user@expenseflow.com');

            console.log('Biometric settings migrated to new device');
            return true;

        } catch (error) {
            console.error('Failed to migrate biometric:', error);
            throw error;
        }
    }

    /**
     * Generate backup codes
     */
    generateBackupCodes(count = 10) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            const code = Array.from(crypto.getRandomValues(new Uint8Array(4)))
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('-')
                .toUpperCase();
            codes.push(code);
        }
        return codes;
    }

    /**
     * Store backup codes
     */
    async storeBackupCodes(userId, codes) {
        try {
            await offlineDB.saveSyncMetadata(`backup_codes_${userId}`, {
                codes,
                created: new Date().toISOString(),
                used: []
            });
            return true;
        } catch (error) {
            console.error('Failed to store backup codes:', error);
            throw error;
        }
    }

    /**
     * Verify backup code
     */
    async verifyBackupCode(userId, code) {
        try {
            const metadata = await offlineDB.getSyncMetadata(`backup_codes_${userId}`);
            if (!metadata) return false;

            const { codes, used } = metadata;
            if (used.includes(code)) return false; // Already used

            if (codes.includes(code)) {
                // Mark code as used
                used.push(code);
                await offlineDB.saveSyncMetadata(`backup_codes_${userId}`, {
                    codes,
                    created: metadata.created,
                    used
                });
                return true;
            }

            return false;

        } catch (error) {
            console.error('Failed to verify backup code:', error);
            return false;
        }
    }
}

// Initialize global instance
const biometricAuthentication = new BiometricAuthentication();
