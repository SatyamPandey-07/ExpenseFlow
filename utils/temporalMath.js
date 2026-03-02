/**
 * Temporal Math Utility
 * Issue #842: Logic for merging state across shard boundaries during forensic replay.
 * Handles "Temporal Slicing" where we need to combine results from multiple chronological shards.
 */
class TemporalMath {
    /**
     * Merge multiple partial states derived from different shards.
     * Newer shards (later in time) override older shards for the same keys.
     */
    static mergeStates(states) {
        if (!states || states.length === 0) return {};
        if (states.length === 1) return states[0];

        // Sort by timestamp if available, or assume chronological order of shards
        return states.reduce((finalState, currentState) => {
            return {
                ...finalState,
                ...currentState,
                // Ensure versioning or sequence numbers are maintained
                lastModifiedAt: currentState.lastModifiedAt || finalState.lastModifiedAt,
                lastEventSequence: Math.max(currentState.lastEventSequence || 0, finalState.lastEventSequence || 0)
            };
        }, {});
    }

    /**
     * Slice a full event stream into temporal buckets.
     */
    static sliceByTime(events, bucketSizeMs = 3600000) { // Default 1 hour
        const buckets = {};

        events.forEach(event => {
            const bucketKey = Math.floor(event.timestamp.getTime() / bucketSizeMs) * bucketSizeMs;
            if (!buckets[bucketKey]) buckets[bucketKey] = [];
            buckets[bucketKey].push(event);
        });

        return buckets;
    }
}

module.exports = TemporalMath;
