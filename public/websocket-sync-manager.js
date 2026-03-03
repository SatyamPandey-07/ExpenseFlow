/**
 * WebSocket Sync Manager - Real-Time Collaboration Engine
 * 
 * Manages WebSocket connections for real-time expense synchronization across team members.
 * Handles connection lifecycle, message routing, conflict resolution, and automatic reconnection.
 * 
 * Features:
 * - Real-time bidirectional synchronization
 * - Automatic reconnection with exponential backoff
 * - Message queuing during offline periods
 * - Conflict detection and resolution
 * - Presence tracking (online/offline status)
 * - Typing indicators and live cursors
 * - Bandwidth optimization with message batching
 * 
 * @class WebSocketSyncManager
 * @version 1.0.0
 * @author ExpenseFlow Team
 */

class WebSocketSyncManager {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.maxReconnectDelay = 30000; // Max 30 seconds
    this.messageQueue = [];
    this.eventHandlers = {};
    this.presenceMap = new Map(); // userId -> presence status
    this.typingUsers = new Set();
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
    this.userId = null;
    this.workspaceId = null;
    this.sessionId = this.generateSessionId();
    
    // Message batching for bandwidth optimization
    this.messageBatch = [];
    this.batchInterval = null;
    this.batchDelay = 100; // 100ms batching window
    
