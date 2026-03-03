/**
 * Category Rules Engine - Custom Categorization Rules
 * User-defined rules for complex expenses with ML feedback training
 * Handles rule precedence, conditions, and pattern matching
 */

class CategoryRulesEngine {
  constructor() {
    this.rules = [];
    this.ruleHistory = [];
    this.ruleMatches = new Map(); // Track rule performance
    this.defaultRules = this.initializeDefaultRules();
  }

  /**
   * Initialize default categorization rules
   */
  initializeDefaultRules() {
    return [
      {
        id: 'rule-1',
        name: 'Subscription Services',
        priority: 1,
        conditions: [
          { field: 'description', operator: 'contains', value: 'subscription' },
          { field: 'description', operator: 'contains', value: 'monthly' }
        ],
        conditionType: 'any', // 'all' or 'any'
        category: 'Subscriptions',
        action: 'categorize',
        enabled: true,
        created: new Date()
      },
      {
        id: 'rule-2',
        name: 'Gas Station Fill-ups',
        priority: 2,
        conditions: [
          { field: 'merchant', operator: 'contains', value: 'gas' },
          { field: 'merchant', operator: 'contains', value: 'shell' }
        ],
        conditionType: 'any',
        category: 'Transportation',
        action: 'categorize',
        enabled: true,
        created: new Date()
      },
      {
        id: 'rule-3',
        name: 'Work Supplies',
        priority: 3,
        conditions: [
          { field: 'merchant', operator: 'contains', value: 'office' },
          { field: 'amount', operator: '>', value: 5 },
          { field: 'amount', operator: '<', value: 500 }
        ],
        conditionType: 'all',
        category: 'Business Services',
        action: 'categorize',
        enabled: true,
        created: new Date()
      }
    ];
  }

  /**
   * Add custom rule
   * @param {Object} rule - Rule definition with conditions
   */
  addRule(rule) {
    const ruleId = `custom-rule-${Date.now()}`;

    const newRule = {
      id: ruleId,
      name: rule.name,
      priority: rule.priority || this.rules.length + 100,
      conditions: rule.conditions || [],
      conditionType: rule.conditionType || 'all', // 'all' = AND, 'any' = OR
      category: rule.category,
      action: rule.action || 'categorize',
      enabled: true,
      created: new Date(),
      matchCount: 0,
      successRate: 0
    };

    this.rules.push(newRule);
    this.rules.sort((a, b) => a.priority - b.priority); // Sort by priority

    this.ruleHistory.push({
      type: 'RULE_CREATED',
      rule: newRule,
      timestamp: new Date()
    });

    return { success: true, ruleId, message: `Rule '${rule.name}' created successfully` };
  }

  /**
   * Apply rules to an expense
   * @param {Object} expense - Expense to categorize
   * @returns {Object} - Category result and applied rules
   */
  applyRules(expense) {
    const applicableRules = this.getApplicableRules(expense);

    if (applicableRules.length === 0) {
      return {
        category: 'Uncategorized',
        appliedRules: [],
        confidence: 0,
        suggestions: this.suggestRules(expense)
      };
    }

    // Get first matching rule (highest priority)
    const appliedRule = applicableRules[0];
    const confidence = applicableRules.length > 1 ? 0.95 : 0.85; // Higher confidence if multiple rules match

    // Track rule usage
    this.trackRuleMatch(appliedRule.id);

    return {
      category: appliedRule.category,
      appliedRules: applicableRules.map(r => ({
        id: r.id,
        name: r.name,
        priority: r.priority
      })),
      confidence,
      ruleId: appliedRule.id
    };
  }

  /**
   * Get applicable rules for an expense
   */
  getApplicableRules(expense) {
    return this.rules.filter(rule => {
      if (!rule.enabled) return false;
      return this.evaluateConditions(rule, expense);
    });
  }

  /**
   * Evaluate rule conditions
   */
  evaluateConditions(rule, expense) {
    const results = rule.conditions.map(condition => {
      return this.evaluateCondition(condition, expense);
    });

    if (rule.conditionType === 'all') {
      return results.every(r => r); // ALL conditions must be true
    } else {
      return results.some(r => r); // ANY condition must be true
    }
  }

  /**
   * Evaluate single condition
   */
  evaluateCondition(condition, expense) {
    const fieldValue = this.getExpenseFieldValue(expense, condition.field);
    const conditionValue = condition.value;

    switch (condition.operator) {
      case 'equals':
        return fieldValue === conditionValue;
      case 'contains':
        return fieldValue?.toString().toLowerCase().includes(conditionValue.toLowerCase());
      case 'regex':
        try {
          return new RegExp(conditionValue, 'i').test(fieldValue?.toString());
        } catch {
          return false;
        }
      case '>':
        return parseFloat(fieldValue) > parseFloat(conditionValue);
      case '<':
        return parseFloat(fieldValue) < parseFloat(conditionValue);
      case '>=':
        return parseFloat(fieldValue) >= parseFloat(conditionValue);
      case '<=':
        return parseFloat(fieldValue) <= parseFloat(conditionValue);
      case 'in':
        return conditionValue.includes(fieldValue);
      case 'not_contains':
        return !fieldValue?.toString().toLowerCase().includes(conditionValue.toLowerCase());
      default:
        return false;
    }
  }

