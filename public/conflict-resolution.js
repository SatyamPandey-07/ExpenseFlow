/**
 * Conflict Resolution Engine - Handle sync conflicts intelligently
 * Detects and resolves conflicts with multiple strategies
 */

class ConflictResolutionEngine {
    constructor() {
        this.conflicts = [];
        this.resolutionStrategies = new Map();
        this.mergeStrategies = new Map();
        this.conflictHistory = [];
        this.autoResolveThreshold = 0.8; // 80% confidence
    }

    /**
     * Initialize conflict resolution
     */
    async init() {
        this.registerDefaultStrategies();
        console.log('Conflict resolution engine initialized');
    }

    /**
     * Register default resolution strategies
     */
    registerDefaultStrategies() {
        // Last-write-wins strategy
        this.registerStrategy('lastWriteWins', (local, server) => {
            const localTime = new Date(local.lastModified).getTime();
            const serverTime = new Date(server.lastModified).getTime();
            return localTime > serverTime ? local : server;
        });

        // Server-wins strategy (trust server as source of truth)
        this.registerStrategy('serverWins', (local, server) => {
            return server;
        });

        // Local-wins strategy (user's latest changes take priority)
        this.registerStrategy('localWins', (local, server) => {
            return local;
        });

        // Smart merge strategy
        this.registerStrategy('smartMerge', (local, server) => {
            return this.smartMerge(local, server);
        });

        // Highest amount wins (for expenses)
        this.registerStrategy('highestAmount', (local, server) => {
            if (local.amount > server.amount) return local;
            if (server.amount > local.amount) return server;
            return this.smartMerge(local, server);
        });

        // Most recent date wins (by transaction date)
        this.registerStrategy('mostRecentDate', (local, server) => {
            const localDate = new Date(local.date || local.createdAt).getTime();
            const serverDate = new Date(server.date || server.createdAt).getTime();
            return localDate > serverDate ? local : server;
        });
    }

    /**
     * Register custom resolution strategy
     */
    registerStrategy(name, resolver) {
        this.resolutionStrategies.set(name, resolver);
    }

    /**
     * Detect conflict
     */
    async detectConflict(localVersion, serverVersion) {
        // Check if versions differ significantly
        if (JSON.stringify(localVersion) === JSON.stringify(serverVersion)) {
            return null; // No conflict
        }

        const conflict = {
            id: this.generateConflictId(),
            local: { ...localVersion, version: localVersion.version || 1 },
            server: { ...serverVersion, version: serverVersion.version || 1 },
            detectedAt: new Date().toISOString(),
            resolved: false,
            resolution: null
        };

        // Analyze conflict
        conflict.analysis = this.analyzeConflict(conflict.local, conflict.server);

        // Determine if it can be auto-resolved
        conflict.canAutoResolve = conflict.analysis.confidence >= this.autoResolveThreshold;

        this.conflicts.push(conflict);
        this.conflictHistory.push(conflict);

        return conflict;
    }

    /**
     * Analyze conflict
     */
    analyzeConflict(local, server) {
        const analysis = {
            fieldsChanged: [],
            severity: 'low',
            confidence: 0,
            suggestedStrategy: 'smartMerge',
            changes: {}
        };

        // Compare each field
        const allKeys = new Set([
            ...Object.keys(local),
            ...Object.keys(server)
        ]);

        for (const key of allKeys) {
            if (local[key] !== server[key]) {
                analysis.fieldsChanged.push(key);
                analysis.changes[key] = {
                    local: local[key],
                    server: server[key]
                };
            }
        }

        // Determine severity
        if (analysis.fieldsChanged.length === 0) {
            analysis.severity = 'none';
        } else if (analysis.fieldsChanged.length <= 2) {
            analysis.severity = 'low';
            analysis.confidence = 0.9;
        } else if (analysis.fieldsChanged.length <= 5) {
            analysis.severity = 'medium';
            analysis.confidence = 0.7;
        } else {
            analysis.severity = 'high';
            analysis.confidence = 0.4;
        }

        // Suggest strategy based on field changes
        if (analysis.fieldsChanged.includes('amount')) {
            analysis.suggestedStrategy = 'highestAmount';
        } else if (analysis.fieldsChanged.includes('lastModified') && analysis.fieldsChanged.length === 1) {
            analysis.suggestedStrategy = 'lastWriteWins';
            analysis.confidence = 0.95;
        } else {
            analysis.suggestedStrategy = 'smartMerge';
        }

        return analysis;
    }

