const transactionService = require('./transactionService');
const Transaction = require('../models/Transaction');

// Wrapper for backward compatibility
class ExpenseService {
    async createExpense(rawData, userId, io) {
        console.warn('Deprecation Warning: ExpenseService.createExpense is deprecated. Use TransactionService.createTransaction instead.');
        return await transactionService.createTransaction(rawData, userId, io);
    }

    /**
     * Get expenses by approval status
     */
    async getExpensesByStatus(workspaceId, status) {
        return await Transaction.find({
            workspace: workspaceId,
            approvalStatus: status
        }).populate('createdBy', 'name email');
    }
}

module.exports = new ExpenseService();
