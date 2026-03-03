/**
 * Anomaly Detector - Suspicious Transaction Detection
 * Identifies unusual spending patterns using statistical analysis
 * Detects fraud, unusual behavior, and outliers
 */

class AnomalyDetector {
  constructor() {
    this.anomalyHistory = [];
    this.userBaselines = new Map(); // userId → baseline stats
    this.detectionMethods = ['statistical', 'behavioral', 'merchant', 'temporal'];
  }

  /**
   * Detect anomalies in a transaction
   * @param {Object} transaction - Transaction to analyze
   * @param {Array} historicalTransactions - Past transactions for baseline
   * @returns {Object} - {anomalyScore, isAnomaly, reasons, confidence}
   */
  detectAnomaly(transaction, historicalTransactions = []) {
    const scores = {
      statistical: this.statisticalAnomaly(transaction, historicalTransactions),
      behavioral: this.behavioralAnomaly(transaction, historicalTransactions),
      merchant: this.merchantAnomaly(transaction, historicalTransactions),
      temporal: this.temporalAnomaly(transaction, historicalTransactions)
    };

    const anomalyScore = Object.values(scores).reduce((a, b) => a + b, 0) / 4;
    const threshold = 0.6; // 60% anomaly score = alert threshold

    return {
      anomalyScore: Math.round(anomalyScore * 100) / 100,
      isAnomaly: anomalyScore > threshold,
      severity: this.calculateSeverity(anomalyScore),
      reasons: this.generateReasons(scores, transaction, historicalTransactions),
      confidence: Math.min(anomalyScore, 1),
      methodScores: scores,
      recommendation: this.getRecommendation(anomalyScore)
    };
  }

  /**
   * Statistical anomaly detection using z-score
   */
  statisticalAnomaly(transaction, historical) {
    if (historical.length < 3) return 0; // Not enough data

    const amounts = historical.map(t => t.amount).filter(a => a > 0);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    const zScore = Math.abs((transaction.amount - mean) / stdDev);
    // Z-score > 3 is typically considered anomalous
    return Math.min(zScore / 3, 1);
  }

  /**
   * Behavioral anomaly detection
   */
  behavioralAnomaly(transaction, historical) {
    let score = 0;

    // Check category frequency
    const sameCategory = historical.filter(t => t.category === transaction.category);
    if (sameCategory.length === 0 && historical.length > 10) {
      score += 0.4; // New category with history
    }

    // Check spending time
    const txTime = new Date(transaction.date).getHours();
    const historicalHours = historical.map(t => new Date(t.date).getHours());
    const commonHours = this.getModeValues(historicalHours);

    if (!commonHours.includes(txTime) && historical.length > 5) {
      score += 0.2; // Unusual time
    }

    // Check frequency spike
    const dayOfTx = new Date(transaction.date).toDateString();
    const todayTransactions = historical.filter(t => new Date(t.date).toDateString() === dayOfTx);
    if (todayTransactions.length > 10) {
      score += 0.3; // Multiple transactions in one day
    }

    return Math.min(score, 1);
  }

  /**
   * Merchant-based anomaly detection
   */
  merchantAnomaly(transaction, historical) {
    let score = 0;

    const merchantTransactions = historical.filter(t => 
      (t.merchant || '').toLowerCase() === (transaction.merchant || '').toLowerCase()
    );

    // First transaction at merchant
    if (merchantTransactions.length === 0 && historical.length > 5) {
      score += 0.25;
    }

    // Amount out of bounds for this merchant
    if (merchantTransactions.length > 2) {
      const merchantAmounts = merchantTransactions.map(t => t.amount);
      const merchantMax = Math.max(...merchantAmounts);
      const merchantMin = Math.min(...merchantAmounts);

      if (transaction.amount > merchantMax * 1.5 || transaction.amount < merchantMin * 0.5) {
        score += 0.35;
      }
    }

    // High-risk merchant (known fraud merchants)
    if (this.isHighRiskMerchant(transaction.merchant)) {
      score += 0.4;
    }

    return Math.min(score, 1);
  }

  /**
   * Temporal anomaly detection
   */
  temporalAnomaly(transaction, historical) {
    let score = 0;

    // Most transactions from location, sudden location change is anomalous
    const lastMonthTransactions = historical.filter(t => {
      const txDate = new Date(t.date);
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      return txDate > oneMonthAgo;
    });

    if (lastMonthTransactions.length > 5 && transaction.location) {
      const locations = lastMonthTransactions.map(t => t.location).filter(l => l);
      if (locations.length > 0) {
        const uniqueLocations = new Set(locations);
        if (!locations.includes(transaction.location) && uniqueLocations.size < 3) {
          score += 0.3; // New location, limited history
        }
      }
    }

    // Weekend vs weekday patterns
    const txDay = new Date(transaction.date).getDay();
    const isWeekend = txDay === 0 || txDay === 6;
    const historicalDays = historical.map(t => new Date(t.date).getDay());
    const isNormalWeekend = historicalDays.filter(d => d === 0 || d === 6).length > 0;

    if (isWeekend && !isNormalWeekend && historical.length > 5) {
      score += 0.2;
    }

    return Math.min(score, 1);
  }

