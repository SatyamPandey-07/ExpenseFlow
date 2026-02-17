# Immutable Event-Sourced Audit Log & Forensic Replay

## 🚀 Overview
Issue #680 transforms the traditional "state-overwrite-and-log" persistence model into a professional **Event Sourcing** architecture. Instead of treating the database as the source of truth, the **Event Store** becomes the immutable record of all financial transitions, allowing for perfect forensic replay and mathematical verification of any state at any point in history.

## 🏗️ Technical Architecture

### 1. The Immutable Event Store (`models/FinancialEvent.js`)
Every mutation (CREATE, UPDATE, DELETE) is recorded as a discrete event.
- **Linked Chain**: Each event points to its predecessor (`previousEventId`), creating a cryptographically verifiable chain.
- **Deep Deltas**: For updates, only the field-level diff is stored, optimizing space and audit clarity.
- **Checksums**: Every event includes a SHA-256 hash of its payload and its parent ID, making it impossible to tamper with history undetected.

### 2. State Reconstruction Engine (`services/forensicReplayEngine.js`)
The "Time Travel" core of the system:
- **Point-in-Time Replay**: Reconstructs the exact state of any transaction, budget, or workspace as it existed at any specific millisecond in the past.
- **Version Replay**: Allows replaying to a specific version number to debug development issues or revert malicious changes.
- **Audit Trails**: Generates human-readable narratives of who changed what, when, and from where.

### 3. Non-Intrusive Interceptor (`middleware/eventInterceptor.js`)
A low-level Express middleware that hooks into all mutating routes. It:
1. Captures the state **before** the mutation.
2. Intercepts the response **after** the mutation is successful.
3. Calculates the diff and logs the event asynchronously to avoid blocking the user.

### 4. Integrity Validation (`services/eventProcessor.js`)
A security utility that traverses the entire event chain for an entity and recalculates checksums. If even a single byte has been altered in the database by an attacker, the verification system will flag the exact point of corruption.

## 🛠️ API Reference

### `GET /api/forensics/replay/:id?time=ISO_DATE`
Reconstructs and returns the entity's state at the specified time.

### `GET /api/forensics/audit/:id`
Returns a tabular audit trail of every modification ever made to the entity.

### `POST /api/forensics/verify/:id`
Triggers a cryptographic integrity check of the entity's history.

## ✅ Implementation Checklist
- [x] Immutable `FinancialEvent` schema with parent linkage.
- [x] Deep-diff utility for field-level mutation tracking.
- [x] Middleware interceptor for transparent event capture.
- [x] State reconstruction engine for point-in-time replay.
- [x] Forensic audit API routes.
- [x] Background archiver for old events.

## 🧪 Testing
Run the forensics test suite:
```bash
npm test tests/forensics.test.js
```
