# Transaction Processing Pipeline Refactor

## 🚀 Overview
Issue #628 transforms the monolithic transaction creation logic into a multi-stage, asynchronous processing pipeline. This architectural shift improves system resilience, provides better user feedback via status tracking, and decouples cross-cutting concerns (budgets, goals, AI) into an event-driven model.

## 🏗️ New Pipeline Architecture

### 1. Multi-Stage Lifecycle
Transactions now follow a strict state machine:
- **`pending`**: Initial record created and saved to DB. User receives a `202 Accepted` response.
- **`processing`**: System is actively applying rules and performing currency conversions.
- **`validated`**: All enrichment steps complete. Transaction is now included in financial reports.
- **`failed`**: A critical error occurred. Detailed reason is stored in `processingLogs`.

### 2. Processing Steps
The pipeline executes the following stages in order:
1.  **Persistence**: Immediate DB save to prevent data loss.
2.  **Rule Engine**: Applies categorized automation rules and overrides.
3.  **Forex Enrichment**: Handles currency conversion and primes historical metadata.
4.  **Approvals**: Determines if workspace-level approval is required.
5.  **Event Dispatch**: Triggers secondary systems (Budgets, Goals, AI).

### 3. Decoupled Event System
Introduced `services/eventDispatcher.js` to handle non-core logic. The `BudgetService` now observes the `transaction:validated` event, ensuring that budget alerts are only triggered for data that has passed all pipeline stages.

## 🛠️ Technical Details

### Model Changes (`models/Transaction.js`)
- **`status`**: New enum field for state management.
- **`processingLogs`**: Audit trail of every step in the pipeline.
- **`logStep()`**: New model method for standardized audit logging.

### New Components
- **`middleware/transactionValidator.js`**: Centralized validation logic using `express-validator`.
- **`services/eventDispatcher.js`**: Lightweight pub/sub for service communication.
- **`scripts/transactionMigration.js`**: Data migration tool to backfill status for existing records.

## ✅ How to Verify
1. **Run Migration**:
   ```bash
   node scripts/transactionMigration.js
   ```
2. **Run Pipeline Tests**:
   ```bash
   npm test tests/pipeline.test.js
   ```
3. **Monitor Status**:
   New API endpoint: `GET /api/transactions/:id/processing-logs`
