const mongoose = require('mongoose');

/**
 * FinancialEvent Model
 * Issue #680: The immutable source of truth for all state mutations.
 * Each event captures a discrete change in the system.
 */
const financialEventSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    eventType: {
        type: String,
        required: true,
        enum: [
            'TX_CREATED', 'TX_UPDATED', 'TX_DELETED',
            'WS_CREATED', 'WS_UPDATED', 'WS_MEMBER_ADDED',
            'BUDGET_EXCEEDED', 'SYSTEM_AUDIT_LOG'
        ],
        index: true
    },
    entityType: {
        type: String,
        required: true, // e.g., 'Transaction', 'Workspace'
        index: true
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    payload: {
        type: mongoose.Schema.Types.Mixed,
        required: true // The state AFTER the change or the delta
    },
    previousEventId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FinancialEvent',
        default: null
    },
    metadata: {
        deviceId: String,
        ipAddress: String,
        userAgent: String,
        correlationId: String, // To group related events
        timestamp: { type: Date, default: Date.now }
    },
    checksum: {
        type: String,
        required: true // SHA-256 of payload+previousEventId for immutability validation
    },
    version: {
        type: Number,
        required: true // Incremental version per entity
    }
}, {
    timestamps: true
});

// Comprehensive indexes for forensic analysis
financialEventSchema.index({ entityId: 1, version: 1 }, { unique: true });
financialEventSchema.index({ 'metadata.timestamp': 1 });
financialEventSchema.index({ userId: 1, eventType: 1 });

module.exports = mongoose.model('FinancialEvent', financialEventSchema);
