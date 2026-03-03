/**
 * Cost Splitting Engine - Smart Expense Distribution Calculator
 * 
 * Advanced cost-splitting algorithms for team expenses with multiple split methods,
 * percentage-based distribution, item-level splitting, and custom allocation rules.
 * 
 * Features:
 * - Multiple split methods (equal, proportional, percentage, item-level, custom)
 * - Per-item expense splitting for detailed bills
 * - Tax and tip allocation options
 * - Custom shares and ratios
 * - Rounding strategies to handle pennies
 * - Split history and templates
 * - Exclusion rules for specific members
 * 
 * @class CostSplittingEngine
 * @version 1.0.0
 * @author ExpenseFlow Team
 */

class CostSplittingEngine {
  constructor() {
    this.splitTemplates = new Map(); // templateId -> template
    this.splitHistory = new Map(); // expenseId -> split details
    
    // Rounding strategies
    this.roundingStrategies = {
      'nearest': (amount) => Math.round(amount * 100) / 100,
      'up': (amount) => Math.ceil(amount * 100) / 100,
      'down': (amount) => Math.floor(amount * 100) / 100,
      'random': (amount) => this.roundingStrategies.nearest(amount) // Default to nearest for random
    };
    
    // Split methods
    this.splitMethods = ['equal', 'proportional', 'percentage', 'shares', 'item_level', 'custom'];
  }

  /**
   * Calculate equal split among members
   * @param {number} amount - Total amount to split
   * @param {Array} members - Array of member IDs
   * @param {Object} options - Split options
   * @returns {Object} Split result
   */
  splitEqual(amount, members, options = {}) {
    if (members.length === 0) {
      throw new Error('No members provided for split');
    }
    
    const baseAmount = amount / members.length;
    const roundingStrategy = this.roundingStrategies[options.rounding || 'nearest'];
    
    const splits = members.map(memberId => ({
      userId: memberId,
      amount: roundingStrategy(baseAmount),
      percentage: (100 / members.length)
    }));
    
    // Handle rounding remainder
    const total = splits.reduce((sum, s) => sum + s.amount, 0);
    const remainder = amount - total;
    
    if (Math.abs(remainder) > 0.01) {
      // Distribute remainder to first member
      splits[0].amount += remainder;
      splits[0].amount = roundingStrategy(splits[0].amount);
    }
    
    return {
      method: 'equal',
      totalAmount: amount,
      splits,
      timestamp: Date.now()
    };
  }

  /**
   * Calculate proportional split based on custom ratios
   * @param {number} amount - Total amount to split
   * @param {Object} proportions - Object mapping userId to proportion/weight
   * @param {Object} options - Split options
   * @returns {Object} Split result
   */
  splitProportional(amount, proportions, options = {}) {
    const members = Object.keys(proportions);
    if (members.length === 0) {
      throw new Error('No proportions provided');
    }
    
    const totalWeight = Object.values(proportions).reduce((sum, weight) => sum + weight, 0);
    const roundingStrategy = this.roundingStrategies[options.rounding || 'nearest'];
    
    const splits = members.map(memberId => {
      const weight = proportions[memberId];
      const memberAmount = (weight / totalWeight) * amount;
      const percentage = (weight / totalWeight) * 100;
      
      return {
        userId: memberId,
        amount: roundingStrategy(memberAmount),
        percentage: roundingStrategy(percentage),
        weight
      };
    });
    
    // Handle rounding remainder
    const total = splits.reduce((sum, s) => sum + s.amount, 0);
    const remainder = amount - total;
    
    if (Math.abs(remainder) > 0.01) {
      // Distribute to member with highest weight
      const maxWeightSplit = splits.reduce((max, s) => s.weight > max.weight ? s : max, splits[0]);
      maxWeightSplit.amount += remainder;
      maxWeightSplit.amount = roundingStrategy(maxWeightSplit.amount);
    }
    
    return {
      method: 'proportional',
      totalAmount: amount,
      splits,
      timestamp: Date.now()
    };
  }

