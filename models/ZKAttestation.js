const mongoose = require('mongoose');

/**
 * ZKAttestation Model
 * Issue #867: Storing public parameters and proof roots for Zero-Knowledge audits.
 * Allows trustless verification that a transaction followed policy without revealing PII.
 */
const zkAttestationSchema = new mongoose.Schema({
    transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        required: true,
        index: true
    },
    workspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workspace',
        required: true,
        index: true
    },
    proofType: {
        type: String,
        enum: ['RANGE_PROOF', 'MEMBERSHIP_PROOF', 'CONSISTENCY_PROOF'],
        required: true
    },
    proofData: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    }, // The actual SNARK proof object
    publicSignals: {
        type: [String],
        default: []
    }, // Public parameters for verification
    complianceRoot: {
        type: String,
        required: true
    }, // Merkle root of the compliance state at time of proof
    verifiedAt: {
        type: Date
    },
    status: {
        type: String,
        enum: ['PENDING', 'GENERATED', 'VERIFIED', 'FAILED'],
        default: 'PENDING'
    }
}, {
    timestamps: true
});

// Index for fast audit lookups
zkAttestationSchema.index({ workspaceId: 1, createdAt: -1 });

module.exports = mongoose.model('ZKAttestation', zkAttestationSchema);
