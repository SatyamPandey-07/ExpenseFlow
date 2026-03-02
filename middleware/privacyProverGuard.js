const ZKAttestation = require('../models/ZKAttestation');
const SnarkMath = require('../utils/snarkMath');
const logger = require('../utils/structuredLogger');

/**
 * PrivacyProverGuard Middleware
 * Issue #867: Intercepts audit requests to provide ZK-Proofs instead of raw PII.
 * If 'x-audit-mode' is 'trustless', it forces the response to be an attestation.
 */
const privacyProverGuard = async (req, res, next) => {
    const isTrustlessAudit = req.headers['x-audit-mode'] === 'trustless';

    if (isTrustlessAudit) {
        logger.info('[PrivacyProver] Intercepting request for trustless compliance attestation.');

        // Hook into res.json to transform outgoing data
        const originalJson = res.json;
        res.json = async function (data) {
            if (req.path.includes('/api/expenses') && data.success && data.expense) {
                const transactionId = data.expense._id;
                const attestation = await ZKAttestation.findOne({ transactionId });

                if (attestation) {
                    return originalJson.call(this, {
                        success: true,
                        attestation: {
                            proofType: attestation.proofType,
                            publicSignals: attestation.publicSignals,
                            proof: attestation.proofData.proof,
                            verificationStatus: SnarkMath.verify(attestation.proofData) ? 'VERIFIED' : 'INVALID'
                        },
                        message: 'Privacy-Preserving Audit Proof provided.'
                    });
                }
            }
            return originalJson.call(this, data);
        };
    }

    next();
};

module.exports = privacyProverGuard;
