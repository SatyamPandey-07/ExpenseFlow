const AuditSnapshot = require('../models/AuditSnapshot');
const StateDelta = require('../models/StateDelta');
const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const Goal = require('../models/Goal');

/**
 * ReplayEngine - Time Machine for Financial State Reconstruction
 * Reconstructs exact financial state at any historical point
 */
class ReplayEngine {
    /**
     * Replay state to a specific point in time
     * @param {String} userId - User ID
     * @param {Date} targetDate - Target date to replay to
     * @param {Object} options - Replay options
     * @returns {Object} Reconstructed state
     */
    async replayToDate(userId, targetDate, options = {}) {
        const startTime = Date.now();
        const { includeTransactions = true, includeMetadata = true } = options;

        try {
            // Step 1: Find the closest snapshot before target date
            const baseSnapshot = await this.findClosestSnapshot(userId, targetDate);

            let state;
            let deltaCount = 0;

            if (baseSnapshot) {
                // Start from snapshot
                state = JSON.parse(JSON.stringify(baseSnapshot.state));

                // Step 2: Apply deltas from snapshot to target date
                const deltas = await StateDelta.find({
                    user: userId,
                    timestamp: {
                        $gt: baseSnapshot.snapshotDate,
                        $lte: targetDate
                    }
                }).sort({ timestamp: 1 });

                deltaCount = deltas.length;
                state = await this.applyDeltas(state, deltas);
            } else {
                // No snapshot found, reconstruct from scratch
                state = await this.reconstructFromScratch(userId, targetDate);
            }

            // Step 3: Add transaction details if requested
            if (includeTransactions) {
                state.transactions = await this.getTransactionsUpTo(userId, targetDate);
            }

            const result = {
                success: true,
                targetDate,
                state,
                metadata: includeMetadata ? {
                    baseSnapshot: baseSnapshot ? {
                        date: baseSnapshot.snapshotDate,
                        type: baseSnapshot.snapshotType
                    } : null,
                    deltasApplied: deltaCount,
                    reconstructionMethod: baseSnapshot ? 'snapshot+deltas' : 'from-scratch',
                    reconstructionTime: Date.now() - startTime
                } : undefined
            };

            return result;
        } catch (error) {
            console.error('[ReplayEngine] Error during replay:', error);
            throw error;
        }
    }

    /**
     * Find closest snapshot before target date
     */
    async findClosestSnapshot(userId, targetDate) {
        return await AuditSnapshot.findOne({
            user: userId,
            snapshotDate: { $lte: targetDate }
        }).sort({ snapshotDate: -1 });
    }

    /**
     * Apply deltas to a state
     */
    async applyDeltas(state, deltas) {
        for (const delta of deltas) {
            state = this.applyDelta(state, delta);
        }
        return state;
    }

    /**
     * Apply single delta to state
     */
    applyDelta(state, delta) {
        const { operation, entityType, financialImpact } = delta;

        // Update balance
        if (financialImpact && financialImpact.balanceChange) {
            state.totalBalance = (state.totalBalance || 0) + financialImpact.balanceChange;

            if (financialImpact.balanceChange > 0) {
                state.totalIncome = (state.totalIncome || 0) + financialImpact.balanceChange;
            } else {
                state.totalExpenses = (state.totalExpenses || 0) + Math.abs(financialImpact.balanceChange);
            }
        }

        // Update category breakdown
        if (financialImpact && financialImpact.affectedCategories) {
            financialImpact.affectedCategories.forEach(category => {
                const categoryEntry = state.categoryBreakdown.find(c => c.category === category);
                if (categoryEntry) {
                    categoryEntry.amount += financialImpact.balanceChange;
                    categoryEntry.transactionCount += (operation === 'create' ? 1 : operation === 'delete' ? -1 : 0);
                } else if (operation === 'create') {
                    state.categoryBreakdown.push({
                        category,
                        amount: financialImpact.balanceChange,
                        transactionCount: 1
                    });
                }
            });
        }

        // Update transaction count
        if (operation === 'create') {
            state.transactionCount = (state.transactionCount || 0) + 1;
        } else if (operation === 'delete') {
            state.transactionCount = Math.max(0, (state.transactionCount || 0) - 1);
        }

        // Update budgets
        if (entityType === 'budget') {
            this.updateBudgetInState(state, delta);
        }

        // Update goals
        if (entityType === 'goal') {
            this.updateGoalInState(state, delta);
        }

        return state;
    }

