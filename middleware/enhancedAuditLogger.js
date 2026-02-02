const StateDelta = require('../models/StateDelta');

/**
 * Enhanced Audit Logger - Captures before/after states for all mutations
 * Integrates with StateDelta model for forensic replay
 */
class EnhancedAuditLogger {
    /**
     * Log a state change with delta tracking
     */
    static async logStateChange(options) {
        const {
            userId,
            entityType,
            entityId,
            operation,
            beforeState,
            afterState,
            req,
            metadata = {}
        } = options;

        try {
            // Calculate changed fields
            const changedFields = this.calculateChangedFields(beforeState, afterState);

            // Calculate financial impact
            const financialImpact = this.calculateFinancialImpact(
                entityType,
                operation,
                beforeState,
                afterState
            );

            // Create delta record
            const delta = await StateDelta.createDelta({
                user: userId,
                timestamp: new Date(),
                entityType,
                entityId,
                operation,
                beforeState,
                afterState,
                changedFields,
                financialImpact,
                context: {
                    userId,
                    sessionId: req?.sessionID || req?.headers?.['x-session-id'],
                    ipAddress: this.getClientIP(req),
                    userAgent: req?.get('user-agent'),
                    requestId: req?.id || req?.headers?.['x-request-id'],
                    workspaceId: req?.body?.workspaceId || req?.params?.workspaceId
                },
                metadata: {
                    source: metadata.source || 'api',
                    reason: metadata.reason,
                    tags: metadata.tags || []
                }
            });

            return delta;
        } catch (error) {
            console.error('[EnhancedAuditLogger] Error logging state change:', error);
            throw error;
        }
    }

    /**
     * Calculate which fields changed
     */
    static calculateChangedFields(beforeState, afterState) {
        if (!beforeState || !afterState) return [];

        const changes = [];
        const allKeys = new Set([
            ...Object.keys(beforeState || {}),
            ...Object.keys(afterState || {})
        ]);

        for (const key of allKeys) {
            // Skip internal MongoDB fields
            if (key.startsWith('_') || key === '__v') continue;

            const oldValue = beforeState[key];
            const newValue = afterState[key];

            // Deep comparison for objects
            if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                changes.push({
                    field: key,
                    oldValue,
                    newValue
                });
            }
        }

        return changes;
    }

    /**
     * Calculate financial impact of a change
     */
    static calculateFinancialImpact(entityType, operation, beforeState, afterState) {
        const impact = {
            balanceChange: 0,
            affectedCategories: [],
            affectedBudgets: [],
            affectedGoals: []
        };

        if (entityType === 'expense' || entityType === 'income' || entityType === 'transfer') {
            if (operation === 'create' && afterState) {
                // New transaction
                impact.balanceChange = afterState.type === 'income'
                    ? afterState.amount
                    : -afterState.amount;
                impact.affectedCategories = [afterState.category];
            } else if (operation === 'delete' && beforeState) {
                // Deleted transaction (reverse the impact)
                impact.balanceChange = beforeState.type === 'income'
                    ? -beforeState.amount
                    : beforeState.amount;
                impact.affectedCategories = [beforeState.category];
            } else if (operation === 'update' && beforeState && afterState) {
                // Updated transaction
                const oldImpact = beforeState.type === 'income'
                    ? beforeState.amount
                    : -beforeState.amount;
                const newImpact = afterState.type === 'income'
                    ? afterState.amount
                    : -afterState.amount;

                impact.balanceChange = newImpact - oldImpact;
                impact.affectedCategories = [
                    beforeState.category,
                    afterState.category
                ].filter((v, i, a) => a.indexOf(v) === i); // unique
            }
        }

        // Track affected budgets
        if (beforeState?.budgetId) {
            impact.affectedBudgets.push(beforeState.budgetId);
        }
        if (afterState?.budgetId && afterState.budgetId !== beforeState?.budgetId) {
            impact.affectedBudgets.push(afterState.budgetId);
        }

        // Track affected goals
        if (beforeState?.goalId) {
            impact.affectedGoals.push(beforeState.goalId);
        }
        if (afterState?.goalId && afterState.goalId !== beforeState?.goalId) {
            impact.affectedGoals.push(afterState.goalId);
        }

        return impact;
    }

    /**
     * Get client IP address
     */
    static getClientIP(req) {
        if (!req) return 'unknown';

        return (
            req.headers?.['x-forwarded-for'] ||
            req.headers?.['x-real-ip'] ||
            req.connection?.remoteAddress ||
            req.socket?.remoteAddress ||
            'unknown'
        );
    }

    /**
     * Middleware to automatically capture state changes
     */
    static captureMiddleware(entityType) {
        return async (req, res, next) => {
            // Only for state-changing operations
            if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
                return next();
            }

            // Store original json method
            const originalJson = res.json.bind(res);

            // Override json method to capture state
            res.json = async function (data) {
                // Log state change asynchronously
                if (req.user && data && (data.success !== false)) {
                    setImmediate(async () => {
                        try {
                            const operation = req.method === 'POST' ? 'create' :
                                req.method === 'DELETE' ? 'delete' : 'update';

                            const entityId = req.params.id || data._id || data.data?._id;

                            if (entityId) {
                                await EnhancedAuditLogger.logStateChange({
                                    userId: req.user._id || req.user.id,
                                    entityType,
                                    entityId,
                                    operation,
                                    beforeState: req.auditData?.originalState,
                                    afterState: data.data || data,
                                    req,
                                    metadata: {
                                        source: 'api',
                                        tags: [req.method.toLowerCase()]
                                    }
                                });
                            }
                        } catch (error) {
                            console.error('[EnhancedAuditLogger] Middleware error:', error);
                        }
                    });
                }

                return originalJson(data);
            };

            next();
        };
    }
}

module.exports = EnhancedAuditLogger;
