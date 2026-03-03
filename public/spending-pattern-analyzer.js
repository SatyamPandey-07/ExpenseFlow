/**
 * Spending Pattern Analyzer - Advanced Pattern Recognition
 * Identifies cyclical expenses, recurring charges, subscriptions
 * Analyzes trends, seasonality, and behavioral patterns
 */

class SpendingPatternAnalyzer {
  constructor() {
    this.patterns = new Map(); // patternId → pattern data
    this.recurringExpenses = [];
    this.subscriptions = [];
  }

  /**
   * Analyze spending patterns in transaction history
   * @param {Array} transactions - Historical transactions
   * @returns {Object} - Complete pattern analysis
   */
  analyzePatterns(transactions) {
    const sorted = transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

    return {
      recurring: this.detectRecurringExpenses(sorted),
      subscriptions: this.detectSubscriptions(sorted),
      cyclical: this.detectCyclicalPatterns(sorted),
      trends: this.analyzeTrends(sorted),
      seasonality: this.analyzeSeasonality(sorted),
      categoryPatterns: this.analyzeCategoryPatterns(sorted),
      dayOfWeekPatterns: this.analyzeDayOfWeekPatterns(sorted),
      timestamp: new Date()
    };
  }

  /**
   * Detect recurring expenses (monthly, weekly, daily)
   */
  detectRecurringExpenses(transactions) {
    const recurringMap = new Map(); // merchant → dates

    transactions.forEach(tx => {
      const merchant = tx.merchant?.toLowerCase() || 'unknown';
      if (!recurringMap.has(merchant)) {
        recurringMap.set(merchant, []);
      }
      recurringMap.get(merchant).push(new Date(tx.date));
    });

    const recurring = [];

    for (const [merchant, dates] of recurringMap.entries()) {
      if (dates.length < 2) continue;

      // Calculate intervals
      const intervals = [];
      for (let i = 1; i < dates.length; i++) {
        const diff = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24); // days
        intervals.push(diff);
      }

      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sq, n) => sq + Math.pow(n - avgInterval, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      const regularity = Math.max(0, 1 - (stdDev / avgInterval)); // 0-1, higher = more regular

      let frequency = 'Irregular';
      if (regularity > 0.7) {
        if (avgInterval <= 1.5) frequency = 'Daily';
        else if (avgInterval <= 7.5) frequency = 'Weekly';
        else if (avgInterval <= 31) frequency = 'Monthly';
        else if (avgInterval <= 93) frequency = 'Quarterly';
        else frequency = 'Yearly';
      }

      const relatedTransactions = transactions.filter(t => t.merchant?.toLowerCase() === merchant);
      const avgAmount = relatedTransactions.reduce((sum, t) => sum + t.amount, 0) / relatedTransactions.length;

      recurring.push({
        merchant,
        frequency,
        interval: avgInterval.toFixed(1) + ' days',
        regularity: (regularity * 100).toFixed(0) + '%',
        averageAmount: avgAmount.toFixed(2),
        transactionCount: dates.length,
        nextExpectedDate: new Date(dates[dates.length - 1].getTime() + avgInterval * 24 * 60 * 60 * 1000),
        dates: dates
      });
    }