  /**
   * Helper: Get mode (most common values) from array
   */
  getModeValues(arr) {
    const counts = {};
    let maxCount = 0;

    arr.forEach(val => {
      counts[val] = (counts[val] || 0) + 1;
      maxCount = Math.max(maxCount, counts[val]);
    });

    return Object.keys(counts).filter(key => counts[key] === maxCount).map(Number);
  }

  /**
   * Check if merchant is high-risk (known fraud merchants)
   */
  isHighRiskMerchant(merchant) {
    const highRiskKeywords = ['casino', 'gambling', 'liquor store', 'tobacco', 'wire transfer', 'atm'];
    const merchantLower = (merchant || '').toLowerCase();
    return highRiskKeywords.some(keyword => merchantLower.includes(keyword));
  }

  /**
   * Calculate severity level
   */
  calculateSeverity(score) {
    if (score > 0.8) return 'Critical';
    if (score > 0.65) return 'High';
    if (score > 0.5) return 'Medium';
    return 'Low';
  }

  /**
   * Generate human-readable reasons for anomaly
   */
  generateReasons(scores, transaction, historical) {
    const reasons = [];

    if (scores.statistical > 0.5) {
      reasons.push(`Amount $${transaction.amount} is significantly higher than usual (${scores.statistical.toFixed(2)}/1.0 score)`);
    }

    if (scores.behavioral > 0.5) {
      reasons.push('Unusual spending behavior detected');
    }

    if (scores.merchant > 0.5) {
      reasons.push(`Uncommon merchant: ${transaction.merchant}`);
    }

    if (scores.temporal > 0.5) {
      reasons.push('Transaction at unusual time or location');
    }

    if (reasons.length === 0) {
      reasons.push('Slight deviation from normal patterns');
    }

    return reasons;
  }

  /**
   * Get recommendation based on anomaly score
   */
  getRecommendation(score) {
    if (score > 0.8) {
      return 'VERIFY_IMMEDIATELY: Block transaction pending user verification';
    }
    if (score > 0.65) {
      return 'ALERT_USER: Flag transaction but allow with confirmation';
    }
    if (score > 0.5) {
      return 'MONITOR: Log anomaly for pattern analysis but allow';
    }
    return 'NORMAL: No action needed';
  }

  /**
   * Detect spending anomalies across multiple categories
   */
  detectCategoryAnomalies(transactions) {
    const categoryStats = new Map();

    transactions.forEach(t => {
      if (!categoryStats.has(t.category)) {
        categoryStats.set(t.category, []);
      }
      categoryStats.get(t.category).push(t.amount);
    });

    const anomalies = [];

    for (const [category, amounts] of categoryStats.entries()) {
      if (amounts.length > 2) {
        const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
        const variance = amounts.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / amounts.length;
        const stdDev = Math.sqrt(variance);

        amounts.forEach((amount, idx) => {
          const zScore = Math.abs((amount - mean) / stdDev);
          if (zScore > 2.5) {
            anomalies.push({
              category,
              amount,
              zScore: zScore.toFixed(2),
              severity: zScore > 3 ? 'High' : 'Medium'
            });
          }
        });
      }
    }

    return anomalies;
  }

  /**
   * Create baseline from historical transactions
   */
  createBaseline(userId, transactions) {
    const amounts = transactions.map(t => t.amount);
    const categories = transactions.map(t => t.category);

    const baseline = {
      userId,
      createdAt: new Date(),
      avgDailySpend: amounts.reduce((a, b) => a + b, 0) / 30,
      maxTransaction: Math.max(...amounts),
      minTransaction: Math.min(...amounts),
      commonCategories: [...new Set(categories)],
      transactions: transactions.length,
      stdDev: Math.sqrt(amounts.reduce((sq, n) => sq + Math.pow(n - average, 2), 0) / amounts.length)
    };

    const average = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    baseline.stdDev = Math.sqrt(amounts.reduce((sq, n) => sq + Math.pow(n - average, 2), 0) / amounts.length);

    this.userBaselines.set(userId, baseline);
    return baseline;
  }

  /**
   * Get user baseline
   */
  getBaseline(userId) {
    return this.userBaselines.get(userId);
  }

  /**
   * Bulk anomaly detection
   */
  bulkDetectAnomalies(transactions, historical = []) {
    return transactions.map(tx => ({
      ...tx,
      anomaly: this.detectAnomaly(tx, historical)
    }));
  }

  /**
   * Get anomaly statistics
   */
  getAnomalyStats(transactions) {
    const anomalyCount = transactions.filter(t => t.anomaly?.isAnomaly).length;
    const avgScore = transactions.reduce((sum, t) => sum + (t.anomaly?.anomalyScore || 0), 0) / transactions.length;

    const bySeverity = {
      Critical: 0,
      High: 0,
      Medium: 0,
      Low: 0
    };

    transactions.forEach(t => {
      const severity = t.anomaly?.severity;
      if (severity) bySeverity[severity]++;
    });

    return {
      totalTransactions: transactions.length,
      anomalousCount: anomalyCount,
      anomalyPercentage: (anomalyCount / transactions.length * 100).toFixed(2) + '%',
      averageAnomalyScore: avgScore.toFixed(2),
      bySeverity,
      timestamp: new Date()
    };
  }
}

// Global instance
const anomalyDetector = new AnomalyDetector();
