/**
 * Activity Feed Manager - Real-Time Activity Tracking
 * 
 * Tracks all workspace activities and provides real-time activity feed with filtering,
 * search, and audit trail capabilities.
 * 
 * @class ActivityFeedManager
 * @version 1.0.0
 */

class ActivityFeedManager {
  constructor() {
    this.activities = new Map();
    this.filters = ['all', 'expenses', 'settlements', 'members', 'approvals'];
    this.maxActivities = 1000;
  }

  /**
   * Initialize activity feed
   */
  async init(workspaceId) {
    this.workspaceId = workspaceId;
    await this.loadActivities();
    console.log('Activity feed initialized');
  }

  /**
   * Record activity event
   * @param {Object} activity - Activity data
   * @returns {Object} Created activity
   */
  recordActivity(activity) {
    const record = {
      id: this.generateId('activity'),
      workspaceId: this.workspaceId,
      type: activity.type,
      actor: activity.actor,
      target: activity.target || null,
      action: activity.action,
      metadata: activity.metadata || {},
      timestamp: new Date().toISOString(),
      read: false
    };

    this.activities.set(record.id, record);

    // Trim old activities
    if (this.activities.size > this.maxActivities) {
      const oldest = Array.from(this.activities.keys())[0];
      this.activities.delete(oldest);
    }

    // Broadcast activity
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('activity:created', record);
    }

    return record;
  }

  /**
   * Get activities with filters
   * @param {Object} options - Filter options
   * @returns {Array} Filtered activities
   */
  getActivities(options = {}) {
    let activities = Array.from(this.activities.values());

    if (options.type) {
      activities = activities.filter(a => a.type === options.type);
    }

    if (options.actor) {
      activities = activities.filter(a => a.actor === options.actor);
    }

    if (options.startDate) {
      activities = activities.filter(a => new Date(a.timestamp) >= new Date(options.startDate));
    }

    if (options.limit) {
      activities = activities.slice(0, options.limit);
    }

    return activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Track expense creation
   */
  trackExpenseCreated(expenseId, userId, amount) {
    return this.recordActivity({
      type: 'expense',
      actor: userId,
      target: expenseId,
      action: 'created',
      metadata: { amount }
    });
  }

  /**
   * Track expense update
   */
  trackExpenseUpdated(expenseId, userId, changes) {
    return this.recordActivity({
      type: 'expense',
      actor: userId,
      target: expenseId,
      action: 'updated',
      metadata: { changes }
    });
  }

  /**
   * Track settlement
   */
  trackSettlement(settlementId, fromUserId, toUserId, amount) {
    return this.recordActivity({
      type: 'settlement',
      actor: fromUserId,
      target: settlementId,
      action: 'created',
      metadata: { toUserId, amount }
    });
  }

  /**
   * Track member addition
   */
  trackMemberAdded(userId, addedBy) {
    return this.recordActivity({
      type: 'member',
      actor: addedBy,
      target: userId,
      action: 'added',
      metadata: {}
    });
  }

  /**
   * Mark activity as read
   */
  markAsRead(activityId) {
    const activity = this.activities.get(activityId);
    if (activity) {
      activity.read = true;
    }
  }

  /**
   * Get unread count
   */
  getUnreadCount(userId) {
    return Array.from(this.activities.values())
      .filter(a => !a.read && a.actor !== userId).length;
  }

  /**
   * Search activities
   */
  searchActivities(query) {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.activities.values())
      .filter(a => 
        a.action.toLowerCase().includes(lowerQuery) ||
        a.type.toLowerCase().includes(lowerQuery)
      );
  }

  /**
   * Load activities from storage
   */
  async loadActivities() {
    try {
      const stored = localStorage.getItem(`activities_${this.workspaceId}`);
      if (stored) {
        const activities = JSON.parse(stored);
        activities.forEach(a => this.activities.set(a.id, a));
      }
    } catch (error) {
      console.error('Error loading activities:', error);
    }
  }

  /**
   * Save activities to storage
   */
  async saveActivities() {
    try {
      const activities = Array.from(this.activities.values());
      localStorage.setItem(`activities_${this.workspaceId}`, JSON.stringify(activities));
    } catch (error) {
      console.error('Error saving activities:', error);
    }
  }

  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

const activityFeedManager = new ActivityFeedManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActivityFeedManager;
}