    return recurring.sort((a, b) => parseInt(b.frequency) - parseInt(a.frequency));
  }

  /**
   * Detect subscription services
   */
  detectSubscriptions(transactions) {
    const subscriptionKeywords = ['subscription', 'monthly', 'annual', 'membership', 'premium', 'plan', 'service', 'recurring'];
    const subscriptions = [];

    const merchantSubs = new Map();

    transactions.forEach(tx => {
      const isSubscription = subscriptionKeywords.some(kw => 
        (tx.description?.toLowerCase() || '').includes(kw) ||
        (tx.merchant?.toLowerCase() || '').includes(kw)
      );

      if (isSubscription) {
        const merchant = tx.merchant?.toLowerCase() || tx.description;
        if (!merchantSubs.has(merchant)) {
          merchantSubs.set(merchant, []);
        }
        merchantSubs.get(merchant).push(tx);
      }
    });

    for (const [merchant, subs] of merchantSubs.entries()) {
      const recurringData = this.detectRecurringExpenses(subs);
      if (recurringData.length > 0) {
        subscriptions.push({
          provider: merchant,
          transactions: subs.length,
          monthlyEstimate: (recurringData[0].interval === 'Monthly' 
            ? parseFloat(recurringData[0].averageAmount) 
            : parseFloat(recurringData[0].averageAmount) * 365 / 30),
          frequency: recurringData[0].frequency,
          status: 'Active',
          cancellationRisk: this.calculateCancellationRisk(subs)
        });
      }
    }

    return subscriptions.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
  }

  /**
   * Detect cyclical spending patterns
   */
  detectCyclicalPatterns(transactions) {
    const monthlyAmounts = new Map(); // month → total spending

    transactions.forEach(tx => {
      const date = new Date(tx.date);
      const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
      monthlyAmounts.set(monthKey, (monthlyAmounts.get(monthKey) || 0) + (tx.amount || 0));
    });

    const amounts = Array.from(monthlyAmounts.values());
    if (amounts.length < 3) return null;

    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const peaks = amounts.filter(a => a > avg * 1.2);
    const valleys = amounts.filter(a => a < avg * 0.8);

    return {
      average: avg.toFixed(2),
      peaks: peaks.length,
      valleys: valleys.length,
      cyclicalScore: (Math.max(...amounts) - Math.min(...amounts)) / avg,
      pattern: this.identifyCyclicalPattern(amounts)
    };
  }

  /**
   * Identify cyclical pattern (e.g., bi-weekly, quarterly)
   */
  identifyCyclicalPattern(amounts) {
    // Simple pattern detection using peak spacing
    if (amounts.length < 4) return 'Insufficient data';

    const peaks = [];
    for (let i = 1; i < amounts.length - 1; i++) {
      if (amounts[i] > amounts[i - 1] && amounts[i] > amounts[i + 1]) {
        peaks.push(i);
      }
    }

    if (peaks.length < 2) return 'No clear pattern';

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i] - peaks[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    if (avgInterval < 1.5) return 'Monthly';
    if (avgInterval < 3.5) return 'Bi-monthly';
    if (avgInterval < 5.5) return 'Quarterly';
    return 'Irregular';
  }

  /**
   * Analyze spending trends
   */
  analyzeTrends(transactions) {
    const monthlyData = new Map();

    transactions.forEach(tx => {
      const date = new Date(tx.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyData.set(monthKey, (monthlyData.get(monthKey) || 0) + (tx.amount || 0));
    });

    const amounts = Array.from(monthlyData.values());
    if (amounts.length < 2) return null;

    // Calculate trend using linear regression
    const {slope, intercept} = this.linearRegression(amounts);
    const trend = slope > 50 ? 'Increasing' : slope < -50 ? 'Decreasing' : 'Stable';

    return {
      trend,
      slope: slope.toFixed(2),
      monthOverMonthChange: ((amounts[amounts.length - 1] - amounts[amounts.length - 2]) / amounts[amounts.length - 2] * 100).toFixed(2) + '%',
      projectedAnnual: (amounts[amounts.length - 1] * 12).toFixed(2)
    };
  }

  /**
   * Linear regression helper
   */
  linearRegression(values) {
    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  /**
   * Analyze seasonality
   */
  analyzeSeasonality(transactions) {
    const seasonalData = {
      Q1: 0, Q2: 0, Q3: 0, Q4: 0,
      months: {}
    };

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    monthNames.forEach(m => seasonalData.months[m] = 0);

    transactions.forEach(tx => {
      const date = new Date(tx.date);
      const month = date.getMonth();
      const quarter = Math.floor(month / 3) + 1;
      const monthName = monthNames[month];

      seasonalData[`Q${quarter}`] += tx.amount || 0;
      seasonalData.months[monthName] += tx.amount || 0;
    });

    const maxSeason = Math.max(seasonalData.Q1, seasonalData.Q2, seasonalData.Q3, seasonalData.Q4);
    const minSeason = Math.min(seasonalData.Q1, seasonalData.Q2, seasonalData.Q3, seasonalData.Q4);

    return {
      byQuarter: {
        Q1: seasonalData.Q1.toFixed(2),
        Q2: seasonalData.Q2.toFixed(2),
        Q3: seasonalData.Q3.toFixed(2),
        Q4: seasonalData.Q4.toFixed(2)
      },
      peakQuarter: Object.keys(seasonalData).filter(k => seasonalData[k] === maxSeason)[0],
      lowQuarter: Object.keys(seasonalData).filter(k => seasonalData[k] === minSeason)[0],
      byMonth: Object.fromEntries(Object.entries(seasonalData.months).map(([k, v]) => [k, v.toFixed(2)]))
    };
  }

  /**
   * Analyze category-level patterns
   */
  analyzeCategoryPatterns(transactions) {
    const categories = new Map();

    transactions.forEach(tx => {
      if (!categories.has(tx.category)) {
        categories.set(tx.category, []);
      }
      categories.get(tx.category).push(tx);
    });

    const patterns = [];

    for (const [category, txs] of categories.entries()) {
      const amounts = txs.map(t => t.amount);
      const monthlySpend = new Map();

      txs.forEach(tx => {
        const monthKey = new Date(tx.date).toISOString().slice(0, 7);
        monthlySpend.set(monthKey, (monthlySpend.get(monthKey) || 0) + tx.amount);
      });

      patterns.push({
        category,
        transactionCount: txs.length,
        totalSpent: amounts.reduce((a, b) => a + b, 0).toFixed(2),
        averageTransaction: (amounts.reduce((a, b) => a + b, 0) / amounts.length).toFixed(2),
        trend: this.analyzeTrends(txs)?.trend || 'Unknown'
      });
    }

    return patterns.sort((a, b) => parseFloat(b.totalSpent) - parseFloat(a.totalSpent));
  }

  /**
   * Analyze day of week patterns
   */
  analyzeDayOfWeekPatterns(transactions) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayData = Object.fromEntries(days.map(d => [d, { count: 0, total: 0 }]));

    transactions.forEach(tx => {
      const dayIndex = new Date(tx.date).getDay();
      const dayName = days[dayIndex];
      dayData[dayName].count++;
      dayData[dayName].total += tx.amount || 0;
    });

    return Object.fromEntries(
      Object.entries(dayData).map(([day, data]) => [
        day,
        {
          transactions: data.count,
          totalSpent: data.total.toFixed(2),
          average: (data.total / Math.max(data.count, 1)).toFixed(2)
        }
      ])
    );
  }

  /**
   * Calculate cancellation risk for subscriptions
   */
  calculateCancellationRisk(transactions) {
    // Analyze usage patterns to determine if subscription might be cancelled
    const lastMonth = transactions.filter(t => {
      const diff = (Date.now() - new Date(t.date).getTime()) / (1000 * 60 * 60 * 24);
      return diff < 30;
    });

    if (lastMonth.length === 0) return 'High'; // No recent usage
    if (lastMonth.length === 1) return 'Medium'; // Minimal usage
    return 'Low'; // Regular usage
  }

  /**
   * Get spending forecast
   */
  getSpendingForecast(transactions, months = 3) {
    const monthlyAmounts = new Map();

    transactions.forEach(tx => {
      const monthKey = new Date(tx.date).toISOString().slice(0, 7);
      monthlyAmounts.set(monthKey, (monthlyAmounts.get(monthKey) || 0) + (tx.amount || 0));
    });

    const amounts = Array.from(monthlyAmounts.values());
    if (amounts.length === 0) return [];

    const {slope} = this.linearRegression(amounts);
    const lastAmount = amounts[amounts.length - 1];
    const forecast = [];

    for (let i = 1; i <= months; i++) {
      forecast.push({
        month: i,
        projected: (lastAmount + slope * i).toFixed(2)
      });
    }

    return forecast;
  }
}

// Global instance
const spendingPatternAnalyzer = new SpendingPatternAnalyzer();
