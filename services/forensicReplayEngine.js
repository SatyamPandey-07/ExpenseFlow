const FinancialEvent = require('../models/FinancialEvent');
const eventDiffEngine = require('../utils/eventDiffEngine');

/**
 * Forensic Replay Engine
 * Issue #680: Reconstructs state from the event log for any point in history.
 */
class ForensicReplayEngine {
    /**
     * Replay an entity's state to a specific timestamp
     */
    async replayToTime(entityId, timestamp) {
        const targetDate = new Date(timestamp);

        // 1. Fetch all events for this entity up to the timestamp
        const events = await FinancialEvent.find({
            entityId,
            'metadata.timestamp': { $lte: targetDate }
        }).sort({ version: 1 });

        if (!events.length) return null;

        // 2. Start with an empty object and apply events in order
        return eventDiffEngine.reconstruct({}, events);
    }

    /**
     * Replay an entity's state to a specific version
     */
    async replayToVersion(entityId, version) {
        const events = await FinancialEvent.find({
            entityId,
            version: { $lte: version }
        }).sort({ version: 1 });

        if (!events.length) return null;

        return eventDiffEngine.reconstruct({}, events);
    }

    /**
     * Construct a forensic audit report for an entity
     */
    async generateAuditTrail(entityId) {
        const events = await FinancialEvent.find({ entityId }).sort({ version: 1 }).populate('userId', 'name email');

        return events.map(event => ({
            version: event.version,
            action: event.eventType,
            actor: event.userId.name,
            timestamp: event.metadata.timestamp,
            changes: event.payload._isDelta ? event.payload.diff : 'FULL_SNAPSHOT',
            correlationId: event.metadata.correlationId
        }));
    }
}

module.exports = new ForensicReplayEngine();