    /**
     * Resolve conflict with specified strategy
     */
    async resolveConflict(conflictId, strategyName = 'smartMerge') {
        const conflict = this.conflicts.find(c => c.id === conflictId);
        if (!conflict) {
            throw new Error(`Conflict ${conflictId} not found`);
        }

        const strategy = this.resolutionStrategies.get(strategyName);
        if (!strategy) {
            throw new Error(`Strategy ${strategyName} not found`);
        }

        try {
            conflict.resolution = strategy(conflict.local, conflict.server);
            conflict.resolved = true;
            conflict.resolvedAt = new Date().toISOString();
            conflict.resolutionStrategy = strategyName;

            // Save resolved conflict
            await this.saveResolution(conflict);

            console.log(`Conflict ${conflictId} resolved using ${strategyName}`);

            return conflict;

        } catch (error) {
            console.error(`Failed to resolve conflict ${conflictId}:`, error);
            throw error;
        }
    }

    /**
     * Auto-resolve conflicts
     */
    async autoResolveConflicts() {
        const unresolvedConflicts = this.conflicts.filter(c => !c.resolved);
        const autoResolved = [];

        for (const conflict of unresolvedConflicts) {
            if (conflict.canAutoResolve) {
                try {
                    const resolved = await this.resolveConflict(
                        conflict.id,
                        conflict.analysis.suggestedStrategy
                    );
                    autoResolved.push(resolved);

                    console.log(`Auto-resolved conflict ${conflict.id}`);
                } catch (error) {
                    console.error(`Failed to auto-resolve conflict ${conflict.id}:`, error);
                }
            }
        }

        return autoResolved;
    }

    /**
     * Smart merge for complex objects
     */
    smartMerge(local, server) {
        const merged = { ...server };

        // For each field in local, decide whether to use local or server value
        for (const [key, localValue] of Object.entries(local)) {
            const serverValue = server[key];

            // Don't override server system fields
            if (['id', 'createdAt', 'version'].includes(key)) {
                continue;
            }

            // Use local value if it's more recent
            if (local.lastModified && server.lastModified) {
                const localTime = new Date(local.lastModified).getTime();
                const serverTime = new Date(server.lastModified).getTime();

                if (localTime > serverTime) {
                    merged[key] = localValue;
                }
            } else if (localValue !== serverValue) {
                // If no timestamp, prefer non-null values
                merged[key] = localValue || serverValue;
            }
        }

        // Merge metadata
        merged.mergedAt = new Date().toISOString();
        merged.mergedFrom = { local, server };
        merged.version = Math.max(
            local.version || 1,
            server.version || 1
        ) + 1;

        return merged;
    }

    /**
     * Resolve with user input
     */
    async resolveWithUserInput(conflictId, userChoice) {
        const conflict = this.conflicts.find(c => c.id === conflictId);
        if (!conflict) {
            throw new Error(`Conflict ${conflictId} not found`);
        }

        // userChoice can be 'local', 'server', or merged object
        let resolution;

        if (userChoice === 'local') {
            resolution = conflict.local;
        } else if (userChoice === 'server') {
            resolution = conflict.server;
        } else if (typeof userChoice === 'object') {
            resolution = userChoice;
        } else {
            throw new Error('Invalid user choice');
        }

        conflict.resolution = resolution;
        conflict.resolved = true;
        conflict.resolverType = 'user-choice';
        conflict.resolvedAt = new Date().toISOString();

        await this.saveResolution(conflict);

        return conflict;
    }

    /**
     * Save conflict resolution
     */
    async saveResolution(conflict) {
        try {
            // Save to database
            await offlineDB.resolveConflict(conflict.id, {
                type: conflict.resolution ? 'resolved' : 'pending',
                strategy: conflict.resolutionStrategy,
                data: conflict.resolution
            });

            // Queue sync
            await backgroundSyncManager.queueOperation('updateExpense', conflict.resolution);

        } catch (error) {
            console.error('Failed to save resolution:', error);
            throw error;
        }
    }