  /**
   * Get field value from expense
   */
  getExpenseFieldValue(expense, field) {
    const parts = field.split('.');
    let value = expense;
    for (const part of parts) {
      value = value?.[part];
    }
    return value;
  }

  /**
   * Suggest new rules based on patterns
   */
  suggestRules(expense) {
    const suggestions = [];

    // Suggest merchant-based rule
    if (expense.merchant) {
      suggestions.push({
        type: 'merchant_rule',
        suggestion: `Create rule: Auto-categorize all transactions from ${expense.merchant}`,
        condition: {
          field: 'merchant',
          operator: 'contains',
          value: expense.merchant
        }
      });
    }

    // Suggest amount-based rule if applicable
    if (expense.amount > 100) {
      suggestions.push({
        type: 'amount_rule',
        suggestion: `Create rule for purchases over $${expense.amount}`,
        condition: {
          field: 'amount',
          operator: '>',
          value: 100
        }
      });
    }

    // Suggest description-based rule
    if (expense.description) {
      const keywords = expense.description.split(' ').filter(w => w.length > 4);
      if (keywords.length > 0) {
        suggestions.push({
          type: 'description_rule',
          suggestion: `Create rule for transactions containing "${keywords[0]}"`,
          condition: {
            field: 'description',
            operator: 'contains',
            value: keywords[0]
          }
        });
      }
    }

    return suggestions;
  }

  /**
   * Learn from user corrections with feedback
   */
  learnFromFeedback(expenseId, suggestedCategory, userCategory, expense) {
    if (suggestedCategory === userCategory) return; // Correct categorization

    // Create rule from user feedback
    const newRuleSuggestion = {
      name: `Auto-learned: Categorize ${expense.merchant || 'transactions'} as ${userCategory}`,
      conditions: [
        {
          field: 'merchant',
          operator: 'contains',
          value: expense.merchant
        }
      ],
      conditionType: 'all',
      category: userCategory,
      confidence: 0.7 // Lower confidence for auto-learned rules
    };

    // Check if similar rule exists
    const existingRule = this.rules.find(r =>
      r.conditions.some(c =>
        c.field === 'merchant' &&
        c.value === expense.merchant &&
        r.category === userCategory
      )
    );

    if (!existingRule) {
      this.addRule(newRuleSuggestion);

      return {
        success: true,
        message: `Learned: ${expense.merchant} → ${userCategory}`,
        ruleSuggested: newRuleSuggestion
      };
    }

    return { success: false, message: 'Rule already exists for this merchant' };
  }

  /**
   * Track rule performance
   */
  trackRuleMatch(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.matchCount = (rule.matchCount || 0) + 1;

      if (!this.ruleMatches.has(ruleId)) {
        this.ruleMatches.set(ruleId, { matches: 0, corrections: 0 });
      }

      const stats = this.ruleMatches.get(ruleId);
      stats.matches++;
      rule.successRate = ((stats.matches - stats.corrections) / stats.matches * 100).toFixed(0);
    }
  }

  /**
   * Update rule priority
   */
  updateRulePriority(ruleId, newPriority) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.priority = newPriority;
      this.rules.sort((a, b) => a.priority - b.priority);

      this.ruleHistory.push({
        type: 'RULE_PRIORITY_UPDATED',
        ruleId,
        oldPriority: rule.priority,
        newPriority,
        timestamp: new Date()
      });

      return { success: true };
    }

    return { success: false, message: 'Rule not found' };
  }

  /**
   * Enable/disable rule
   */
  toggleRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = !rule.enabled;

      this.ruleHistory.push({
        type: rule.enabled ? 'RULE_ENABLED' : 'RULE_DISABLED',
        ruleId,
        timestamp: new Date()
      });

      return { success: true, enabled: rule.enabled };
    }

    return { success: false, message: 'Rule not found' };
  }

  /**
   * Delete rule
   */
  deleteRule(ruleId) {
    const index = this.rules.findIndex(r => r.id === ruleId);
    if (index > -1) {
      const rule = this.rules[index];
      this.rules.splice(index, 1);

      this.ruleHistory.push({
        type: 'RULE_DELETED',
        rule,
        timestamp: new Date()
      });

      return { success: true, message: `Rule '${rule.name}' deleted` };
    }

    return { success: false, message: 'Rule not found' };
  }

  /**
   * Bulk apply rules to expenses
   */
  bulkApplyRules(expenses) {
    return expenses.map(expense => ({
      ...expense,
      ruleApplied: this.applyRules(expense)
    }));
  }

  /**
   * Get rule statistics
   */
  getRuleStatistics() {
    return this.rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      matchCount: rule.matchCount || 0,
      successRate: rule.successRate || 0,
      category: rule.category,
      priority: rule.priority
    }));
  }

  /**
   * Export rules for backup
   */
  exportRules() {
    return JSON.stringify(this.rules);
  }

  /**
   * Import rules
   */
  importRules(rulesJSON) {
    try {
      const rules = JSON.parse(rulesJSON);
      this.rules = rules;
      this.rules.sort((a, b) => a.priority - b.priority);

      return { success: true, message: `Imported ${rules.length} rules` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

// Global instance
const categoryRulesEngine = new CategoryRulesEngine();