    /**
     * Update budget in state
     */
    updateBudgetInState(state, delta) {
        const { operation, entityId, afterState } = delta;

        if (!state.budgets) state.budgets = [];

        const budgetIndex = state.budgets.findIndex(b => b.budgetId.toString() === entityId.toString());

        if (operation === 'create' && afterState) {
            state.budgets.push({
                budgetId: entityId,
                limit: afterState.limit,
                spent: afterState.spent || 0,
                remaining: afterState.limit - (afterState.spent || 0)
            });
        } else if (operation === 'update' && budgetIndex !== -1 && afterState) {
            state.budgets[budgetIndex] = {
                budgetId: entityId,
                limit: afterState.limit,
                spent: afterState.spent || 0,
                remaining: afterState.limit - (afterState.spent || 0)
            };
        } else if (operation === 'delete' && budgetIndex !== -1) {
            state.budgets.splice(budgetIndex, 1);
        }
    }

    /**
     * Update goal in state
     */
    updateGoalInState(state, delta) {
        const { operation, entityId, afterState } = delta;

        if (!state.goals) state.goals = [];

        const goalIndex = state.goals.findIndex(g => g.goalId.toString() === entityId.toString());

        if (operation === 'create' && afterState) {
            state.goals.push({
                goalId: entityId,
                targetAmount: afterState.targetAmount,
                currentAmount: afterState.currentAmount || 0,
                progress: ((afterState.currentAmount || 0) / afterState.targetAmount) * 100
            });
        } else if (operation === 'update' && goalIndex !== -1 && afterState) {
            state.goals[goalIndex] = {
                goalId: entityId,
                targetAmount: afterState.targetAmount,
                currentAmount: afterState.currentAmount || 0,
                progress: ((afterState.currentAmount || 0) / afterState.targetAmount) * 100
            };
        } else if (operation === 'delete' && goalIndex !== -1) {
            state.goals.splice(goalIndex, 1);
        }
    }

    /**
     * Reconstruct state from scratch (when no snapshot available)
     */
    async reconstructFromScratch(userId, targetDate) {
        const state = {
            totalBalance: 0,
            totalIncome: 0,
            totalExpenses: 0,
            categoryBreakdown: [],
            budgets: [],
            goals: [],
            accounts: [],
            transactionCount: 0,
            currency: 'INR'
        };

        // Get all deltas up to target date
        const deltas = await StateDelta.find({
            user: userId,
            timestamp: { $lte: targetDate }
        }).sort({ timestamp: 1 });

        return await this.applyDeltas(state, deltas);
    }

    /**
     * Get transactions up to a specific date
     */
    async getTransactionsUpTo(userId, targetDate) {
        return await Expense.find({
            user: userId,
            date: { $lte: targetDate }
        }).sort({ date: -1 }).limit(100);
    }

    /**
     * Compare two states
     */
    async compareStates(userId, date1, date2) {
        const [state1, state2] = await Promise.all([
            this.replayToDate(userId, date1, { includeTransactions: false }),
            this.replayToDate(userId, date2, { includeTransactions: false })
        ]);

        return {
            date1,
            date2,
            state1: state1.state,
            state2: state2.state,
            differences: {
                balanceChange: state2.state.totalBalance - state1.state.totalBalance,
                incomeChange: state2.state.totalIncome - state1.state.totalIncome,
                expenseChange: state2.state.totalExpenses - state1.state.totalExpenses,
                transactionCountChange: state2.state.transactionCount - state1.state.transactionCount
            }
        };
    }

    /**
     * Get state evolution over time
     */
    async getStateEvolution(userId, startDate, endDate, interval = 'daily') {
        const evolution = [];
        const current = new Date(startDate);
        const end = new Date(endDate);

        while (current <= end) {
            const state = await this.replayToDate(userId, current, {
                includeTransactions: false,
                includeMetadata: false
            });

            evolution.push({
                date: new Date(current),
                balance: state.state.totalBalance,
                income: state.state.totalIncome,
                expenses: state.state.totalExpenses
            });

            // Increment based on interval
            if (interval === 'daily') {
                current.setDate(current.getDate() + 1);
            } else if (interval === 'weekly') {
                current.setDate(current.getDate() + 7);
            } else if (interval === 'monthly') {
                current.setMonth(current.getMonth() + 1);
            }
        }

        return evolution;
    }
}

module.exports = new ReplayEngine();