    // Statistics
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      reconnections: 0,
      conflicts: 0,
      bytesTransferred: 0,
      lastConnected: null,
      uptime: 0
    };
  }

  /**
   * Initialize WebSocket connection
   * @param {Object} config - Configuration object
   * @param {string} config.url - WebSocket server URL
   * @param {string} config.userId - Current user ID
   * @param {string} config.workspaceId - Workspace/team ID
   * @param {string} config.authToken - Authentication token
   * @returns {Promise<boolean>} Connection success
   */
  async init(config) {
    try {
      this.userId = config.userId;
      this.workspaceId = config.workspaceId;
      this.authToken = config.authToken;
      
      const wsUrl = `${config.url}?userId=${config.userId}&workspaceId=${config.workspaceId}&token=${config.authToken}&sessionId=${this.sessionId}`;
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onerror = (error) => this.handleError(error);
      this.ws.onclose = (event) => this.handleClose(event);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);
        
        this.once('connected', () => {
          clearTimeout(timeout);
          resolve(true);
        });
        
        this.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      console.error('WebSocket init error:', error);
      throw error;
    }
  }

  /**
   * Handle WebSocket open event
   */
  handleOpen() {
    console.log('WebSocket connected');
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.stats.lastConnected = new Date();
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Process queued messages
    this.processMessageQueue();
    
    // Start message batching
    this.startBatching();
    
    // Emit connected event
    this.emit('connected', { sessionId: this.sessionId, timestamp: Date.now() });
    
    // Send initial presence
    this.sendPresence('online');
  }

  /**
   * Handle incoming WebSocket messages
   * @param {MessageEvent} event - WebSocket message event
   */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      this.stats.messagesReceived++;
      this.stats.bytesTransferred += event.data.length;
      
      console.log('Received message:', message.type);
      
      switch (message.type) {
        case 'expense:created':
          this.handleExpenseCreated(message.data);
          break;
        case 'expense:updated':
          this.handleExpenseUpdated(message.data);
          break;
        case 'expense:deleted':
          this.handleExpenseDeleted(message.data);
          break;
        case 'settlement:created':
          this.handleSettlementCreated(message.data);
          break;
        case 'presence:update':
          this.handlePresenceUpdate(message.data);
          break;
        case 'typing:start':
          this.handleTypingStart(message.data);
          break;
        case 'typing:stop':
          this.handleTypingStop(message.data);
          break;
        case 'comment:added':
          this.handleCommentAdded(message.data);
          break;
        case 'approval:request':
          this.handleApprovalRequest(message.data);
          break;
        case 'approval:response':
          this.handleApprovalResponse(message.data);
          break;
        case 'conflict:detected':
          this.handleConflict(message.data);
          break;
        case 'heartbeat:pong':
          this.handleHeartbeatPong(message.data);
          break;
        case 'error':
          this.handleServerError(message.data);
          break;
        default:
          console.warn('Unknown message type:', message.type);
      }
      
      // Emit generic message event
      this.emit('message', message);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  /**
   * Handle WebSocket error
   * @param {Event} error - Error event
   */
  handleError(error) {
    console.error('WebSocket error:', error);
    this.emit('error', error);
  }

  /**
   * Handle WebSocket close
   * @param {CloseEvent} event - Close event
   */
  handleClose(event) {
    console.log('WebSocket closed:', event.code, event.reason);
    this.isConnected = false;
    
    // Stop heartbeat
    this.stopHeartbeat();
    
    // Stop batching
    this.stopBatching();
    
    // Clear presence
    this.presenceMap.clear();
    this.typingUsers.clear();
    
    // Emit disconnected event
    this.emit('disconnected', { code: event.code, reason: event.reason });
    
    // Attempt reconnection (unless clean close)
    if (event.code !== 1000) {
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      this.emit('reconnect:failed');
      return;
    }
    
    this.reconnectAttempts++;
    this.stats.reconnections++;
    
    console.log(`Reconnecting (attempt ${this.reconnectAttempts})...`);
    
    setTimeout(() => {
      this.init({
        url: this.ws.url.split('?')[0],
        userId: this.userId,
        workspaceId: this.workspaceId,
        authToken: this.authToken
      }).catch(error => {
        console.error('Reconnection failed:', error);
        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        this.attemptReconnect();
      });
    }, this.reconnectDelay);
    
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay: this.reconnectDelay });
  }

  /**
   * Send message to server
   * @param {string} type - Message type
   * @param {Object} data - Message data
   * @param {boolean} immediate - Skip batching (default: false)
   */
  send(type, data, immediate = false) {
    const message = {
      type,
      data,
      userId: this.userId,
      workspaceId: this.workspaceId,
      sessionId: this.sessionId,
      timestamp: Date.now()
    };
    
    if (immediate || !this.isConnected) {
      this.sendImmediate(message);
    } else {
      this.addToBatch(message);
    }
  }

  /**
   * Send message immediately (bypass batch)
   * @param {Object} message - Message object
   */
  sendImmediate(message) {
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      const msgString = JSON.stringify(message);
      this.ws.send(msgString);
      this.stats.messagesSent++;
      this.stats.bytesTransferred += msgString.length;
    } else {
      // Queue for later
      this.messageQueue.push(message);
      console.log('Message queued (offline)');
    }
  }

  /**
   * Add message to batch for optimized sending
   * @param {Object} message - Message object
   */
  addToBatch(message) {
    this.messageBatch.push(message);
  }

  /**
   * Start message batching timer
   */
  startBatching() {
    this.batchInterval = setInterval(() => {
      this.flushBatch();
    }, this.batchDelay);
  }

  /**
   * Stop message batching timer
   */
  stopBatching() {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
    // Flush remaining messages
    this.flushBatch();
  }

  /**
   * Flush batched messages to server
   */
  flushBatch() {
    if (this.messageBatch.length === 0) return;
    
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      const batchMessage = {
        type: 'batch',
        messages: this.messageBatch,
        userId: this.userId,
        workspaceId: this.workspaceId,
        timestamp: Date.now()
      };
      
      const msgString = JSON.stringify(batchMessage);
      this.ws.send(msgString);
      this.stats.messagesSent += this.messageBatch.length;
      this.stats.bytesTransferred += msgString.length;
      
      this.messageBatch = [];
    }
  }

  /**
   * Process queued messages after reconnection
   */
  processMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.sendImmediate(message);
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        this.send('heartbeat:ping', { timestamp: Date.now() }, true);
        
        // Set timeout to detect dead connection
        this.heartbeatTimeout = setTimeout(() => {
          console.warn('Heartbeat timeout - connection may be dead');
          this.ws.close();
        }, 5000);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * Handle heartbeat pong response
   * @param {Object} data - Pong data
   */
  handleHeartbeatPong(data) {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
    
    const latency = Date.now() - data.timestamp;
    this.emit('heartbeat', { latency });
  }

  /**
   * Send presence update
   * @param {string} status - online, away, offline
   * @param {Object} metadata - Additional metadata
   */
  sendPresence(status, metadata = {}) {
    this.send('presence:update', {
      status,
      metadata,
      timestamp: Date.now()
    });
  }

  /**
   * Handle presence update from other users
   * @param {Object} data - Presence data
   */
  handlePresenceUpdate(data) {
    this.presenceMap.set(data.userId, {
      status: data.status,
      metadata: data.metadata,
      timestamp: data.timestamp
    });
    
    this.emit('presence:changed', data);
  }

  /**
   * Send typing indicator
   * @param {string} expenseId - Expense being edited
   */
  sendTypingStart(expenseId) {
    this.send('typing:start', { expenseId });
  }

  /**
   * Send typing stop indicator
   * @param {string} expenseId - Expense being edited
   */
  sendTypingStop(expenseId) {
    this.send('typing:stop', { expenseId });
  }

  /**
   * Handle typing start from other users
   * @param {Object} data - Typing data
   */
  handleTypingStart(data) {
    this.typingUsers.add(data.userId);
    this.emit('typing:start', data);
  }

  /**
   * Handle typing stop from other users
   * @param {Object} data - Typing data
   */
  handleTypingStop(data) {
    this.typingUsers.delete(data.userId);
    this.emit('typing:stop', data);
  }

  /**
   * Broadcast expense creation
   * @param {Object} expense - Expense object
   */
  broadcastExpenseCreated(expense) {
    this.send('expense:created', expense);
  }

  /**
   * Broadcast expense update
   * @param {Object} expense - Expense object
   */
  broadcastExpenseUpdated(expense) {
    this.send('expense:updated', expense);
  }

  /**
   * Broadcast expense deletion
   * @param {string} expenseId - Expense ID
   */
  broadcastExpenseDeleted(expenseId) {
    this.send('expense:deleted', { expenseId });
  }

  /**
   * Handle expense created by other user
   * @param {Object} data - Expense data
   */
  handleExpenseCreated(data) {
    this.emit('expense:created', data);
  }

  /**
   * Handle expense updated by other user
   * @param {Object} data - Expense data
   */
  handleExpenseUpdated(data) {
    this.emit('expense:updated', data);
  }

  /**
   * Handle expense deleted by other user
   * @param {Object} data - Deletion data
   */
  handleExpenseDeleted(data) {
    this.emit('expense:deleted', data);
  }

  /**
   * Handle settlement created
   * @param {Object} data - Settlement data
   */
  handleSettlementCreated(data) {
    this.emit('settlement:created', data);
  }

  /**
   * Handle comment added
   * @param {Object} data - Comment data
   */
  handleCommentAdded(data) {
    this.emit('comment:added', data);
  }

  /**
   * Handle approval request
   * @param {Object} data - Approval request data
   */
  handleApprovalRequest(data) {
    this.emit('approval:request', data);
  }

  /**
   * Handle approval response
   * @param {Object} data - Approval response data
   */
  handleApprovalResponse(data) {
    this.emit('approval:response', data);
  }

  /**
   * Handle conflict detection
   * @param {Object} data - Conflict data
   */
  handleConflict(data) {
    this.stats.conflicts++;
    this.emit('conflict:detected', data);
  }

  /**
   * Handle server error
   * @param {Object} data - Error data
   */
  handleServerError(data) {
    console.error('Server error:', data);
    this.emit('server:error', data);
  }

  /**
   * Get online users in workspace
   * @returns {Array} Array of online user IDs
   */
  getOnlineUsers() {
    const online = [];
    for (const [userId, presence] of this.presenceMap.entries()) {
      if (presence.status === 'online') {
        online.push(userId);
      }
    }
    return online;
  }

  /**
   * Get typing users
   * @returns {Array} Array of typing user IDs
   */
  getTypingUsers() {
    return Array.from(this.typingUsers);
  }

  /**
   * Get connection statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    if (this.stats.lastConnected) {
      this.stats.uptime = Date.now() - this.stats.lastConnected.getTime();
    }
    return { ...this.stats };
  }

  /**
   * Register event handler
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  /**
   * Register one-time event handler
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  once(event, handler) {
    const wrappedHandler = (...args) => {
      handler(...args);
      this.off(event, wrappedHandler);
    };
    this.on(event, wrappedHandler);
  }

  /**
   * Unregister event handler
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  off(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
    }
  }

  /**
   * Emit event to all registered handlers
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Generate unique session ID
   * @returns {string} Session ID
   */
  generateSessionId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Close WebSocket connection
   * @param {number} code - Close code (default: 1000 = normal)
   * @param {string} reason - Close reason
   */
  close(code = 1000, reason = 'Client close') {
    if (this.ws) {
      this.ws.close(code, reason);
    }
  }

  /**
   * Check if currently connected
   * @returns {boolean} Connection status
   */
  isConnectedToServer() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Global instance
const webSocketSyncManager = new WebSocketSyncManager();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSocketSyncManager;
}
