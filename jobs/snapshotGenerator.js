const cron = require('node-cron');
const User = require('../models/User');
const AuditSnapshot = require('../models/AuditSnapshot');
const replayEngine = require('../services/replayEngine');

/**
 * Snapshot Generator - Nightly job to create compressed state snapshots
 * Runs daily at 2 AM to create snapshots for all active users
 */
class SnapshotGenerator {
    constructor() {
        this.isRunning = false;
        this.job = null;
    }

    /**
     * Start the snapshot generator
     */
    start() {
        // Run every day at 2 AM
        this.job = cron.schedule('0 2 * * *', async () => {
            console.log('[SnapshotGenerator] Starting nightly snapshot generation...');
            await this.generateSnapshots();
        });

        console.log('[SnapshotGenerator] Scheduler started - will run daily at 2 AM');
    }

    /**
     * Stop the snapshot generator
     */
    stop() {
        if (this.job) {
            this.job.stop();
            console.log('[SnapshotGenerator] Scheduler stopped');
        }
    }

    /**
     * Generate snapshots for all active users
     */
    async generateSnapshots() {
        if (this.isRunning) {
            console.log('[SnapshotGenerator] Already running, skipping...');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();

        try {
            // Get all active users (users with activity in last 30 days)
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const activeUsers = await User.find({
                lastLogin: { $gte: thirtyDaysAgo }
            }).select('_id');

            console.log(`[SnapshotGenerator] Found ${activeUsers.length} active users`);

            let successCount = 0;
            let errorCount = 0;

            // Generate snapshot for each user
            for (const user of activeUsers) {
                try {
                    await this.generateUserSnapshot(user._id);
                    successCount++;
                } catch (error) {
                    console.error(`[SnapshotGenerator] Error generating snapshot for user ${user._id}:`, error);
                    errorCount++;
                }
            }

            const duration = Date.now() - startTime;
            console.log(`[SnapshotGenerator] Completed in ${duration}ms - Success: ${successCount}, Errors: ${errorCount}`);

            // Clean up old snapshots
            await this.cleanupOldSnapshots();

        } catch (error) {
            console.error('[SnapshotGenerator] Fatal error:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Generate snapshot for a single user
     */
    async generateUserSnapshot(userId) {
        const startTime = Date.now();

        try {
            // Get current state
            const currentState = await replayEngine.replayToDate(
                userId,
                new Date(),
                { includeTransactions: false, includeMetadata: false }
            );

            // Check if we already have a snapshot for today
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const existingSnapshot = await AuditSnapshot.findOne({
                user: userId,
                snapshotDate: { $gte: today },
                snapshotType: 'daily'
            });

            if (existingSnapshot) {
                console.log(`[SnapshotGenerator] Snapshot already exists for user ${userId}, skipping...`);
                return;
            }

            // Create snapshot
            const snapshot = await AuditSnapshot.createSnapshot(
                userId,
                currentState.state,
                'daily'
            );

            // Add metadata
            snapshot.metadata.generationDuration = Date.now() - startTime;
            snapshot.metadata.generatedBy = 'nightly-job';

            // Compress if state is large
            if (snapshot.originalSize > 10000) { // 10KB threshold
                await this.compressSnapshot(snapshot);
            }

            await snapshot.save();

            console.log(`[SnapshotGenerator] Created snapshot for user ${userId} (${snapshot.originalSize} bytes)`);

        } catch (error) {
            throw new Error(`Failed to generate snapshot for user ${userId}: ${error.message}`);
        }
    }

    /**
     * Compress snapshot data
     */
    async compressSnapshot(snapshot) {
        try {
            const zlib = require('zlib');
            const stateString = JSON.stringify(snapshot.state);

            // Compress using gzip
            const compressed = zlib.gzipSync(stateString);

            snapshot.compressed = true;
            snapshot.compressedSize = compressed.length;
            snapshot.compressionRatio = (compressed.length / snapshot.originalSize * 100).toFixed(2);

            // Store compressed data (in production, you might want to store this separately)
            console.log(`[SnapshotGenerator] Compressed ${snapshot.originalSize} bytes to ${compressed.length} bytes (${snapshot.compressionRatio}%)`);

        } catch (error) {
            console.error('[SnapshotGenerator] Compression error:', error);
        }
    }

    /**
     * Clean up old snapshots
     * Keep daily snapshots for 30 days, weekly for 90 days, monthly for 1 year
     */
    async cleanupOldSnapshots() {
        try {
            const now = new Date();

            // Delete daily snapshots older than 30 days
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const deletedDaily = await AuditSnapshot.deleteMany({
                snapshotType: 'daily',
                snapshotDate: { $lt: thirtyDaysAgo }
            });

            // Delete weekly snapshots older than 90 days
            const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            const deletedWeekly = await AuditSnapshot.deleteMany({
                snapshotType: 'weekly',
                snapshotDate: { $lt: ninetyDaysAgo }
            });

            // Delete monthly snapshots older than 1 year
            const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            const deletedMonthly = await AuditSnapshot.deleteMany({
                snapshotType: 'monthly',
                snapshotDate: { $lt: oneYearAgo }
            });

            console.log(`[SnapshotGenerator] Cleanup: Deleted ${deletedDaily.deletedCount} daily, ${deletedWeekly.deletedCount} weekly, ${deletedMonthly.deletedCount} monthly snapshots`);

        } catch (error) {
            console.error('[SnapshotGenerator] Cleanup error:', error);
        }
    }

    /**
     * Generate weekly snapshot for a user
     */
    async generateWeeklySnapshot(userId) {
        const currentState = await replayEngine.replayToDate(
            userId,
            new Date(),
            { includeTransactions: false, includeMetadata: false }
        );

        const snapshot = await AuditSnapshot.createSnapshot(
            userId,
            currentState.state,
            'weekly'
        );

        snapshot.metadata.generatedBy = 'weekly-job';
        await snapshot.save();

        return snapshot;
    }

    /**
     * Generate monthly snapshot for a user
     */
    async generateMonthlySnapshot(userId) {
        const currentState = await replayEngine.replayToDate(
            userId,
            new Date(),
            { includeTransactions: false, includeMetadata: false }
        );

        const snapshot = await AuditSnapshot.createSnapshot(
            userId,
            currentState.state,
            'monthly'
        );

        snapshot.metadata.generatedBy = 'monthly-job';
        await snapshot.save();

        return snapshot;
    }
}

module.exports = new SnapshotGenerator();
