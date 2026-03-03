/**
 * Background Sync Manager - Handles offline queue and sync operations
 * Manages pending expenses and ensures they sync when online
 */

class BackgroundSyncManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.syncInProgress = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 seconds
        this.syncInterval = 30000; // 30 seconds
        this.listeners = {
            syncStart: [],
            syncProgress: [],
            syncComplete: [],
            syncError: []
        };
        this.syncMetrics = {
            totalSynced: 0,
            totalFailed: 0,
            lastSyncTime: null,
            conflicts: []
        };
    }

    /**
     * Initialize background sync
     */
    async init() {
        // Set up network listeners
        window.addEventListener('online', () => this.onOnline());
        window.addEventListener('offline', () => this.onOffline());

        // Initialize IndexedDB
        await offlineDB.init();

        // Try to register for background sync API
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            try {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration) {
                    registration.sync.register('offline-sync');
                    console.log('Background sync registered');
                }
            } catch (error) {
                console.warn('Background sync registration failed:', error);
            }
        }

        // Start periodic sync if online
        if (this.isOnline) {
            this.startPeriodicSync();
        }

        console.log('Background sync manager initialized');
    }

    /**
     * Handle online event
     */
    onOnline() {
        console.log('Device is back online');
        this.isOnline = true;
        this.startPeriodicSync();
        this.syncPendingOperations();
    }

    /**
     * Handle offline event
     */
    onOffline() {
        console.log('Device is offline');
        this.isOnline = false;
        this.stopPeriodicSync();
    }

    /**
     * Start periodic sync
     */
    startPeriodicSync() {
        if (this.syncIntervalId) return;

        this.syncIntervalId = setInterval(async () => {
            await this.syncPendingOperations();
        }, this.syncInterval);
    }

    /**
     * Stop periodic sync
     */
    stopPeriodicSync() {
        if (this.syncIntervalId) {
            clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
        }
    }

    /**
     * Sync all pending operations
     */
    async syncPendingOperations() {
        if (this.syncInProgress || !this.isOnline) {
            return;
        }

        this.syncInProgress = true;
        this.emit('syncStart', { timestamp: new Date() });

        try {
            const queue = await offlineDB.getSyncQueue();
            const pendingExpenses = await offlineDB.getPendingExpenses();

            console.log(`Found ${queue.length} queued operations and ${pendingExpenses.length} pending expenses`);

            // Process sync queue
            for (const operation of queue) {
                if (operation.status === 'pending') {
                    await this.processOperation(operation);
                }
            }

            // Sync pending expenses
            for (const expense of pendingExpenses) {
                if (!expense.synced) {
                    await this.syncExpense(expense);
                }
            }

            this.syncMetrics.lastSyncTime = new Date().toISOString();
            this.emit('syncComplete', {
                synced: this.syncMetrics.totalSynced,
                failed: this.syncMetrics.totalFailed,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Sync failed:', error);
            this.emit('syncError', { error: error.message });
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Sync a single expense
     */
    async syncExpense(expense) {
        try {
            const response = await this.fetchWithRetry(
                `/api/expenses/${expense.id}`,
                {
                    method: expense.id < 0 ? 'POST' : 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(expense)
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            // Update expense with server response
            expense.id = result.id;
            expense.synced = true;
            expense.syncStatus = 'synced';
            expense.lastModified = new Date().toISOString();
            await offlineDB.addExpense(expense);

            this.syncMetrics.totalSynced++;
            this.emit('syncProgress', {
                type: 'expense',
                status: 'success',
                expense: expense
            });

        } catch (error) {
            console.error(`Failed to sync expense ${expense.id}:`, error);
            
            expense.syncStatus = 'failed';
            expense.lastError = error.message;
            await offlineDB.addExpense(expense);

            this.syncMetrics.totalFailed++;
            this.emit('syncProgress', {
                type: 'expense',
                status: 'failed',
                error: error.message,
                expense: expense
            });
        }
    }

    /**
     * Process a queue operation
     */
    async processOperation(operation) {
        try {
            const endpoint = this.getOperationEndpoint(operation);
            const method = this.getOperationMethod(operation.type);

            const response = await this.fetchWithRetry(
                endpoint,
                {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(operation.data)
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // Mark as synced
            await offlineDB.updateSyncQueueStatus(operation.id, 'synced');
            this.syncMetrics.totalSynced++;

            this.emit('syncProgress', {
                type: 'operation',
                status: 'success',
                operation: operation.type
            });

        } catch (error) {
            console.error(`Failed to process operation ${operation.id}:`, error);

            await offlineDB.updateSyncQueueStatus(operation.id, 'failed');
            this.syncMetrics.totalFailed++;

            this.emit('syncProgress', {
                type: 'operation',
                status: 'failed',
                error: error.message,
                operation: operation.type
            });
        }
    }

    /**
     * Add operation to sync queue
     */
    async queueOperation(type, data) {
        const operation = {
            type,
            data,
            status: 'pending'
        };

        const id = await offlineDB.addToSyncQueue(operation);
        operation.id = id;

        // Try sync immediately if online
        if (this.isOnline) {
            await this.processOperation(operation);
        }

        return id;
    }

    /**
     * Fetch with retry logic
     */
    async fetchWithRetry(url, options = {}, attempt = 1) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (error) {
            if (attempt < this.maxRetries && !navigator.onLine) {
                console.log(`Retry attempt ${attempt} after ${this.retryDelay}ms`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.fetchWithRetry(url, options, attempt + 1);
            }
            throw error;
        }
    }

    /**
     * Get endpoint for operation
     */
    getOperationEndpoint(operation) {
        const baseUrl = '/api';
        const operationMap = {
            'addExpense': '/expenses',
            'updateExpense': `/expenses/${operation.data.id}`,
            'deleteExpense': `/expenses/${operation.data.id}`,
            'updateBudget': `/budgets/${operation.data.id}`,
            'syncReceipt': `/receipts`,
            'syncLocation': `/locations`
        };
        return `${baseUrl}${operationMap[operation.type] || ''}`;
    }

    /**
     * Get HTTP method for operation
     */
    getOperationMethod(type) {
        const methods = {
            'addExpense': 'POST',
            'updateExpense': 'PUT',
            'deleteExpense': 'DELETE',
            'updateBudget': 'PUT',
            'syncReceipt': 'POST',
            'syncLocation': 'POST'
        };
        return methods[type] || 'POST';
    }

    /**
     * Handle sync conflicts
     */
    async handleConflict(expenseId, serverVersion, localVersion) {
        const conflict = {
            expenseId,
            serverVersion,
            localVersion,
            detectedAt: new Date().toISOString()
        };

        const conflictId = await offlineDB.createConflict(conflict);
        this.syncMetrics.conflicts.push(conflictId);

        // Emit conflict event for UI handling
        this.emit('syncError', {
            type: 'conflict',
            conflictId,
            expenseId,
            message: `Conflict detected for expense ${expenseId}`
        });

        return conflictId;
    }

    /**
     * Resolve a conflict
     */
    async resolveConflict(conflictId, resolution) {
        // resolution can be 'keepLocal', 'useServer', or a merged version
        const resolved = await offlineDB.resolveConflict(conflictId, resolution);
        
        // If merged, sync the resolved version
        if (resolution.type === 'merged') {
            await this.queueOperation('updateExpense', resolution.data);
        }

        return resolved;
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            isOnline: this.isOnline,
            syncInProgress: this.syncInProgress,
            metrics: this.syncMetrics,
            pendingCount: 0 // This should be updated dynamically
        };
    }

    /**
     * Register event listener
     */
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    /**
     * Unregister event listener
     */
    off(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    /**
     * Emit event
     */
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in sync listener for ${event}:`, error);
                }
            });
        }
    }

    /**
     * Clear sync metrics
     */
    clearMetrics() {
        this.syncMetrics = {
            totalSynced: 0,
            totalFailed: 0,
            lastSyncTime: null,
            conflicts: []
        };
    }
}

// Initialize global instance
const backgroundSyncManager = new BackgroundSyncManager();
