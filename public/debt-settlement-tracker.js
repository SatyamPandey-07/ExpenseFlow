/**
 * Debt Settlement Tracker - Optimized Payment Management
 * 
 * Tracks who owes whom, calculates net balances, and optimizes settlement transactions
 * to minimize the number of payments needed. Uses graph algorithms for debt simplification.
 * 
 * Features:
 * - Real-time debt tracking across all workspace members
 * - Net balance calculation (A owes B, B owes A = net amount)
 * - Settlement optimization (minimize number of transactions)
 * - Payment recording and verification
 * - Settlement suggestions and reminders
 * - Debt history and audit trail
 * - Multi-currency support
 * - Partial payment handling
 * 
 * @class DebtSettlementTracker
 * @version 1.0.0
 * @author ExpenseFlow Team
 */

class DebtSettlementTracker {
  constructor() {
    this.debts = new Map(); // debtId -> debt object
    this.settlements = new Map(); // settlementId -> settlement object
    this.balances = new Map(); // userId -> balance info
    this.debtGraph = new Map(); // userId -> Map(otherUserId -> amount)
  }

  /**
   * Initialize with workspace expenses
   * @param {Array} expenses - Array of expense objects with splits
   * @returns {Object} Initial debt summary
   */
  async init(expenses) {
    try {
      console.log(`Initializing debt tracker with ${expenses.length} expenses`);
      
      // Build debt graph from expenses
      this.buildDebtGraph(expenses);
      
      // Calculate net balances
      this.calculateBalances();
      
      return this.getDebtSummary();
    } catch (error) {
      console.error('Error initializing debt tracker:', error);
      throw error;
    }
  }

  /**
   * Build debt graph from expenses
   * @param {Array} expenses - Array of expenses
   */
  buildDebtGraph(expenses) {
    this.debtGraph.clear();
    
    expenses.forEach(expense => {
      if (!expense.splits || expense.splits.length === 0) return;
      
      const paidBy = expense.paidBy;
      const totalPaid = expense.amount;
      
      expense.splits.forEach(split => {
        if (split.userId === paidBy) {
          // Person who paid owes themselves their split (net zero)
          return;
        }
        
        // This person owes the payer their split amount
        this.addDebt(split.userId, paidBy, split.amount);
      });
    });
  }

  /**
   * Add debt to graph
   * @param {string} fromUserId - Person who owes
   * @param {string} toUserId - Person owed
   * @param {number} amount - Amount owed
   */
  addDebt(fromUserId, toUserId, amount) {
    if (!this.debtGraph.has(fromUserId)) {
      this.debtGraph.set(fromUserId, new Map());
    }
    
    const userDebts = this.debtGraph.get(fromUserId);
    const currentDebt = userDebts.get(toUserId) || 0;
    userDebts.set(toUserId, currentDebt + amount);
  }

  /**
   * Calculate net balances for all users
   */
  calculateBalances() {
    this.balances.clear();
    
    // Get all users
    const allUsers = new Set();
    this.debtGraph.forEach((debts, fromUser) => {
      allUsers.add(fromUser);
      debts.forEach((amount, toUser) => {
        allUsers.add(toUser);
      });
    });
    
    // Calculate net balance for each user
    allUsers.forEach(userId => {
      const owed = this.getTotalOwed(userId); // Money owed to this user
      const owes = this.getTotalOwes(userId); // Money this user owes
      const netBalance = owed - owes;
      
      this.balances.set(userId, {
        userId,
        totalOwed: owed,
        totalOwes: owes,
        netBalance,
        status: netBalance > 0 ? 'creditor' : netBalance < 0 ? 'debtor' : 'settled'
      });
    });
  }

  /**
   * Get total amount owed TO a user
   * @param {string} userId - User ID
   * @returns {number} Total owed to user
   */
  getTotalOwed(userId) {
    let total = 0;
    
    this.debtGraph.forEach((debts, fromUser) => {
      if (debts.has(userId)) {
        total += debts.get(userId);
      }
    });
    
    return total;
  }

  /**
   * Get total amount a user owes
   * @param {string} userId - User ID
   * @returns {number} Total user owes
   */
  getTotalOwes(userId) {
    if (!this.debtGraph.has(userId)) return 0;
    
    const userDebts = this.debtGraph.get(userId);
    let total = 0;
    
    userDebts.forEach(amount => {
      total += amount;
    });
    
    return total;
  }

