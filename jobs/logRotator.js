const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/structuredLogger');

/**
 * Log Rotator Job
 * Issue #713: Prevents log files from consuming infinite disk space.
 */
class LogRotator {
    constructor() {
        this.logDir = path.join(process.cwd(), 'logs');
    }

    start() {
        console.log('[LogRotator] Initializing log rotation worker...');

        // Run every night at midnight
        cron.schedule('0 0 * * *', () => {
            this.rotate();
        });
    }

    rotate() {
        logger.info('Starting nightly log rotation sequence...');

        try {
            const files = fs.readdirSync(this.logDir);
            const timestamp = new Date().toISOString().replace(/:/g, '-');

            for (const file of files) {
                if (file.endsWith('.log') && !file.includes('_archive_')) {
                    const oldPath = path.join(this.logDir, file);
                    const newPath = path.join(this.logDir, `${file.replace('.log', '')}_archive_${timestamp}.log`);

                    // In a real system, we might GZIP this, or move it to S3
                    fs.renameSync(oldPath, newPath);
                }
            }

            // Also clean up archives older than 7 days
            this.cleanupArchives();

            logger.info('Log rotation completed successfully.');
        } catch (err) {
            logger.error('Log rotation failed', { error: err.message });
        }
    }

    cleanupArchives() {
        const files = fs.readdirSync(this.logDir);
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        for (const file of files) {
            if (file.includes('_archive_')) {
                const filePath = path.join(this.logDir, file);
                const stats = fs.statSync(filePath);

                if (stats.mtimeMs < sevenDaysAgo) {
                    fs.unlinkSync(filePath);
                }
            }
        }
    }
}

module.exports = new LogRotator();
