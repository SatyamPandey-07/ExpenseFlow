/**
 * OfflineDB - IndexedDB Database Manager for ExpenseFlow
 * Handles local storage, sync queue, and conflict resolution
 */

class OfflineDB {
    constructor() {
        this.dbName = 'ExpenseFlowDB';
        this.version = 1;
        this.db = null;
        this.stores = {
            expenses: 'expenses',
            transactionQueue: 'transactionQueue',
            syncMetadata: 'syncMetadata',
            receipts: 'receipts',
            budgets: 'budgets',
            categories: 'categories',
            locations: 'locations',
            biometricSettings: 'biometricSettings',
            conflicts: 'conflicts'
        };
    }

    /**
     * Initialize database
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('Database failed to open:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('Database opened successfully');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this._createObjectStores(db);
            };
        });
    }

    /**
     * Create object stores
     */
    _createObjectStores(db) {
        // Expenses store with indexes
        if (!db.objectStoreNames.contains(this.stores.expenses)) {
            const expenseStore = db.createObjectStore(this.stores.expenses, { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            expenseStore.createIndex('syncStatus', 'syncStatus', { unique: false });
            expenseStore.createIndex('timestamp', 'timestamp', { unique: false });
            expenseStore.createIndex('userId', 'userId', { unique: false });
            expenseStore.createIndex('category', 'category', { unique: false });
            expenseStore.createIndex('synced', 'synced', { unique: false });
        }

        // Transaction queue for pending operations
        if (!db.objectStoreNames.contains(this.stores.transactionQueue)) {
            const queueStore = db.createObjectStore(this.stores.transactionQueue, { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            queueStore.createIndex('type', 'type', { unique: false });
            queueStore.createIndex('status', 'status', { unique: false });
            queueStore.createIndex('timestamp', 'timestamp', { unique: false });
            queueStore.createIndex('expenseId', 'expenseId', { unique: false });
        }

        // Sync metadata
        if (!db.objectStoreNames.contains(this.stores.syncMetadata)) {
            const syncStore = db.createObjectStore(this.stores.syncMetadata, { 
                keyPath: 'key' 
            });
            syncStore.createIndex('lastSync', 'lastSync', { unique: false });
        }

        // Receipts store
        if (!db.objectStoreNames.contains(this.stores.receipts)) {
            const receiptStore = db.createObjectStore(this.stores.receipts, { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            receiptStore.createIndex('expenseId', 'expenseId', { unique: false });
            receiptStore.createIndex('synced', 'synced', { unique: false });
        }

        // Budgets store
        if (!db.objectStoreNames.contains(this.stores.budgets)) {
            const budgetStore = db.createObjectStore(this.stores.budgets, { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            budgetStore.createIndex('userId', 'userId', { unique: false });
            budgetStore.createIndex('period', 'period', { unique: false });
        }

        // Categories store
        if (!db.objectStoreNames.contains(this.stores.categories)) {
            const categoryStore = db.createObjectStore(this.stores.categories, { 
                keyPath: 'id' 
            });
            categoryStore.createIndex('userId', 'userId', { unique: false });
        }

        // Locations store for geolocation tracking
        if (!db.objectStoreNames.contains(this.stores.locations)) {
            const locationStore = db.createObjectStore(this.stores.locations, { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            locationStore.createIndex('expenseId', 'expenseId', { unique: false });
            locationStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Biometric settings
        if (!db.objectStoreNames.contains(this.stores.biometricSettings)) {
            db.createObjectStore(this.stores.biometricSettings, { keyPath: 'userId' });
        }

        // Conflict resolution store
        if (!db.objectStoreNames.contains(this.stores.conflicts)) {
            const conflictStore = db.createObjectStore(this.stores.conflicts, { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            conflictStore.createIndex('expenseId', 'expenseId', { unique: false });
            conflictStore.createIndex('resolved', 'resolved', { unique: false });
        }
    }

    /**
     * Add or update an expense
     */
    async addExpense(expense) {
        const transaction = this.db.transaction([this.stores.expenses], 'readwrite');
        const store = transaction.objectStore(this.stores.expenses);
        
        expense.timestamp = expense.timestamp || new Date().toISOString();
        expense.syncStatus = expense.syncStatus || 'pending';
        expense.synced = false;
        expense.version = 1;
        expense.lastModified = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const request = store.put(expense);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all expenses
     */
    async getAllExpenses() {
        const transaction = this.db.transaction([this.stores.expenses], 'readonly');
        const store = transaction.objectStore(this.stores.expenses);

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get pending expenses (not synced)
     */
    async getPendingExpenses() {
        const transaction = this.db.transaction([this.stores.expenses], 'readonly');
        const store = transaction.objectStore(this.stores.expenses);
        const index = store.index('synced');

        return new Promise((resolve, reject) => {
            const request = index.getAll(false);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete an expense
     */
    async deleteExpense(id) {
        const transaction = this.db.transaction([this.stores.expenses], 'readwrite');
        const store = transaction.objectStore(this.stores.expenses);

        return new Promise((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Add transaction to sync queue
     */
    async addToSyncQueue(operation) {
        const transaction = this.db.transaction([this.stores.transactionQueue], 'readwrite');
        const store = transaction.objectStore(this.stores.transactionQueue);

        operation.timestamp = operation.timestamp || new Date().toISOString();
        operation.status = operation.status || 'pending';

        return new Promise((resolve, reject) => {
            const request = store.add(operation);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get sync queue
     */
    async getSyncQueue() {
        const transaction = this.db.transaction([this.stores.transactionQueue], 'readonly');
        const store = transaction.objectStore(this.stores.transactionQueue);

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Update sync queue item status
     */
    async updateSyncQueueStatus(id, status) {
        const transaction = this.db.transaction([this.stores.transactionQueue], 'readwrite');
        const store = transaction.objectStore(this.stores.transactionQueue);

        return new Promise(async (resolve, reject) => {
            const getRequest = store.get(id);
            
            getRequest.onsuccess = () => {
                const item = getRequest.result;
                if (item) {
                    item.status = status;
                    item.lastUpdated = new Date().toISOString();
                    const updateRequest = store.put(item);
                    updateRequest.onsuccess = () => resolve(item);
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('Item not found'));
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    /**
     * Save receipt
     */
    async saveReceipt(receipt) {
        const transaction = this.db.transaction([this.stores.receipts], 'readwrite');
        const store = transaction.objectStore(this.stores.receipts);

        receipt.timestamp = receipt.timestamp || new Date().toISOString();
        receipt.synced = false;

        return new Promise((resolve, reject) => {
            const request = store.put(receipt);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get receipts by expense ID
     */
    async getReceiptsByExpenseId(expenseId) {
        const transaction = this.db.transaction([this.stores.receipts], 'readonly');
        const store = transaction.objectStore(this.stores.receipts);
        const index = store.index('expenseId');

        return new Promise((resolve, reject) => {
            const request = index.getAll(expenseId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save location data
     */
    async saveLocation(location) {
        const transaction = this.db.transaction([this.stores.locations], 'readwrite');
        const store = transaction.objectStore(this.stores.locations);

        location.timestamp = location.timestamp || new Date().toISOString();

        return new Promise((resolve, reject) => {
            const request = store.put(location);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get location by expense ID
     */
    async getLocationByExpenseId(expenseId) {
        const transaction = this.db.transaction([this.stores.locations], 'readonly');
        const store = transaction.objectStore(this.stores.locations);
        const index = store.index('expenseId');

        return new Promise((resolve, reject) => {
            const request = index.get(expenseId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save sync metadata
     */
    async saveSyncMetadata(key, data) {
        const transaction = this.db.transaction([this.stores.syncMetadata], 'readwrite');
        const store = transaction.objectStore(this.stores.syncMetadata);

        const metadata = {
            key,
            ...data,
            lastSync: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            const request = store.put(metadata);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get sync metadata
     */
    async getSyncMetadata(key) {
        const transaction = this.db.transaction([this.stores.syncMetadata], 'readonly');
        const store = transaction.objectStore(this.stores.syncMetadata);

        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Create conflict record
     */
    async createConflict(conflict) {
        const transaction = this.db.transaction([this.stores.conflicts], 'readwrite');
        const store = transaction.objectStore(this.stores.conflicts);

        conflict.timestamp = conflict.timestamp || new Date().toISOString();
        conflict.resolved = false;

        return new Promise((resolve, reject) => {
            const request = store.add(conflict);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get unresolved conflicts
     */
    async getUnresolvedConflicts() {
        const transaction = this.db.transaction([this.stores.conflicts], 'readonly');
        const store = transaction.objectStore(this.stores.conflicts);
        const index = store.index('resolved');

        return new Promise((resolve, reject) => {
            const request = index.getAll(false);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Resolve conflict
     */
    async resolveConflict(conflictId, resolution) {
        const transaction = this.db.transaction([this.stores.conflicts], 'readwrite');
        const store = transaction.objectStore(this.stores.conflicts);

        return new Promise(async (resolve, reject) => {
            const getRequest = store.get(conflictId);
            
            getRequest.onsuccess = () => {
                const conflict = getRequest.result;
                if (conflict) {
                    conflict.resolved = true;
                    conflict.resolution = resolution;
                    conflict.resolvedAt = new Date().toISOString();
                    
                    const updateRequest = store.put(conflict);
                    updateRequest.onsuccess = () => resolve(conflict);
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('Conflict not found'));
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    /**
     * Clear expired data
     */
    async clearExpiredData(daysOld = 90) {
        const expireBefore = new Date();
        expireBefore.setDate(expireBefore.getDate() - daysOld);

        const transaction = this.db.transaction([this.stores.expenses, this.stores.receipts], 'readwrite');
        const stores = [
            transaction.objectStore(this.stores.expenses),
            transaction.objectStore(this.stores.receipts)
        ];

        let cleaned = 0;

        for (const store of stores) {
            const allItems = await new Promise((resolve, reject) => {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            for (const item of allItems) {
                if (item.timestamp && new Date(item.timestamp) < expireBefore) {
                    await new Promise((resolve, reject) => {
                        const deleteRequest = store.delete(item.id);
                        deleteRequest.onsuccess = () => {
                            cleaned++;
                            resolve();
                        };
                        deleteRequest.onerror = () => reject(deleteRequest.error);
                    });
                }
            }
        }

        return cleaned;
    }

    /**
     * Get storage quota and usage
     */
    async getStorageStats() {
        if (!navigator.storage || !navigator.storage.estimate) {
            return null;
        }

        try {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                percentage: (estimate.usage / estimate.quota * 100).toFixed(2)
            };
        } catch (error) {
            console.error('Failed to get storage stats:', error);
            return null;
        }
    }

    /**
     * Request persistent storage
     */
    async requestPersistentStorage() {
        if (!navigator.storage || !navigator.storage.persist) {
            return false;
        }

        try {
            return await navigator.storage.persist();
        } catch (error) {
            console.error('Failed to request persistent storage:', error);
            return false;
        }
    }

    /**
     * Close database connection
     */
    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// Initialize global instance
const offlineDB = new OfflineDB();
