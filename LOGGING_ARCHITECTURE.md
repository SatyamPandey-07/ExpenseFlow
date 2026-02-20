# Centralized Structured Logging & Telemetry Pipeline

## 🚀 Overview
Issue #713 overhauls the application's logging infrastructure, moving from primitive `console.log` statements to a professional **Structured JSON Logging System**. This allows for high-resolution request tracing, automated monitoring, and easier debugging across distributed components.

## 🏗️ Technical Architecture

### 1. Structured Logger (`utils/structuredLogger.js`)
The core engine that produces JSON-formatted logs.
- **AsyncLocalStorage**: Uses Node.js `AsyncLocalStorage` to automatically propagate Trace IDs (Correlation IDs) across asynchronous operations without manual prop-drilling.
- **Log Levels**: Supports `DEBUG`, `INFO`, `WARN`, `ERROR`, and `CRITICAL`.
- **Metadata Support**: Every log can include a dynamic metadata object for rich context.

### 2. Request Correlation (`middleware/requestCorrelation.js`)
- Generates a `traceId` for every incoming HTTP request.
- Injects this ID into the logger's storage context.
- Returns the ID as a response header (`x-trace-id`) for better client-side troubleshooting.

### 3. HTTP Traffic Interceptor (`middleware/httpLogger.js`)
- Records every request and response.
- Calculates and logs the **Response Latency** in milliseconds.
- Automatically adjusts log levels based on HTTP status codes (4xx = Warn, 5xx = Error).

### 4. Telemetry Sink (`utils/telemetryExporter.js`)
- Implements a buffered export pattern.
- Batches logs to reduce I/O overhead.
- Simulates integration with professional observability platforms (Datadog/NewRelic).

## 📂 File Structure
- `utils/structuredLogger.js`: The JSON logger engine.
- `middleware/requestCorrelation.js`: Context provider.
- `middleware/httpLogger.js`: Network telemetry.
- `utils/telemetryExporter.js`: Centralized export.
- `routes/telemetry.js`: Visibility API.
- `jobs/logRotator.js`: Maintenance & disk cleanup.

## 📊 Sample Log Entry
```json
{
  "timestamp": "2026-02-19T13:14:02.123Z",
  "level": "INFO",
  "message": "Completed POST /api/expenses [201]",
  "traceId": "a1b2c3d4-e5f6-7890",
  "userId": "648f12a3b4c5",
  "type": "http_response",
  "durationMs": 45,
  "environment": "production"
}
```

## ✅ Implementation Checklist
- [x] JSON-structured logger with `AsyncLocalStorage`.
- [x] Request Trace ID propagation middleware.
- [x] Automatic HTTP latency logging.
- [x] Batch log exporter with buffering logic.
- [x] Log rotation and archival background job.
- [x] Refactored existing services to use structured logs.
