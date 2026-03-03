/**
 * Notification System - Real-Time Alerts
 * 
 * Manages real-time notifications for expenses, settlements, approvals, and team activities.
 * Supports browser notifications, in-app notifications, and notification preferences.
 * 
 * @class NotificationSystem
 * @version 1.0.0
 */

class NotificationSystem {
  constructor() {
    this.notifications = new Map();
    this.preferences = {
      expenseAdded: true,
      settlementReceived: true,
      approvalRequired: true,
      mentionedInComment: true,
      memberAdded: true,
      browserNotifications: false
    };
    this.unreadCount = 0;
  }

  /**
   * Initialize notification system
   */
  async init(userId) {
    this.userId = userId;
    await this.loadNotifications();
    await this.loadPreferences();
    
    if (this.preferences.browserNotifications) {
      await this.requestBrowserPermission();
    }
    
    console.log('Notification system initialized');
  }

  /**
   * Request browser notification permission
   */
  async requestBrowserPermission() {
    if (!'Notification' in window) {
      console.warn('Browser notifications not supported');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  }

  /**
   * Create notification
   * @param {Object} config - Notification configuration
   * @returns {Object} Created notification
   */
  createNotification(config) {
    const notification = {
      id: this.generateId('notif'),
      userId: this.userId,
      type: config.type,
      title: config.title,
      message: config.message,
      data: config.data || {},
      read: false,
      createdAt: new Date().toISOString(),
      actionUrl: config.actionUrl || null,
      priority: config.priority || 'normal'
    };

    this.notifications.set(notification.id, notification);
    this.unreadCount++;

    // Show browser notification if enabled
    if (this.preferences.browserNotifications && this.shouldShowNotification(config.type)) {
      this.showBrowserNotification(notification);
    }

    // Emit event
    this.emit('notification:created', notification);

    return notification;
  }

  /**
   * Show browser notification
   */
  showBrowserNotification(notification) {
    if (Notification.permission !== 'granted') return;

    const browserNotif = new Notification(notification.title, {
      body: notification.message,
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: notification.id,
      requireInteraction: notification.priority === 'high'
    });

    browserNotif.onclick = () => {
      window.focus();
      if (notification.actionUrl) {
        window.location.href = notification.actionUrl;
      }
      browserNotif.close();
    };
  }

  /**
   * Check if notification type should be shown
   */
  shouldShowNotification(type) {
    const typeMap = {
      'expense:created': 'expenseAdded',
      'settlement:received': 'settlementReceived',
      'approval:required': 'approvalRequired',
      'comment:mention': 'mentionedInComment',
      'member:added': 'memberAdded'
    };

    const prefKey = typeMap[type];
    return prefKey ? this.preferences[prefKey] : true;
  }

  /**
   * Notify expense added
   */
  notifyExpenseAdded(expense, addedBy) {
    if (addedBy === this.userId) return; // Don't notify self

    return this.createNotification({
      type: 'expense:created',
      title: 'New Expense Added',
      message: `${addedBy} added an expense: $${expense.amount}`,
      data: { expenseId: expense.id },
      actionUrl: `/expenses/${expense.id}`
    });
  }

  /**
   * Notify settlement received
   */
  notifySettlementReceived(settlement) {
    if (settlement.toUserId !== this.userId) return;

    return this.createNotification({
      type: 'settlement:received',
      title: 'Payment Received',
      message: `You received a payment of $${settlement.amount} from ${settlement.fromUserId}`,
      data: { settlementId: settlement.id },
      priority: 'high'
    });
  }

  /**
   * Notify approval required
   */
  notifyApprovalRequired(expense) {
    return this.createNotification({
      type: 'approval:required',
      title: 'Approval Required',
      message: `Expense of $${expense.amount} requires your approval`,
      data: { expenseId: expense.id },
      actionUrl: `/approvals/${expense.id}`,
      priority: 'high'
    });
  }

  /**
   * Notify mentioned in comment
   */
  notifyMentionedInComment(comment, mentionedBy) {
    return this.createNotification({
      type: 'comment:mention',
      title: 'You were mentioned',
      message: `${mentionedBy} mentioned you in a comment`,
      data: { commentId: comment.id },
      actionUrl: `/expenses/${comment.expenseId}`
    });
  }

  /**
   * Mark notification as read
   */
  markAsRead(notificationId) {
    const notification = this.notifications.get(notificationId);
    if (notification && !notification.read) {
      notification.read = true;
      notification.readAt = new Date().toISOString();
      this.unreadCount--;
    }
  }

  /**
   * Mark all as read
   */
  markAllAsRead() {
    this.notifications.forEach(notification => {
      if (!notification.read) {
        notification.read = true;
        notification.readAt = new Date().toISOString();
      }
    });
    this.unreadCount = 0;
  }

  /**
   * Get all notifications
   */
  getAllNotifications(options = {}) {
    let notifications = Array.from(this.notifications.values());

    if (options.unreadOnly) {
      notifications = notifications.filter(n => !n.read);
    }

    if (options.type) {
      notifications = notifications.filter(n => n.type === options.type);
    }

    if (options.limit) {
      notifications = notifications.slice(0, options.limit);
    }

    return notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Get unread count
   */
  getUnreadCount() {
    return this.unreadCount;
  }

  /**
   * Update preferences
   */
  updatePreferences(newPreferences) {
    this.preferences = { ...this.preferences, ...newPreferences };
    this.savePreferences();
  }

  /**
   * Delete notification
   */
  deleteNotification(notificationId) {
    const notification = this.notifications.get(notificationId);
    if (notification && !notification.read) {
      this.unreadCount--;
    }
    return this.notifications.delete(notificationId);
  }

  /**
   * Clear all notifications
   */
  clearAll() {
    this.notifications.clear();
    this.unreadCount = 0;
  }

  /**
   * Load notifications from storage
   */
  async loadNotifications() {
    try {
      const stored = localStorage.getItem(`notifications_${this.userId}`);
      if (stored) {
        const notifications = JSON.parse(stored);
        notifications.forEach(n => this.notifications.set(n.id, n));
        this.unreadCount = notifications.filter(n => !n.read).length;
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  }

  /**
   * Save notifications to storage
   */
  async saveNotifications() {
    try {
      const notifications = Array.from(this.notifications.values());
      localStorage.setItem(`notifications_${this.userId}`, JSON.stringify(notifications));
    } catch (error) {
      console.error('Error saving notifications:', error);
    }
  }

  /**
   * Load preferences from storage
   */
  async loadPreferences() {
    try {
      const stored = localStorage.getItem(`notification_prefs_${this.userId}`);
      if (stored) {
        this.preferences = { ...this.preferences, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
    }
  }

  /**
   * Save preferences to storage
   */
  async savePreferences() {
    try {
      localStorage.setItem(`notification_prefs_${this.userId}`, JSON.stringify(this.preferences));
    } catch (error) {
      console.error('Error saving preferences:', error);
    }
  }

  emit(event, data) {
    window.dispatchEvent(new CustomEvent(event, { detail: data }));
  }

  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

const notificationSystem = new NotificationSystem();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationSystem;
}