  /**
   * Get balance for specific user
   * @param {string} userId - User ID
   * @returns {Object} Balance object
   */
  getUserBalance(userId) {
    return this.balances.get(userId) || {
      userId,
      totalOwed: 0,
      totalOwes: 0,
      netBalance: 0,
      status: 'settled'
    };
  }

  /**
   * Get all balances
   * @returns {Array} Array of balance objects
   */
  getAllBalances() {
    return Array.from(this.balances.values());
  }

  /**
   * Get detailed debt breakdown for a user
   * @param {string} userId - User ID
   * @returns {Object} Detailed breakdown
   */
  getDetailedBreakdown(userId) {
    const owes = []; // What this user owes to others
    const owed = []; // What others owe to this user
    
    // What user owes
    if (this.debtGraph.has(userId)) {
      const userDebts = this.debtGraph.get(userId);
      userDebts.forEach((amount, toUser) => {
        owes.push({
          toUserId: toUser,
          amount: this.roundAmount(amount)
        });
      });
    }
    
    // What others owe to user
    this.debtGraph.forEach((debts, fromUser) => {
      if (debts.has(userId)) {
        owed.push({
          fromUserId: fromUser,
          amount: this.roundAmount(debts.get(userId))
        });
      }
    });
    
    return {
      userId,
      owes,
      owed,
      netBalance: this.getUserBalance(userId).netBalance
    };
  }

  /**
   * Optimize settlements to minimize transactions
   * Uses greedy algorithm to match largest creditor with largest debtor
   * @returns {Array} Array of optimal settlement transactions
   */
  optimizeSettlements() {
    // Get all balances
    const balanceList = this.getAllBalances();
    
    // Separate creditors (positive balance) and debtors (negative balance)
    const creditors = balanceList
      .filter(b => b.netBalance > 0.01)
      .sort((a, b) => b.netBalance - a.netBalance);
    
    const debtors = balanceList
      .filter(b => b.netBalance < -0.01)
      .map(b => ({ ...b, netBalance: -b.netBalance }))
      .sort((a, b) => b.netBalance - a.netBalance);
    
    const transactions = [];
    let creditorIdx = 0;
    let debtorIdx = 0;
    
    while (creditorIdx < creditors.length && debtorIdx < debtors.length) {
      const creditor = creditors[creditorIdx];
      const debtor = debtors[debtorIdx];
      
      const amount = Math.min(creditor.netBalance, debtor.netBalance);
      
      transactions.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amount: this.roundAmount(amount),
        type: 'optimized'
      });
      
      creditor.netBalance -= amount;
      debtor.netBalance -= amount;
      
