const mongoose = require('mongoose');

/**
 * AuditSnapshot - Point-in-time snapshot of user's complete financial state
 * Used for fast historical state reconstruction
 */
const auditSnapshotSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    snapshotDate: {
        type: Date,
        required: true,
        index: true
    },
    snapshotType: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'on-demand'],
        default: 'daily'
    },
    state: {
        // Complete financial state at this point in time
        totalBalance: { type: Number, default: 0 },
        totalIncome: { type: Number, default: 0 },
        totalExpenses: { type: Number, default: 0 },

        // Category-wise breakdown
        categoryBreakdown: [{
            category: String,
            amount: Number,
            transactionCount: Number
        }],

        // Budget states
        budgets: [{
            budgetId: mongoose.Schema.Types.ObjectId,
            limit: Number,
            spent: Number,
            remaining: Number
        }],

        // Goal states
        goals: [{
            goalId: mongoose.Schema.Types.ObjectId,
            targetAmount: Number,
            currentAmount: Number,
            progress: Number
        }],

        // Account balances
        accounts: [{
            accountId: mongoose.Schema.Types.ObjectId,
            balance: Number,
            currency: String
        }],

        // Transaction count at this point
        transactionCount: { type: Number, default: 0 },

        // Metadata
        currency: { type: String, default: 'INR' }
    },

    // Compression info
    compressed: { type: Boolean, default: false },
    compressionRatio: { type: Number },
    originalSize: { type: Number },
    compressedSize: { type: Number },

    // Verification hash for integrity
    stateHash: { type: String, required: true },

    metadata: {
        generatedBy: { type: String, default: 'system' },
        generationDuration: Number, // milliseconds
        deltasSinceLastSnapshot: Number
    }
}, {
    timestamps: true
});

// Indexes for performance
auditSnapshotSchema.index({ user: 1, snapshotDate: -1 });
auditSnapshotSchema.index({ user: 1, snapshotType: 1, snapshotDate: -1 });
auditSnapshotSchema.index({ stateHash: 1 });

// Method to verify snapshot integrity
auditSnapshotSchema.methods.verifyIntegrity = function () {
    const crypto = require('crypto');
    const stateString = JSON.stringify(this.state);
    const calculatedHash = crypto.createHash('sha256').update(stateString).digest('hex');
    return calculatedHash === this.stateHash;
};

// Static method to create snapshot with hash
auditSnapshotSchema.statics.createSnapshot = async function (userId, state, type = 'daily') {
    const crypto = require('crypto');
    const stateString = JSON.stringify(state);
    const stateHash = crypto.createHash('sha256').update(stateString).digest('hex');

    const snapshot = new this({
        user: userId,
        snapshotDate: new Date(),
        snapshotType: type,
        state,
        stateHash,
        originalSize: Buffer.byteLength(stateString)
    });

    return await snapshot.save();
};

module.exports = mongoose.model('AuditSnapshot', auditSnapshotSchema);
