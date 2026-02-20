const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');
const logger = require('../utils/structuredLogger');

/**
 * Telemetry API
 * Issue #713: Provides visibility into the centralized logging pipeline.
 */

router.get('/stats', auth, async (req, res) => {
    try {
        const logDir = path.join(process.cwd(), 'logs');
        const files = fs.readdirSync(logDir);

        const stats = files.map(file => {
            const filePath = path.join(logDir, file);
            const size = fs.statSync(filePath).size;
            return {
                level: file.split('.')[0],
                sizeBytes: size,
                lastUpdated: fs.statSync(filePath).mtime
            };
        });

        res.json({
            success: true,
            data: {
                activeLogs: stats,
                loggerConfig: {
                    minLevel: process.env.LOG_LEVEL || 'INFO',
                    environment: process.env.NODE_ENV || 'development'
                }
            }
        });
    } catch (err) {
        logger.error('Failed to retrieve telemetry stats', { error: err.message });
        res.status(500).json({ success: false, error: 'Failed to access log subsystem' });
    }
});

router.get('/tail/:level', auth, async (req, res) => {
    const { level } = req.params;
    const logFile = path.join(process.cwd(), 'logs', `${level.toLowerCase()}.log`);

    if (!fs.existsSync(logFile)) {
        return res.status(404).json({ success: false, error: 'Log level file not found' });
    }

    try {
        // Simple tail: last 50 lines
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n').slice(-50);
        const logs = lines.map(line => JSON.parse(line));

        res.json({ success: true, data: logs });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to read log file' });
    }
});

module.exports = router;
