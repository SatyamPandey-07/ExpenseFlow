/**
 * Approval Workflow Engine - Multi-Level Authorization
 * 
 * Manages expense approval workflows with configurable rules, multi-level authorization,
 * and automatic routing based on amount thresholds and categories.
 * 
 * @class ApprovalWorkflowEngine
 * @version 1.0.0
 */

class ApprovalWorkflowEngine {
  constructor() {
    this.workflows = new Map();
    this.approvals = new Map();
    this.rules = new Map();
    
    // Default rules
    this.addRule({
      name: 'High Value Approval',
      condition: (expense) => expense.amount > 500,
      approvers: ['admin'],
      requiredApprovals: 1
    });
    
    this.addRule({
      name: 'Very High Value Approval',
      condition: (expense) => expense.amount > 2000,
      approvers: ['admin', 'moderator'],
      requiredApprovals: 2
    });
  }

  /**
   * Initialize approval engine
   */
  async init(workspaceId, userId) {
    this.workspaceId = workspaceId;
    this.userId = userId;
    await this.loadApprovals();
    console.log('Approval workflow engine initialized');
  }

  /**
   * Add approval rule
   */
  addRule(rule) {
    const ruleObject = {
      id: this.generateId('rule'),
      name: rule.name,
      condition: rule.condition,
      approvers: rule.approvers || [],
      requiredApprovals: rule.requiredApprovals || 1,
      notifyApprovers: rule.notifyApprovers !== false,
      active: true,
      createdAt: new Date().toISOString()
    };

    this.rules.set(ruleObject.id, ruleObject);
    return ruleObject;
  }

  /**
   * Check if expense requires approval
   */
  requiresApproval(expense) {
    for (const rule of this.rules.values()) {
      if (rule.active && rule.condition(expense)) {
        return {
          required: true,
          rule: rule.id,
          ruleName: rule.name,
          approvers: rule.approvers,
          requiredApprovals: rule.requiredApprovals
        };
      }
    }

    return { required: false };
  }

  /**
   * Create approval request
   */
  createApprovalRequest(expense) {
    const approvalCheck = this.requiresApproval(expense);
    
    if (!approvalCheck.required) {
      return null;
    }

    const approval = {
      id: this.generateId('approval'),
      expenseId: expense.id,
      workspaceId: this.workspaceId,
      ruleId: approvalCheck.rule,
      ruleName: approvalCheck.ruleName,
      requester: expense.createdBy || this.userId,
      approvers: approvalCheck.approvers,
      requiredApprovals: approvalCheck.requiredApprovals,
      responses: [],
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };

    this.approvals.set(approval.id, approval);

    // Notify approvers
    if (typeof notificationSystem !== 'undefined') {
      approvalCheck.approvers.forEach(approverId => {
        notificationSystem.notifyApprovalRequired(expense);
      });
    }

    // Broadcast approval request
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('approval:request', approval);
    }

    return approval;
  }

  /**
   * Submit approval response
   */
  submitResponse(approvalId, userId, decision, comment = '') {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'pending') {
      throw new Error('Approval already processed');
    }

    // Check if user is authorized approver
    if (!approval.approvers.includes(userId)) {
      throw new Error('User not authorized to approve');
    }

    // Check if user already responded
    if (approval.responses.some(r => r.userId === userId)) {
      throw new Error('User already submitted response');
    }

    const response = {
      userId,
      decision, // 'approved' or 'rejected'
      comment,
      timestamp: new Date().toISOString()
    };

    approval.responses.push(response);

    // Update approval status
    this.updateApprovalStatus(approval);

    // Broadcast response
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('approval:response', { approvalId, response });
    }

    return approval;
  }

  /**
   * Update approval status based on responses
   */
  updateApprovalStatus(approval) {
    const approvedCount = approval.responses.filter(r => r.decision === 'approved').length;
    const rejectedCount = approval.responses.filter(r => r.decision === 'rejected').length;

    if (rejectedCount > 0) {
      approval.status = 'rejected';
      approval.completedAt = new Date().toISOString();
    } else if (approvedCount >= approval.requiredApprovals) {
      approval.status = 'approved';
      approval.completedAt = new Date().toISOString();
    }

    // Check expiration
    if (new Date(approval.expiresAt) < new Date()) {
      approval.status = 'expired';
      approval.completedAt = new Date().toISOString();
    }
  }

  /**
   * Get pending approvals for user
   */
  getPendingApprovals(userId) {
    return Array.from(this.approvals.values())
      .filter(a => 
        a.status === 'pending' &&
        a.approvers.includes(userId) &&
        !a.responses.some(r => r.userId === userId)
      )
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Get approval status
   */
  getApprovalStatus(approvalId) {
    const approval = this.approvals.get(approvalId);
    if (!approval) return null;

    const approvedCount = approval.responses.filter(r => r.decision === 'approved').length;
    const rejectedCount = approval.responses.filter(r => r.decision === 'rejected').length;

    return {
      id: approval.id,
      status: approval.status,
      approvedCount,
      rejectedCount,
      requiredApprovals: approval.requiredApprovals,
      responses: approval.responses,
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt
    };
  }

  /**
   * Get approval history for expense
   */
  getExpenseApprovalHistory(expenseId) {
    return Array.from(this.approvals.values())
      .filter(a => a.expenseId === expenseId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Cancel approval request
   */
  cancelApproval(approvalId, userId) {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }

    // Only requester can cancel
    if (approval.requester !== userId) {
      throw new Error('Only requester can cancel approval');
    }

    if (approval.status !== 'pending') {
      throw new Error('Can only cancel pending approvals');
    }

    approval.status = 'cancelled';
    approval.cancelledAt = new Date().toISOString();
    approval.cancelledBy = userId;

    return approval;
  }

  /**
   * Get all rules
   */
  getRules() {
    return Array.from(this.rules.values());
  }

  /**
   * Toggle rule active status
   */
  toggleRule(ruleId) {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.active = !rule.active;
    }
    return rule;
  }

  /**
   * Delete rule
   */
  deleteRule(ruleId) {
    return this.rules.delete(ruleId);
  }

  /**
   * Get approval statistics
   */
  getStats() {
    const approvals = Array.from(this.approvals.values());
    
    return {
      total: approvals.length,
      pending: approvals.filter(a => a.status === 'pending').length,
      approved: approvals.filter(a => a.status === 'approved').length,
      rejected: approvals.filter(a => a.status === 'rejected').length,
      expired: approvals.filter(a => a.status === 'expired').length,
      cancelled: approvals.filter(a => a.status === 'cancelled').length
    };
  }

  /**
   * Load approvals from storage
   */
  async loadApprovals() {
    try {
      const stored = localStorage.getItem(`approvals_${this.workspaceId}`);
      if (stored) {
        const approvals = JSON.parse(stored);
        approvals.forEach(a => {
          // Reconstruct condition functions for rules
          this.approvals.set(a.id, a);
        });
      }
    } catch (error) {
      console.error('Error loading approvals:', error);
    }
  }

  /**
   * Save approvals to storage
   */
  async saveApprovals() {
    try {
      const approvals = Array.from(this.approvals.values());
      localStorage.setItem(`approvals_${this.workspaceId}`, JSON.stringify(approvals));
    } catch (error) {
      console.error('Error saving approvals:', error);
    }
  }

  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

const approvalWorkflowEngine = new ApprovalWorkflowEngine();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApprovalWorkflowEngine;
}
