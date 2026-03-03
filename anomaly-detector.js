/**
 * Anomaly Detector
 * Identifies unusual expense patterns, trends, and statistical outliers
 */

class AnomalyDetector {
    constructor() {
        this.expenseData = [];
        this.anomalyThreshold = 2.5; // Standard deviations
        this.seasonalPatterns = {};
        
        this.loadData();
    }

    /**
     * Analyze expense for anomalies
     */
    analyze(expense) {
        const anomalies = [];
        let overallRiskScore = 0;

        // Check for amount anomaly
        const amountAnomaly = this.detectAmountAnomaly(expense);
        if (amountAnomaly.isAnomaly) {
            anomalies.push(amountAnomaly);
            overallRiskScore += 30;
        }

        // Check for frequency anomaly
        const frequencyAnomaly = this.detectFrequencyAnomaly(expense);
        if (frequencyAnomaly.isAnomaly) {
            anomalies.push(frequencyAnomaly);
            overallRiskScore += 25;
        }

        // Check for time-based anomaly
        const timeAnomaly = this.detectTimeAnomaly(expense);
        if (timeAnomaly.isAnomaly) {
            anomalies.push(timeAnomaly);
            overallRiskScore += 20;
        }

        // Check for category anomaly
        const categoryAnomaly = this.detectCategoryAnomaly(expense);
        if (categoryAnomaly.isAnomaly) {
            anomalies.push(categoryAnomaly);
            overallRiskScore += 15;
        }

        // Record expense
        this.expenseData.push({
            ...expense,
            recordedAt: new Date().toISOString()
        });

        return {
            riskScore: Math.min(100, overallRiskScore),
            anomalies: anomalies,
            message: anomalies.length > 0 
                ? `Detected ${anomalies.length} anomaly pattern(s)`
                : 'No anomalies detected',
            severity: overallRiskScore > 60 ? 'high' : overallRiskScore > 30 ? 'medium' : 'low',
            details: {
                amountDeviation: amountAnomaly.deviation,
                frequencyDeviation: frequencyAnomaly.deviation,
                zScore: amountAnomaly.zScore
            }
        };
    }

    /**
     * Detect amount anomaly
     */
    detectAmountAnomaly(expense) {
        const categoryExpenses = this.expenseData.filter(e => e.category === expense.category);
        
        if (categoryExpenses.length < 5) {
            return { isAnomaly: false, deviation: 0, zScore: 0 };
        }

        const amounts = categoryExpenses.map(e => parseFloat(e.amount) || 0);
        const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
        const variance = amounts.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / amounts.length;
        const stdDev = Math.sqrt(variance);

        const zScore = stdDev > 0 ? Math.abs((parseFloat(expense.amount) - mean) / stdDev) : 0;
        const deviation = stdDev > 0 ? ((parseFloat(expense.amount) - mean) / mean * 100) : 0;

        return {
            isAnomaly: zScore > this.anomalyThreshold,
            factor: 'Amount Anomaly',
            deviation: Math.round(deviation),
            zScore: Math.round(zScore * 100) / 100,
            message: `Amount deviates ${Math.round(Math.abs(deviation))}% from category average`
        };
    }

    /**
     * Detect frequency anomaly
     */
    detectFrequencyAnomaly(expense) {
        const categoryExpenses = this.expenseData.filter(e => e.category === expense.category);
        const vendor = expense.vendor;
        const vendorExpenses = categoryExpenses.filter(e => e.vendor === vendor);

        if (vendorExpenses.length < 3) {
            return { isAnomaly: false, deviation: 0 };
        }

        // Calculate inter-transaction times
        const dates = vendorExpenses
            .map(e => new Date(e.date || e.timestamp).getTime())
            .sort((a, b) => a - b);

        const intervals = [];
        for (let i = 1; i < dates.length; i++) {
            intervals.push((dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24)); // days
        }

        const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((sum, x) => sum + Math.pow(x - meanInterval, 2), 0) / intervals.length;
        const stdDev = Math.sqrt(variance);

        // Check if current transaction is abnormally frequent
        const lastTransaction = vendorExpenses[vendorExpenses.length - 1];
        const daysSinceLast = (new Date(expense.date || expense.timestamp).getTime() - 
                              new Date(lastTransaction.date || lastTransaction.timestamp).getTime()) / 
                              (1000 * 60 * 60 * 24);

        const zScore = stdDev > 0 ? Math.abs((daysSinceLast - meanInterval) / stdDev) : 0;

        return {
            isAnomaly: zScore > this.anomalyThreshold && daysSinceLast < meanInterval / 2,
            factor: 'Frequency Anomaly',
            deviation: Math.round(daysSinceLast - meanInterval),
            zScore: Math.round(zScore * 100) / 100,
            message: `Unusually frequent transaction with "${vendor}" (${vendorExpenses.length} in ${Math.round(intervals[intervals.length-1])} days)`
        };
    }

