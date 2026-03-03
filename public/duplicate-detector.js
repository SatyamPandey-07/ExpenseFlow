/**
 * Duplicate Detector - Automatic Duplicate Transaction Detection
 * Smart identification and merging of duplicate transactions
 * Handles card processing errors, double charges, and transaction reversals
 */

class DuplicateDetector {
  constructor() {
    this.duplicateClusters = [];
    this.detectionHistory = [];
    this.mergedTransactions = new Map();
  }

  /**
   * Detect duplicate transactions in a list
   * @param {Array} transactions - List of transactions to analyze
   * @returns {Array} - Clusters of potential duplicates
   */
  detectDuplicates(transactions) {
    const clusters = [];
    const processed = new Set();

    // Sort by date for efficient comparison
    const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    for (let i = 0; i < sorted.length; i++) {
      if (processed.has(i)) continue;

      const tx1 = sorted[i];
      const cluster = [{ idx: i, transaction: tx1 }];

      // Look for duplicates within a time window (7 days)
      for (let j = i + 1; j < sorted.length && j < i + 50; j++) {
        if (processed.has(j)) continue;

        const tx2 = sorted[j];
        const daysDiff = (new Date(tx2.date) - new Date(tx1.date)) / (1000 * 60 * 60 * 24);

        if (daysDiff > 7) break; // Outside time window

        const similarity = this.calculateSimilarity(tx1, tx2);

        if (similarity > 0.85) { // >85% similarity = potential duplicate
          cluster.push({ idx: j, transaction: tx2, similarity });
          processed.add(j);
        }
      }

      if (cluster.length > 1) {
        const duplicate = {
          clusterId: `cluster-${Date.now()}-${Math.random()}`,
          transactions: cluster,
          severity: this.calculateSeverity(cluster),
          confidence: this.calculateClusterConfidence(cluster),
          suggestion: this.suggestMergeAction(cluster),
          mergedAmount: this.calculateMergedAmount(cluster)
        };

        clusters.push(duplicate);
        processed.add(i);
      }
    }

    this.duplicateClusters = clusters;
    return clusters;
  }

  /**
   * Calculate similarity between two transactions (0-1)
   */
  calculateSimilarity(tx1, tx2) {
    let score = 0;
    let factors = 0;

    // Amount similarity (exact match = 1.0, within 10% = 0.5)
    const amountDiff = Math.abs(tx1.amount - tx2.amount);
    const amountMax = Math.max(tx1.amount, tx2.amount);
    const amountSimilarity = Math.max(0, 1 - (amountDiff / amountMax));
    score += amountSimilarity * 0.4;
    factors += 0.4;

    // Merchant similarity
    const merchant1 = (tx1.merchant || '').toLowerCase();
    const merchant2 = (tx2.merchant || '').toLowerCase();
    const merchantSimilarity = this.stringSimilarity(merchant1, merchant2);
    score += merchantSimilarity * 0.35;
    factors += 0.35;

    // Description similarity
    const desc1 = (tx1.description || '').toLowerCase();
    const desc2 = (tx2.description || '').toLowerCase();
    const descSimilarity = this.stringSimilarity(desc1, desc2);
    score += descSimilarity * 0.15;
    factors += 0.15;

    // Time proximity (same day = 1.0, within 3 days = 0.7)
    const daysDiff = Math.abs((new Date(tx1.date) - new Date(tx2.date)) / (1000 * 60 * 60 * 24));
    const timeSimilarity = Math.max(0, 1 - (daysDiff / 3));
    score += timeSimilarity * 0.1;
    factors += 0.1;

    return score / factors;
  }

  /**
   * String similarity using Levenshtein distance
   */
  stringSimilarity(str1, str2) {
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0;

    const distance = this.levenshteinDistance(str1, str2);
    return 1 - (distance / maxLength);
  }

