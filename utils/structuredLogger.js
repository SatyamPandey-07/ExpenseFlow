/**
 * Basic Structured Logger (Fallback for Event Bus)
 */
class BasicLogger {
    info(msg, meta) { console.log(JSON.stringify({ level: 'INFO', msg, ...meta })); }
    warn(msg, meta) { console.warn(JSON.stringify({ level: 'WARN', msg, ...meta })); }
    error(msg, meta) { console.error(JSON.stringify({ level: 'ERROR', msg, ...meta })); }
    debug(msg, meta) { console.debug(JSON.stringify({ level: 'DEBUG', msg, ...meta })); }
    critical(msg, meta) { console.error(JSON.stringify({ level: 'CRITICAL', msg, ...meta })); }
    getStorage() { return { run: (ctx, fn) => fn() }; }
}

module.exports = new BasicLogger();