    /**
     * Detect time-based anomaly
     */
    detectTimeAnomaly(expense) {
        const expenseDate = new Date(expense.date || expense.timestamp);
        const hour = expenseDate.getHours();
        const dayOfWeek = expenseDate.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        // Track typical transaction times
        const allDates = this.expenseData.map(e => new Date(e.date || e.timestamp));
        const businessHourExpenses = allDates.filter(d => d.getHours() >= 9 && d.getHours() <= 17).length;
        const weekendExpenses = allDates.filter(d => d.getDay() === 0 || d.getDay() === 6).length;

        let isAnomaly = false;
        let reason = '';

        // If mostly business hours and this is not
        if (businessHourExpenses > this.expenseData.length * 0.7 && (hour < 9 || hour > 17)) {
            isAnomaly = true;
            reason = `Unusual time of day (${hour}:00, typically ${Math.round(businessHourExpenses / this.expenseData.length * 100)}% are business hours)`;
        }

        // If mostly weekdays and this is weekend
        const weekdayExpenses = this.expenseData.length - weekendExpenses;
        if (weekdayExpenses > this.expenseData.length * 0.7 && isWeekend) {
            isAnomaly = true;
            reason = 'Unusual day of week (weekend, mostly weekday expenses)';
        }

        return {
            isAnomaly: isAnomaly,
            factor: 'Time Anomaly',
            deviation: 0,
            message: reason
        };
    }

    /**
     * Detect category anomaly
     */
    detectCategoryAnomaly(expense) {
        const previousCategory = this.getPreviousExpenseCategory();
        const categoryChanges = this.detectCategoryShift(expense.category);

        if (!categoryChanges.detected) {
            return { isAnomaly: false, deviation: 0 };
        }

        return {
            isAnomaly: true,
            factor: 'Category Spike',
            deviation: Math.round(categoryChanges.percentageChange),
            message: `${expense.category} expenses up ${Math.round(categoryChanges.percentageChange)}% from baseline`
        };
    }

    /**
     * Detect category spending shift
     */
    detectCategoryShift(category) {
        const categoryExpenses = this.expenseData.filter(e => e.category === category);
        const recentCount = categoryExpenses.filter(e => {
            const date = new Date(e.date || e.timestamp);
            const daysAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
            return daysAgo <= 7;
        }).length;

        const historicalCount = categoryExpenses.filter(e => {
            const date = new Date(e.date || e.timestamp);
            const daysAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
            return daysAgo > 7 && daysAgo <= 30;
        }).length;

        const percentageChange = historicalCount > 0 
            ? ((recentCount - historicalCount) / historicalCount * 100)
            : 0;

        return {
            detected: percentageChange > 100, // 100% increase
            percentageChange: percentageChange
        };
    }

    /**
     * Get previous expense category
     */
    getPreviousExpenseCategory() {
        if (this.expenseData.length === 0) return null;
        return this.expenseData[this.expenseData.length - 1].category;
    }

    /**
     * Analyze time series data
     */
    analyzeTimeSeries(days = 30) {
        const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
        const recentExpenses = this.expenseData.filter(e => {
            const date = new Date(e.date || e.timestamp);
            return date.getTime() > cutoffDate;
        });

        const byDate = {};
        recentExpenses.forEach(expense => {
            const date = new Date(expense.date || expense.timestamp).toDateString();
            byDate[date] = (byDate[date] || 0) + parseFloat(expense.amount || 0);
        });

        return byDate;
    }

    /**
     * Load data from localStorage
     */
    loadData() {
        const saved = localStorage.getItem('anomalyDetectorData');
        if (saved) {
            this.expenseData = JSON.parse(saved);
        }
    }

    /**
     * Save data to localStorage
     */
    saveData() {
        const recentData = this.expenseData.slice(-1000);
        localStorage.setItem('anomalyDetectorData', JSON.stringify(recentData));
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnomalyDetector;
}