  /**
   * Levenshtein distance calculation
   */
  levenshteinDistance(str1, str2) {
    const arr = [];
    for (let i = 0; i <= str2.length; i++) {
      arr[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      arr[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        const cost = str1[j - 1] === str2[i - 1] ? 0 : 1;
        arr[i][j] = Math.min(
          arr[i][j - 1] + 1,
          arr[i - 1][j] + 1,
          arr[i - 1][j - 1] + cost
        );
      }
    }

    return arr[str2.length][str1.length];
  }

  /**
   * Calculate severity of duplicate cluster
   */
  calculateSeverity(cluster) {
    if (cluster.length > 2) return 'Critical'; // More than 2 = likely fraud
    
    const totalAmount = cluster.reduce((sum, item) => sum + item.transaction.amount, 0);
    const accountTotal = 5000; // Assume average account balance
    
    if (totalAmount > accountTotal * 0.1) return 'High'; // >10% of balance
    if (totalAmount > 500) return 'Medium';
    return 'Low';
  }

  /**
   * Calculate confidence of duplicate cluster
   */
  calculateClusterConfidence(cluster) {
    if (cluster.length < 2) return 0;

    const similarities = cluster
      .slice(1)
      .map(item => item.similarity || 0);

    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;

    // Exact amount match increases confidence
    const amountsMatch = cluster.slice(1).every(item => item.transaction.amount === cluster[0].transaction.amount);
    const adjustment = amountsMatch ? 1.05 : 0.95;

    return Math.min(avgSimilarity * adjustment, 1);
  }

  /**
   * Suggest merge action
   */
  suggestMergeAction(cluster) {
    const firstTx = cluster[0].transaction;

    if (cluster.length > 2) {
      return `ALERT: ${cluster.length} identical transactions detected. Likely fraud. Contact bank immediately.`;
    }

    const totalDuplicated = cluster.slice(1).reduce((sum, item) => sum + item.transaction.amount, 0);

    return `Merge duplicate transactions. This will reverse $${totalDuplicated.toFixed(2)} in charges.`;
  }

  /**
   * Calculate merged amount (final corrected amount)
   */
  calculateMergedAmount(cluster) {
    // Typically keep the first transaction, reverse others
    return cluster[0].transaction.amount;
  }

  /**
   * Merge transactions in a cluster
   */
  mergeCluster(clusterId, keepTransaction = null) {
    const cluster = this.duplicateClusters.find(c => c.clusterId === clusterId);
    if (!cluster) {
      return { success: false, message: 'Cluster not found' };
    }

    // Determine which transaction to keep
    let kept = keepTransaction || cluster.transactions[0].transaction;
    const toRemove = cluster.transactions
      .filter(item => item.transaction.id !== kept.id)
      .map(item => item.transaction);

    // Calculate correction
    const removedAmount = toRemove.reduce((sum, tx) => sum + tx.amount, 0);

    const merged = {
      originalTransaction: kept,
      removedTransactions: toRemove,
      correctionAmount: -removedAmount,
      mergedAt: new Date(),
      clusterId
    };

    this.mergedTransactions.set(clusterId, merged);

    this.detectionHistory.push({
      type: 'CLUSTER_MERGED',
      cluster,
      action: merged,
      timestamp: new Date()
    });

    return {
      success: true,
      message: `Merged ${cluster.transactions.length} transactions. Correction: -$${removedAmount.toFixed(2)}`,
      merged
    };
  }

  /**
   * Detect specific duplicate types
   */
  detectDoubleCharges(transactions) {
    const doubles = [];
    const timeWindow = 1000 * 60 * 5; // 5 minutes

    for (let i = 0; i < transactions.length - 1; i++) {
      const tx1 = transactions[i];

      for (let j = i + 1; j < transactions.length; j++) {
        const tx2 = transactions[j];

        const timeDiff = Math.abs(new Date(tx1.date) - new Date(tx2.date));
        const amountMatch = tx1.amount === tx2.amount;
        const merchantMatch = (tx1.merchant || '').toLowerCase() === (tx2.merchant || '').toLowerCase();

        if (timeDiff < timeWindow && amountMatch && merchantMatch) {
          doubles.push({
            transactions: [tx1, tx2],
            type: 'EXACT_DOUBLE_CHARGE',
            severity: 'Critical',
            correction: -tx2.amount
          });
        }
      }
    }

    return doubles;
  }

  /**
   * Detect refunds that haven't been matched
   */
  detectUnmatchedRefunds(transactions) {
    const refunds = transactions.filter(t => t.amount < 0);
    const unmatched = [];

    refunds.forEach(refund => {
      const spent = transactions.find(t =>
        t.amount === Math.abs(refund.amount) &&
        (t.merchant || '').toLowerCase() === (refund.merchant || '').toLowerCase() &&
        new Date(t.date) < new Date(refund.date)
      );

      if (!spent) {
        unmatched.push({
          refund,
          type: 'UNMATCHED_REFUND',
          reason: 'No corresponding charge found',
          action: 'Verify refund source'
        });
      }
    });

    return unmatched;
  }

  /**
   * Detect potential fraud patterns
   */
  detectFraudPatterns(transactions) {
    const patterns = [];

    // Multiple small charges before large charge (testing card)
    const recentSmall = transactions
      .filter(t => t.amount < 10)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    if (recentSmall.length >= 3) {
      const largeCharge = transactions.find(t =>
        t.amount > 100 &&
        new Date(t.date) > new Date(recentSmall[0].date)
      );

      if (largeCharge) {
        patterns.push({
          type: 'CARD_TESTING_PATTERN',
          severity: 'Medium',
          description: 'Multiple small charges followed by large charge',
          transactions: [...recentSmall, largeCharge]
        });
      }
    }

    // Geographic anomalies
    const locations = transactions.map(t => t.location).filter(l => l);
    if (locations.length > 5) {
      const uniqueLocations = new Set(locations);
      if (uniqueLocations.size > 10) {
        patterns.push({
          type: 'GEOGRAPHIC_ANOMALY',
          severity: 'Low',
          description: `${uniqueLocations.size} different locations in recent transactions`,
          suggestion: 'Verify all transactions are legitimate'
        });
      }
    }

    return patterns;
  }

  /**
   * Undo merge operation
   */
  undoMerge(clusterId) {
    const merged = this.mergedTransactions.get(clusterId);
    if (!merged) {
      return { success: false, message: 'Merge record not found' };
    }

    this.mergedTransactions.delete(clusterId);
    this.duplicateClusters = this.duplicateClusters.filter(c => c.clusterId !== clusterId);

    this.detectionHistory.push({
      type: 'MERGE_UNDONE',
      clusterId,
      timestamp: new Date()
    });

    return {
      success: true,
      message: 'Merge operation undone. All transactions restored.',
      restored: merged
    };
  }

  /**
   * Get duplicate detection summary
   */
  getSummary() {
    const totalDuplicates = this.duplicateClusters.reduce((sum, c) => sum + (c.transactions.length - 1), 0);
    const totalCorrectionAmount = this.duplicateClusters.reduce((sum, c) => sum + parseFloat(c.mergedAmount), 0);

    const bySeverity = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    this.duplicateClusters.forEach(c => {
      bySeverity[c.severity]++;
    });

    return {
      totalClusters: this.duplicateClusters.length,
      totalDuplicateTransactions: totalDuplicates,
      totalCorrectionNeeded: totalCorrectionAmount.toFixed(2),
      bySeverity,
      merged: this.mergedTransactions.size,
      detectionAccuracy: (this.duplicateClusters.reduce((sum, c) => sum + c.confidence, 0) / Math.max(this.duplicateClusters.length, 1) * 100).toFixed(0) + '%'
    };
  }

  /**
   * Export detection report
   */
  exportReport() {
    return {
      timestamp: new Date(),
      summary: this.getSummary(),
      clusters: this.duplicateClusters,
      history: this.detectionHistory.slice(-50) // Last 50 actions
    };
  }
}

// Global instance
const duplicateDetector = new DuplicateDetector();