  /**
   * Calculate percentage-based split
   * @param {number} amount - Total amount to split
   * @param {Object} percentages - Object mapping userId to percentage (must sum to 100)
   * @param {Object} options - Split options
   * @returns {Object} Split result
   */
  splitByPercentage(amount, percentages, options = {}) {
    const members = Object.keys(percentages);
    if (members.length === 0) {
      throw new Error('No percentages provided');
    }
    
    const totalPercentage = Object.values(percentages).reduce((sum, pct) => sum + pct, 0);
    
    // Validate percentages sum to 100 (allow small tolerance)
    if (Math.abs(totalPercentage - 100) > 0.1) {
      throw new Error(`Percentages must sum to 100 (got ${totalPercentage})`);
    }
    
    const roundingStrategy = this.roundingStrategies[options.rounding || 'nearest'];
    
    const splits = members.map(memberId => {
      const percentage = percentages[memberId];
      const memberAmount = (percentage / 100) * amount;
      
      return {
        userId: memberId,
        amount: roundingStrategy(memberAmount),
        percentage
      };
    });
    
    // Handle rounding remainder
    const total = splits.reduce((sum, s) => sum + s.amount, 0);
    const remainder = amount - total;
    
    if (Math.abs(remainder) > 0.01) {
      // Distribute to member with highest percentage
      const maxPercentSplit = splits.reduce((max, s) => s.percentage > max.percentage ? s : max, splits[0]);
      maxPercentSplit.amount += remainder;
      maxPercentSplit.amount = roundingStrategy(maxPercentSplit.amount);
    }
    
    return {
      method: 'percentage',
      totalAmount: amount,
      splits,
      timestamp: Date.now()
    };
  }

  /**
   * Calculate shares-based split (e.g., 2:1:1 ratio)
   * @param {number} amount - Total amount to split
   * @param {Object} shares - Object mapping userId to share count
   * @param {Object} options - Split options
   * @returns {Object} Split result
   */
  splitByShares(amount, shares, options = {}) {
    // Shares is just proportional with integer weights
    return this.splitProportional(amount, shares, { ...options, method: 'shares' });
  }

  /**
   * Calculate item-level split for detailed bills
   * @param {Array} items - Array of item objects with {name, amount, members}
   * @param {Object} options - Split options
   * @returns {Object} Split result
   */
  splitByItems(items, options = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Items array is required');
    }
    
    const roundingStrategy = this.roundingStrategies[options.rounding || 'nearest'];
    const memberTotals = new Map();
    const itemSplits = [];
    
    // Calculate per-item splits
    items.forEach(item => {
      const itemMembers = item.members || [];
      if (itemMembers.length === 0) return;
      
      const perPersonAmount = item.amount / itemMembers.length;
      
      itemMembers.forEach(memberId => {
        const current = memberTotals.get(memberId) || 0;
        memberTotals cost(memberId, current + perPersonAmount);
      });
      
      itemSplits.push({
        itemName: item.name,
        itemAmount: item.amount,
        members: itemMembers,
        perPerson: roundingStrategy(perPersonAmount)
      });
    });
    
    // Calculate tax and tip if provided
    const totalItemAmount = items.reduce((sum, item) => sum + item.amount, 0);
    let taxAmount = 0;
    let tipAmount = 0;
    
    if (options.tax) {
      taxAmount = typeof options.tax === 'number' ? options.tax : (totalItemAmount * options.tax / 100);
    }
    
    if (options.tip) {
      tipAmount = typeof options.tip === 'number' ? options.tip : (totalItemAmount * options.tip / 100);
    }
    
    // Distribute tax and tip proportionally
    const additionalAmount = taxAmount + tipAmount;
    if (additionalAmount > 0) {
      memberTotals.forEach((amount, memberId) => {
        const proportion = amount / totalItemAmount;
        const additionalShare = roundingStrategy(proportion * additionalAmount);
        memberTotals.set(memberId, amount + additionalShare);
      });
    }
    
    // Create splits array
    const splits = Array.from(memberTotals.entries()).map(([userId, amount]) => ({
      userId,
      amount: roundingStrategy(amount),
      percentage: roundingStrategy((amount / (totalItemAmount + additionalAmount)) * 100)
    }));
    
