const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const forensicReplayEngine = require('../services/forensicReplayEngine');
const eventProcessor = require('../services/eventProcessor');

/**
 * @route   GET /api/forensics/replay/:entityId
 * @desc    Replay state to a specific time or version
 */
router.get('/replay/:entityId', auth, async (req, res) => {
    try {
        const { entityId } = req.params;
        const { time, v } = req.query;

        let state;
        if (time) {
            state = await forensicReplayEngine.replayToTime(entityId, time);
        } else if (v) {
            state = await forensicReplayEngine.replayToVersion(entityId, parseInt(v));
        } else {
            return res.status(400).json({ success: false, error: 'Provide time or version (v)' });
        }

        res.json({ success: true, data: state });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route   GET /api/forensics/audit/:entityId
 * @desc    Get complete audit trail (event log) for an entity
 */
router.get('/audit/:entityId', auth, async (req, res) => {
    try {
        const trail = await forensicReplayEngine.generateAuditTrail(req.params.entityId);
        res.json({ success: true, data: trail });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route   POST /api/forensics/verify/:entityId
 * @desc    Verify the integrity of an entity's event chain
 */
router.post('/verify/:entityId', auth, async (req, res) => {
    try {
        const result = await eventProcessor.verifyIntegrity(req.params.entityId);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
