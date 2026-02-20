const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Global store for request-scoped context (Correlation IDs)
 */
const storage = new AsyncLocalStorage();

/**
 * Structured Logger Engine
 * Issue #713: Implements high-performance JSON-based structured logging.
 */
class StructuredLogger {
    constructor() {
        this.logDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir);
        }

        this.levels = {
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3,
            CRITICAL: 4
        };

        this.minLevel = process.env.LOG_LEVEL || 'INFO';
    }

    /**
     * Internal method to write the log entry
     */
    _write(level, message, metadata = {}) {
        if (this.levels[level] < this.levels[this.minLevel]) return;

        const context = storage.getStore() || {};
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            traceId: context.traceId || 'system',
            userId: context.userId || 'anonymous',
            ...metadata,
            environment: process.env.NODE_ENV || 'development',
            version: process.env.APP_VERSION || '1.0.0'
        };

        const logString = JSON.stringify(logEntry);

        // Output to console for cloud log collectors (like Vercel/AWS)
        if (level === 'ERROR' || level === 'CRITICAL') {
            console.error(logString);
        } else {
            console.log(logString);
        }

        // Also write to local file for development audit trails
        const logFile = path.join(this.logDir, `${level.toLowerCase()}.log`);
        fs.appendFile(logFile, logString + '\n', (err) => {
            if (err) console.error('Failed to write to log file:', err);
        });
    }

    info(msg, meta) { this._write('INFO', msg, meta); }
    debug(msg, meta) { this._write('DEBUG', msg, meta); }
    warn(msg, meta) { this._write('WARN', msg, meta); }
    error(msg, meta) { this._write('ERROR', msg, meta); }
    critical(msg, meta) { this._write('CRITICAL', msg, meta); }

    /**
     * Provide access to the storage for middleware integration
     */
    getStorage() {
        return storage;
    }
}

module.exports = new StructuredLogger();