    // Handle rounding remainder
    const totalSplitAmount = totalItemAmount + additionalAmount;
    const currentTotal = splits.reduce((sum, s) => sum + s.amount, 0);
    const remainder = totalSplitAmount - currentTotal;
    
    if (Math.abs(remainder) > 0.01 && splits.length > 0) {
      splits[0].amount += remainder;
      splits[0].amount = roundingStrategy(splits[0].amount);
    }
    
    return {
      method: 'item_level',
      totalAmount: totalSplitAmount,
      itemsTotal: totalItemAmount,
      tax: taxAmount,
      tip: tipAmount,
      items: itemSplits,
      splits,
      timestamp: Date.now()
    };
  }

  /**
   * Calculate custom split with exclude rules
   * @param {number} amount - Total amount
   * @param {Array} allMembers - All workspace members
   * @param {Object} config - Custom configuration
   * @returns {Object} Split result
   */
  splitCustom(amount, allMembers, config = {}) {
    const excludedMembers = new Set(config.exclude || []);
    const customAmounts = config.customAmounts || {};
    
    // Filter out excluded members
    const activeMembers = allMembers.filter(m => !excludedMembers.has(m));
    
    if (activeMembers.length === 0) {
      throw new Error('No active members after exclusions');
    }
    
    // Members with custom amounts
    const customMembers = Object.keys(customAmounts);
    const customTotal = Object.values(customAmounts).reduce((sum, amt) => sum + amt, 0);
    
    if (customTotal > amount) {
      throw new Error('Custom amounts exceed total amount');
    }
    
    // Remaining amount and members
    const remainingAmount = amount - customTotal;
    const remainingMembers = activeMembers.filter(m => !customMembers.includes(m));
    
    const splits = [];
    
    // Add custom amounts
    customMembers.forEach(memberId => {
      if (activeMembers.includes(memberId)) {
        splits.push({
          userId: memberId,
          amount: customAmounts[memberId],
          percentage: (customAmounts[memberId] / amount) * 100,
          custom: true
        });
      }
    });
    
    // Split remaining equally among remaining members
    if (remainingMembers.length > 0 && remainingAmount > 0) {
      const equalSplit = this.splitEqual(remainingAmount, remainingMembers, config);
      equalSplit.splits.forEach(split => {
        split.percentage = (split.amount / amount) * 100;
        splits.push(split);
      });
    }
    
    return {
      method: 'custom',
      totalAmount: amount,
      excluded: Array.from(excludedMembers),
      splits,
      timestamp: Date.now()
    };
  }

  /**
   * Auto-select split method based on context
   * @param {Object} expense - Expense object
   * @param {Object} context - Context information
   * @returns {Object} Split result
   */
  autoSplit(expense, context = {}) {
    const { amount, members, items, workspace } = expense;
    
    // If items provided, use item-level split
    if (items && items.length > 0) {
      return this.splitByItems(items, { tax: expense.tax, tip: expense.tip });
    }
    
    // If workspace has default method, use that
    if (workspace && workspace.settings && workspace.settings.defaultSplitMethod) {
      const method = workspace.settings.defaultSplitMethod;
      
      switch (method) {
        case 'equal':
          return this.splitEqual(amount, members);
        case 'proportional':
          // Would need proportions from context
          return this.splitEqual(amount, members);
        default:
          return this.splitEqual(amount, members);
      }
    }
    
    // Default to equal split
    return this.splitEqual(amount, members);
  }

  /**
   * Save split as template for reuse
   * @param {string} name - Template name
   * @param {Object} splitConfig - Split configuration
   * @returns {Object} Template object
   */
  saveTemplate(name, splitConfig) {
    const template = {
      id: this.generateId('tpl'),
      name,
      method: splitConfig.method,
      config: splitConfig,
      createdAt: new Date().toISOString(),
      usageCount: 0
    };
    
    this.splitTemplates.set(template.id, template);
    console.log('Split template saved:', name);
    
    return template;
  }

  /**
   * Apply saved template
   * @param {string} templateId - Template ID
   * @param {number} amount - Amount to split
   * @returns {Object} Split result
   */
  applyTemplate(templateId, amount) {
    const template = this.splitTemplates.get(templateId);
    if (!template) {
      throw new Error('Template not found');
    }
    
    template.usageCount++;
    
    const config = template.config;
    
    switch (config.method) {
      case 'equal':
        return this.splitEqual(amount, config.members, config.options);
      case 'proportional':
        return this.splitProportional(amount, config.proportions, config.options);
      case 'percentage':
        return this.splitByPercentage(amount, config.percentages, config.options);
      case 'shares':
        return this.splitByShares(amount, config.shares, config.options);
      default:
        throw new Error('Invalid template method');
    }
  }

  /**
   * Get all saved templates
   * @returns {Array} Array of templates
   */
  getTemplates() {
    return Array.from(this.splitTemplates.values());
  }

  /**
   * Delete template
   * @param {string} templateId - Template ID
   * @returns {boolean} Success status
   */
  deleteTemplate(templateId) {
    return this.splitTemplates.delete(templateId);
  }

  /**
   * Record split in history
   * @param {string} expenseId - Expense ID
   * @param {Object} splitResult - Split result object
   */
  recordSplit(expenseId, splitResult) {
    this.splitHistory.set(expenseId, {
      ...splitResult,
      expenseId,
      recordedAt: new Date().toISOString()
    });
  }

  /**
   * Get split history for expense
   * @param {string} expenseId - Expense ID
   * @returns {Object|null} Split history
   */
  getSplitHistory(expenseId) {
    return this.splitHistory.get(expenseId) || null;
  }

  /**
   * Validate split result matches total
   * @param {Object} splitResult - Split result
   * @returns {Object} Validation result
   */
  validateSplit(splitResult) {
    const calculatedTotal = splitResult.splits.reduce((sum, s) => sum + s.amount, 0);
    const difference = Math.abs(calculatedTotal - splitResult.totalAmount);
    
    return {
      valid: difference < 0.01,
      calculatedTotal,
      expectedTotal: splitResult.totalAmount,
      difference
    };
  }

  /**
   * Generate split summary for display
   * @param {Object} splitResult - Split result
   * @param {Object} memberNames - Map of userId to name
   * @returns {string} Formatted summary
   */
  generateSummary(splitResult, memberNames = {}) {
    let summary = `Split Method: ${splitResult.method.toUpperCase()}\n`;
    summary += `Total Amount: $${splitResult.totalAmount.toFixed(2)}\n\n`;
    
    splitResult.splits.forEach(split => {
      const name = memberNames[split.userId] || split.userId;
      summary += `${name}: $${split.amount.toFixed(2)}`;
      if (split.percentage) {
        summary += ` (${split.percentage.toFixed(1)}%)`;
      }
      summary += '\n';
    });
    
    return summary;
  }

  /**
   * Calculate split adjustments if member opts out
   * @param {Object} splitResult - Original split result
   * @param {string} userId - User opting out
   * @returns {Object} Adjusted split result
   */
  recalculateWithoutMember(splitResult, userId) {
    const remainingMembers = splitResult.splits
      .filter(s => s.userId !== userId)
      .map(s => s.userId);
    
    if (remainingMembers.length === 0) {
      throw new Error('Cannot remove all members from split');
    }
    
    // Recalculate based on original method
    switch (splitResult.method) {
      case 'equal':
        return this.splitEqual(splitResult.totalAmount, remainingMembers);
      case 'proportional':
      case 'shares':
        // Maintain relative proportions among remaining members
        const proportions = {};
        splitResult.splits
          .filter(s => s.userId !== userId)
          .forEach(s => {
            proportions[s.userId] = s.weight || s.percentage;
          });
        return this.splitProportional(splitResult.totalAmount, proportions);
      default:
        // Default to equal split
        return this.splitEqual(splitResult.totalAmount, remainingMembers);
    }
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
   * Get available split methods
   * @returns {Array} Array of method names
   */
  getSplitMethods() {
    return [...this.splitMethods];
  }
}

// Global instance
const costSplittingEngine = new CostSplittingEngine();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CostSplittingEngine;
}