    /**
     * Three-way merge (base, local, server)
     */
    threeWayMerge(base, local, server) {
        const merged = { ...base };

        // Identify changes from base
        const localChanges = this.getChanges(base, local);
        const serverChanges = this.getChanges(base, server);

        // Check for conflicts in changed fields
        for (const key of Object.keys(localChanges)) {
            if (key in serverChanges) {
                // Both changed the same field
                if (local[key] === server[key]) {
                    // Same value, use it
                    merged[key] = local[key];
                } else {
                    // Conflict! Use most recent
                    const localTime = new Date(local.lastModified || 0).getTime();
                    const serverTime = new Date(server.lastModified || 0).getTime();
                    merged[key] = localTime > serverTime ? local[key] : server[key];
                }
            } else {
                // Only local changed
                merged[key] = local[key];
            }
        }

        // Apply server-only changes
        for (const key of Object.keys(serverChanges)) {
            if (!(key in localChanges)) {
                merged[key] = server[key];
            }
        }

        return merged;
    }

    /**
     * Get changes between versions
     */
    getChanges(version1, version2) {
        const changes = {};

        for (const key of Object.keys(version2)) {
            if (!(key in version1) || version1[key] !== version2[key]) {
                changes[key] = version2[key];
            }
        }

        return changes;
    }

    /**
     * Detect merge conflicts in diffs
     */
    detectMergeConflicts(base, local, server) {
        const conflicts = [];

        const allKeys = new Set([
            ...Object.keys(local),
            ...Object.keys(server)
        ]);

        for (const key of allKeys) {
            const baseVal = base?.[key];
            const localVal = local[key];
            const serverVal = server[key];

            // Check if both sides changed the same field differently
            if (baseVal !== localVal && baseVal !== serverVal && localVal !== serverVal) {
                conflicts.push({
                    field: key,
                    base: baseVal,
                    local: localVal,
                    server: serverVal
                });
            }
        }

        return conflicts;
    }

    /**
     * Get unresolved conflicts
     */
    getUnresolvedConflicts() {
        return this.conflicts.filter(c => !c.resolved);
    }

    /**
     * Get conflict history
     */
    getConflictHistory(limit = 100) {
        return this.conflictHistory.slice(-limit);
    }

    /**
     * Get conflict statistics
     */
    getConflictStats() {
        return {
            total: this.conflicts.length,
            resolved: this.conflicts.filter(c => c.resolved).length,
            pending: this.conflicts.filter(c => !c.resolved).length,
            bySeverity: {
                low: this.conflicts.filter(c => c.analysis?.severity === 'low').length,
                medium: this.conflicts.filter(c => c.analysis?.severity === 'medium').length,
                high: this.conflicts.filter(c => c.analysis?.severity === 'high').length
            },
            resolutionStrategies: {
                ...Object.fromEntries(
                    Array.from(new Set(
                        this.conflicts
                            .filter(c => c.resolutionStrategy)
                            .map(c => c.resolutionStrategy)
                    )).map(s => [s, this.conflicts.filter(c => c.resolutionStrategy === s).length])
                )
            }
        };
    }

    /**
     * Clear resolved conflicts
     */
    clearResolvedConflicts() {
        const before = this.conflicts.length;
        this.conflicts = this.conflicts.filter(c => !c.resolved);
        console.log(`Cleared ${before - this.conflicts.length} resolved conflicts`);
    }

    /**
     * Generate conflict ID
     */
    generateConflictId() {
        return `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Export conflict history
     */
    exportConflictHistory() {
        return {
            conflicts: this.conflictHistory,
            stats: this.getConflictStats(),
            exportedAt: new Date().toISOString()
        };
    }

    /**
     * Check if field supports custom merge
     */
    supportsFieldMerge(fieldName, fieldType) {
        // Define which fields can be intelligently merged
        const mergeable = {
            'notes': 'text', // Concatenate
            'tags': 'array', // Union
            'attachments': 'array', // Union
            'reminder': 'date', // Use most recent
            'location': 'object' // Smart merge
        };

        return mergeable[fieldName];
    }

    /**
     * Custom field merge
     */
    mergeField(fieldName, localValue, serverValue, fieldType) {
        if (fieldType === 'text') {
            // Concatenate with separator
            return localValue && serverValue ? 
                `${serverValue}\n\n---\n\n${localValue}` : 
                (localValue || serverValue);
        } else if (fieldType === 'array') {
            // Union of arrays (remove duplicates)
            const arr1 = Array.isArray(localValue) ? localValue : [];
            const arr2 = Array.isArray(serverValue) ? serverValue : [];
            return [...new Set([...arr1, ...arr2])];
        } else if (fieldType === 'date') {
            // Use most recent date
            const t1 = new Date(localValue).getTime();
            const t2 = new Date(serverValue).getTime();
            return t1 > t2 ? localValue : serverValue;
        }

        return localValue || serverValue;
    }
}

// Initialize global instance
const conflictResolutionEngine = new ConflictResolutionEngine();
