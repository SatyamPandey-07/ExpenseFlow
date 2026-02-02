const mongoose = require('mongoose');

/**
 * StateDelta - Captures incremental changes between snapshots
 * Enables efficient state reconstruction and forensic analysis
 */
const stateDeltaSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    timestamp: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },

    // What changed
    entityType: {
        type: String,
        required: true,
        enum: ['expense', 'income', 'transfer', 'budget', 'goal', 'account', 'user_settings'],
        index: true
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },

    // Type of operation
    operation: {
        type: String,
        required: true,
        enum: ['create', 'update', 'delete', 'restore'],
        index: true
    },

    // State changes
    beforeState: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    afterState: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },

    // What fields changed (for updates)
    changedFields: [{
        field: String,
        oldValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed
    }],

    // Financial impact
    financialImpact: {
        balanceChange: { type: Number, default: 0 },
        affectedCategories: [String],
        affectedBudgets: [mongoose.Schema.Types.ObjectId],
        affectedGoals: [mongoose.Schema.Types.ObjectId]
    },

    // Context
    context: {
        userId: mongoose.Schema.Types.ObjectId,
        sessionId: String,
        ipAddress: String,
        userAgent: String,
        requestId: String,
        workspaceId: mongoose.Schema.Types.ObjectId
    },

    // Causality chain
    causedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StateDelta',
        default: null
    },
    triggers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StateDelta'
    }],

    // Metadata
    metadata: {
        source: { type: String, default: 'api' }, // api, import, sync, automation
        reason: String,
        tags: [String]
    }
}, {
    timestamps: true
});

// Compound indexes for efficient querying
stateDeltaSchema.index({ user: 1, timestamp: -1 });
stateDeltaSchema.index({ user: 1, entityType: 1, timestamp: -1 });
stateDeltaSchema.index({ user: 1, operation: 1, timestamp: -1 });
stateDeltaSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
stateDeltaSchema.index({ 'context.sessionId': 1 });
stateDeltaSchema.index({ 'context.requestId': 1 });

// Method to calculate reverse delta (for undo operations)
stateDeltaSchema.methods.getReverseDelta = function () {
    return {
        entityType: this.entityType,
        entityId: this.entityId,
        operation: this.operation === 'create' ? 'delete' :
            this.operation === 'delete' ? 'create' : 'update',
        beforeState: this.afterState,
        afterState: this.beforeState,
        changedFields: this.changedFields.map(f => ({
            field: f.field,
            oldValue: f.newValue,
            newValue: f.oldValue
        })),
        financialImpact: {
            balanceChange: -this.financialImpact.balanceChange,
            affectedCategories: this.financialImpact.affectedCategories,
            affectedBudgets: this.financialImpact.affectedBudgets,
            affectedGoals: this.financialImpact.affectedGoals
        }
    };
};

// Static method to create delta
stateDeltaSchema.statics.createDelta = async function (data) {
    const delta = new this(data);
    return await delta.save();
};

// Static method to get deltas between two timestamps
stateDeltaSchema.statics.getDeltasBetween = async function (userId, startDate, endDate) {
    return await this.find({
        user: userId,
        timestamp: { $gte: startDate, $lte: endDate }
    }).sort({ timestamp: 1 });
};

module.exports = mongoose.model('StateDelta', stateDeltaSchema);