      if (creditor.netBalance < 0.01) creditorIdx++;
      if (debtor.netBalance < 0.01) debtorIdx++;
    }
    
    console.log(`Optimized ${balanceList.length} balances into ${transactions.length} transactions`);
    
    return transactions;
  }

  /**
   * Generate settlement suggestions for a user
   * @param {string} userId - User ID
   * @param {Object} options - Suggestion options
   * @returns {Array} Array of suggestions
   */
  generateSettlementSuggestions(userId, options = {}) {
    const breakdown = this.getDetailedBreakdown(userId);
    const suggestions = [];
    
    // If user owes money
    if (breakdown.owes.length > 0) {
      // Suggest paying largest debts first
      const sortedDebts = [...breakdown.owes].sort((a, b) => b.amount - a.amount);
      
      sortedDebts.forEach((debt, index) => {
        suggestions.push({
          priority: index + 1,
          type: 'payment',
          fromUserId: userId,
          toUserId: debt.toUserId,
          amount: debt.amount,
          reason: index === 0 ? 'Largest outstanding debt' : 'Outstanding debt'
        });
      });
    }
    
    // If others owe user
    if (breakdown.owed.length > 0) {
      const sortedOwed = [...breakdown.owed].sort((a, b) => b.amount - a.amount);
      
      sortedOwed.forEach((owed, index) => {
        suggestions.push({
          priority: index + 1,
          type: 'request',
          fromUserId: owed.fromUserId,
          toUserId: userId,
          amount: owed.amount,
          reason: 'Request payment'
        });
      });
    }
    
    return suggestions;
  }

  /**
   * Record a settlement payment
   * @param {Object} settlement - Settlement object
   * @returns {Object} Recorded settlement
   */
  recordSettlement(settlement) {
    const settlementRecord = {
      id: this.generateId('settlement'),
      fromUserId: settlement.fromUserId,
      toUserId: settlement.toUserId,
      amount: settlement.amount,
      currency: settlement.currency || 'USD',
      method: settlement.method || 'cash',
      note: settlement.note || '',
      createdAt: new Date().toISOString(),
      createdBy: settlement.createdBy || settlement.fromUserId,
      status: 'completed',
      verified: false
    };
    
    this.settlements.set(settlementRecord.id, settlementRecord);
    
    // Update debt graph
    this.settleDebt(settlement.fromUserId, settlement.toUserId, settlement.amount);
    
    // Recalculate balances
    this.calculateBalances();
    
    console.log(`Settlement recorded: ${settlement.fromUserId} paid ${settlement.toUserId} $${settlement.amount}`);
    
    // Broadcast settlement
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('settlement:created', settlementRecord);
    }
    
    return settlementRecord;
  }

  /**
   * Settle debt in graph
   * @param {string} fromUserId - Person who paid
   * @param {string} toUserId - Person who received
   * @param {number} amount - Amount paid
   */
  settleDebt(fromUserId, toUserId, amount) {
    if (!this.debtGraph.has(fromUserId)) return;
    
    const userDebts = this.debtGraph.get(fromUserId);
    const currentDebt = userDebts.get(toUserId) || 0;
    const newDebt = Math.max(0, currentDebt - amount);
    
    if (newDebt < 0.01) {
      userDebts.delete(toUserId);
    } else {
      userDebts.set(toUserId, newDebt);
    }
  }

  /**
   * Record partial payment
   * @param {string} settlementId - Settlement ID
   * @param {number} partialAmount - Amount paid
   * @returns {Object} Updated settlement
   */
  recordPartialPayment(settlementId, partialAmount) {
    const settlement = this.settlements.get(settlementId);
    if (!settlement) {
      throw new Error('Settlement not found');
    }
    
    if (!settlement.partialPayments) {
      settlement.partialPayments = [];
    }
    
    settlement.partialPayments.push({
      amount: partialAmount,
      paidAt: new Date().toISOString()
    });
    
    const totalPaid = settlement.partialPayments.reduce((sum, p) => sum + p.amount, 0);
    settlement.amountRemaining = settlement.amount - totalPaid;
    
    if (settlement.amountRemaining < 0.01) {
      settlement.status = 'completed';
    } else {
      settlement.status = 'partial';
    }
    
    // Update debt graph
    this.settleDebt(settlement.fromUserId, settlement.toUserId, partialAmount);
    this.calculateBalances();
    
    return settlement;
  }

  /**
   * Verify settlement (by recipient)
   * @param {string} settlementId - Settlement ID
   * @param {string} userId - User verifying (must be recipient)
   * @returns {Object} Updated settlement
   */
  verifySettlement(settlementId, userId) {
    const settlement = this.settlements.get(settlementId);
    if (!settlement) {
      throw new Error('Settlement not found');
    }
    
    if (settlement.toUserId !== userId) {
      throw new Error('Only recipient can verify settlement');
    }
    
    settlement.verified = true;
    settlement.verifiedAt = new Date().toISOString();
    settlement.verifiedBy = userId;
    
    console.log(`Settlement ${settlementId} verified`);
    
    return settlement;
  }

  /**
   * Get settlement history
   * @param {Object} filters - Filter options
   * @returns {Array} Array of settlements
   */
  getSettlementHistory(filters = {}) {
    let settlements = Array.from(this.settlements.values());
    
    if (filters.userId) {
      settlements = settlements.filter(s => 
        s.fromUserId === filters.userId || s.toUserId === filters.userId
      );
    }
    
    if (filters.status) {
      settlements = settlements.filter(s => s.status === filters.status);
    }
    
    if (filters.startDate) {
      settlements = settlements.filter(s => new Date(s.createdAt) >= new Date(filters.startDate));
    }
    
    if (filters.endDate) {
      settlements = settlements.filter(s => new Date(s.createdAt) <= new Date(filters.endDate));
    }
    
    // Sort by date (newest first)
    settlements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    return settlements;
  }

  /**
   * Get debt summary
   * @returns {Object} Summary object
   */
  getDebtSummary() {
    const balances = this.getAllBalances();
    
    const totalCreditors = balances.filter(b => b.status === 'creditor').length;
    const totalDebtors = balances.filter(b => b.status === 'debtor').length;
    const totalSettled = balances.filter(b => b.status === 'settled').length;
    
    const totalOwed = balances.reduce((sum, b) => sum + b.totalOwed, 0);
    const totalOwes = balances.reduce((sum, b) => sum + b.totalOwes, 0);
    
    const optimizedTransactions = this.optimizeSettlements();
    
    return {
      totalUsers: balances.length,
      creditors: totalCreditors,
      debtors: totalDebtors,
      settled: totalSettled,
      totalInCirculation: this.roundAmount(totalOwed),
      optimizedTransactionCount: optimizedTransactions.length,
      settlementsSuggested: optimizedTransactions
    };
  }

  /**
   * Get net debt between two users
   * @param {string} userId1 - First user ID
   * @param {string} userId2 - Second user ID
   * @returns {Object} Net debt info
   */
  getNetDebtBetween(userId1, userId2) {
    let user1OwesUser2 = 0;
    let user2OwesUser1 = 0;
    
    if (this.debtGraph.has(userId1)) {
      user1OwesUser2 = this.debtGraph.get(userId1).get(userId2) || 0;
    }
    
    if (this.debtGraph.has(userId2)) {
      user2OwesUser1 = this.debtGraph.get(userId2).get(userId1) || 0;
    }
    
    const netAmount = user2OwesUser1 - user1OwesUser2;
    
    return {
      netAmount: this.roundAmount(Math.abs(netAmount)),
      direction: netAmount > 0 ? userId1 : netAmount < 0 ? userId2 : 'settled',
      details: {
        [`${userId1}_owes_${userId2}`]: this.roundAmount(user1OwesUser2),
        [`${userId2}_owes_${userId1}`]: this.roundAmount(user2OwesUser1)
      }
    };
  }

  /**
   * Check if all debts are settled
   * @returns {boolean} All settled status
   */
  areAllDebtsSettled() {
    const balances = this.getAllBalances();
    return balances.every(b => Math.abs(b.netBalance) < 0.01);
  }

  /**
   * Generate settlement reminder
   * @param {string} userId - User to remind
   * @returns {Object} Reminder object
   */
  generateReminder(userId) {
    const breakdown = this.getDetailedBreakdown(userId);
    const balance = this.getUserBalance(userId);
    
    if (Math.abs(balance.netBalance) < 0.01) {
      return {
        userId,
        message: 'All debts are settled!',
        reminder: false
      };
    }
    
    let message = '';
    
    if (balance.netBalance < 0) {
      message = `You owe $${Math.abs(balance.netBalance).toFixed(2)} in total. `;
      message += `${breakdown.owes.length} payment(s) pending.`;
    } else {
      message = `You are owed $${balance.netBalance.toFixed(2)} in total. `;
      message += `${breakdown.owed.length} payment(s) incoming.`;
    }
    
    return {
      userId,
      message,
      reminder: true,
      netBalance: balance.netBalance,
      debts: breakdown.owes.length,
      credits: breakdown.owed.length
    };
  }

  /**
   * Round amount to 2 decimal places
   * @param {number} amount - Amount to round
   * @returns {number} Rounded amount
   */
  roundAmount(amount) {
    return Math.round(amount * 100) / 100;
  }

  /**
   * Generate unique ID
   * @param {string} prefix - ID prefix
   * @returns {string} Unique ID
   */
  generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Export debt data for backup
   * @returns {Object} Exportable data
   */
  exportData() {
    return {
      debts: Array.from(this.debts.values()),
      settlements: Array.from(this.settlements.values()),
      balances: Array.from(this.balances.values()),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import debt data from backup
   * @param {Object} data - Imported data
   */
  importData(data) {
    if (data.debts) {
      data.debts.forEach(debt => this.debts.set(debt.id, debt));
    }
    
    if (data.settlements) {
      data.settlements.forEach(settlement => this.settlements.set(settlement.id, settlement));
    }
    
    if (data.balances) {
      data.balances.forEach(balance => this.balances.set(balance.userId, balance));
    }
    
    console.log('Debt data imported successfully');
  }
}

// Global instance
const debtSettlementTracker = new DebtSettlementTracker();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DebtSettlementTracker;
}
