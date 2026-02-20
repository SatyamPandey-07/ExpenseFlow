const AppEventBus = require('../utils/AppEventBus');
const EVENTS = require('../config/eventRegistry');
const logger = require('../utils/structuredLogger');

/**
 * System Audit Listeners
 * Issue #711: Handles compliance, analytics, and forensic logging asynchronously.
 */
class AuditListeners {
    init() {
        console.log('[AuditListeners] Initializing forensic audit hooks...');

        // Subscribe to Transaction changes
        AppEventBus.subscribe(EVENTS.TRANSACTION.CREATED, this.handleTransactionCreated);
        AppEventBus.subscribe(EVENTS.TRANSACTION.DELETED, this.handleTransactionDeleted);
    }

    async handleTransactionCreated(transaction) {
        logger.info(`[AuditService] Logging transaction creation for entity ${transaction._id}`, {
            amount: transaction.amount,
            userId: transaction.user,
            component: 'ConsensusEngine'
        });

        // Async side effect: Update user spending velocity cache
        // await analyticsService.recalculateVelocity(transaction.user);
    }

    async handleTransactionDeleted(payload) {
        logger.warn(`[AuditService] Sensitive data removal detected`, {
            entityId: payload.id,
            removedBy: payload.userId
        });
    }
}

module.exports = new AuditListeners();
