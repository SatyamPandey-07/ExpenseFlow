/**
 * Budget Forecaster - Predictive Analytics Engine
 * AI-generated budget projections using historical data
 * Monthly/yearly forecasting with confidence intervals
 */

class BudgetForecaster {
  constructor() {
    this.forecastHistory = [];
    this.accumulationModels = new Map();
  }

  /**
   * Generate monthly budget forecast
   * @param {Array} transactions - Historical transactions  
   * @param {Object} currentBudgets - Current budget limits by category
   * @returns {Object} - Forecast with recommendations
   */
  generateMonthlyForecast(transactions, currentBudgets = null) {
    const categoryData = this.groupByCategory(transactions);
    const forecast = {};
    const recommendations = [];

    for (const [category, txs] of categoryData.entries()) {
      const prediction = this.predictCategorySpending(txs);

      forecast[category] = {
        predicted: prediction.value,
        confidence: (prediction.confidence * 100).toFixed(0) + '%',
        range: {
          low: prediction.low.toFixed(2),
          high: prediction.high.toFixed(2)
        },
        trend: prediction.trend,
        variance: prediction.variance.toFixed(2)
      };

      // Generate recommendation
      if (currentBudgets && currentBudgets[category]) {
        const currentBudget = currentBudgets[category];
        const predicted = prediction.value;
        
        if (predicted > currentBudget * 1.1) {
          recommendations.push({
            category,
            type: 'INCREASE_BUDGET',
            suggested: Math.ceil(predicted * 1.05),
            reason: `Recent trend shows ${((predicted - currentBudget) / currentBudget * 100).toFixed(0)}% overage`
          });
        } else if (predicted < currentBudget * 0.7) {
          recommendations.push({
            category,
            type: 'DECREASE_BUDGET',
            suggested: Math.floor(predicted * 0.95),
            reason: `Underspending ${((currentBudget - predicted) / currentBudget * 100).toFixed(0)}% vs budget`
          });
        }
      }
    }

    return {
      forecast,
      recommendations,
      totalPredicted: Object.values(forecast).reduce((sum, cat) => sum + parseFloat(cat.predicted), 0).toFixed(2),
      generatedAt: new Date()
    };
  }

  /**
   * Predict category spending using multiple models
   */
  predictCategorySpending(transactions) {
    if (transactions.length === 0) {
      return { value: 0, confidence: 0, low: 0, high: 0, trend: 'Unknown', variance: 0 };
    }

    // Get monthly amounts
    const monthlyAmounts = new Map();
    transactions.forEach(tx => {
      const monthKey = new Date(tx.date).toISOString().slice(0, 7);
      monthlyAmounts.set(monthKey, (monthlyAmounts.get(monthKey) || 0) + (tx.amount || 0));
    });

    const amounts = Array.from(monthlyAmounts.values());

    if (amounts.length === 1) {
      return {
        value: amounts[0],
        confidence: 0.3,
        low: amounts[0] * 0.7,
        high: amounts[0] * 1.3,
        trend: 'Insufficient data',
        variance: 0
      };
    }

    // Calculate statistics
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);

    // Use weighted average (recent months weight more)
    const weights = amounts.map((_, i) => (i + 1) / amounts.length);
    const weighted = amounts.reduce((sum, val, i) => sum + val * weights[i], 0) / weights.reduce((a, b) => a + b, 0);

    // Linear regression for trend
    const {slope} = this.linearRegression(amounts);
    const trend = slope > mean * 0.05 ? 'Increasing' : slope < -mean * 0.05 ? 'Decreasing' : 'Stable';

    // Confidence based on consistency
    const consistency = 1 - (stdDev / mean);
    const confidence = Math.max(0.3, Math.min(0.95, consistency));

    const prediction = weighted * (1 + slope / 1000); // Apply trend
    const margin = stdDev * 1.96; // 95% confidence interval

    return {
      value: prediction,
      confidence,
      low: Math.max(0, prediction - margin),
      high: prediction + margin,
      trend,
      variance: stdDev,
      methodsUsed: ['weighted_average', 'linear_regression', 'variance_analysis']
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
   * Group transactions by category
   */
  groupByCategory(transactions) {
    const grouped = new Map();
    transactions.forEach(tx => {
      const category = tx.category || 'Uncategorized';
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category).push(tx);
    });
    return grouped;
  }

  /**
   * Generate annual forecast
   */
  generateAnnualForecast(transactions, monthlyBudgets) {
    const monthly = this.generateMonthlyForecast(transactions, monthlyBudgets);
    const categoryAmounts = new Map();

    // Sum monthly predictions
    Object.entries(monthly.forecast).forEach(([category, data]) => {
      categoryAmounts.set(category, parseFloat(data.predicted) * 12);
    });

    const annualForecast = {};
    let totalAnnual = 0;

    for (const [category, amount] of categoryAmounts.entries()) {
      annualForecast[category] = amount.toFixed(2);
      totalAnnual += amount;
    }

    return {
      annualForecast,
      totalAnnual: totalAnnual.toFixed(2),
      monthlyAverage: (totalAnnual / 12).toFixed(2),
      carbonFootprint: this.estimateCarbonFootprint(annualForecast), // Optional: environmental impact
      generatedAt: new Date()
    };
  }

  /**
   * Estimate carbon footprint based on spending
   */
  estimateCarbonFootprint(forecast) {
    // Simplified carbon calculation (kg CO2 per category)
    const carbonFactors = {
      'Transportation': 0.21,
      'Food & Dining': 0.003,
      'Shopping & Retail': 0.002,
      'Travel': 0.15,
      'Home & Garden': 0.001,
      'Default': 0.001
    };

    let totalCarbon = 0;
    Object.entries(forecast).forEach(([category, amount]) => {
      const factor = carbonFactors[category] || carbonFactors.Default;
      totalCarbon += parseFloat(amount) * factor;
    });

    return {
      estimatedKgCO2: totalCarbon.toFixed(2),
      equivalentMiles: (totalCarbon / 0.41).toFixed(0), // Average car: 0.41 kg CO2 per mile
      equivalentTrees: (totalCarbon / 20).toFixed(0) // Average tree absorbs 20kg CO2/year
    };
  }

  /**
   * What-if analysis: simulate budget changes
   */
  simulateBudgetChanges(transactions, baselineBudgets, changeScenarios) {
    const results = [];

    changeScenarios.forEach(scenario => {
      const scenarioName = scenario.name;
      const adjustedBudgets = { ...baselineBudgets };

      // Apply scenario modifications
      if (scenario.changes) {
        Object.entries(scenario.changes).forEach(([category, change]) => {
          adjustedBudgets[category] = baselineBudgets[category] * (1 + change / 100);
        });
      }

      // Calculate impact
      const impact = this.calculateBudgetImpact(transactions, adjustedBudgets);

      results.push({
        scenarioName,
        adjustedBudgets,
        ...impact
      });
    });

    return results;
  }

  /**
   * Calculate impact of budget changes
   */
  calculateBudgetImpact(transactions, budgets) {
    const categoryData = this.groupByCategory(transactions);
    let totalUnexpendedCapacity = 0;
    let overallCompliance = 0;
    const violations = [];

    for (const [category, budget] of Object.entries(budgets)) {
      const categoryTxs = categoryData.get(category) || [];
      const categoryTotal = categoryTxs.reduce((sum, t) => sum + (t.amount || 0), 0);

      const compliant = categoryTotal <= budget ? 'Yes' : 'No';
      const variance = ((categoryTotal - budget) / budget * 100).toFixed(2);

      if (compliant === 'No') {
        violations.push({ category, amount: categoryTotal, budget, excess: categoryTotal - budget });
        overallCompliance += 0;
      } else {
        overallCompliance += (budget - categoryTotal) / budget;
        totalUnexpendedCapacity += budget - categoryTotal;
      }
    }

    return {
      totalBudget: Object.values(budgets).reduce((a, b) => a + b, 0),
      totalSpent: transactions.reduce((sum, t) => sum + (t.amount || 0), 0),
      unexpendedCapacity: totalUnexpendedCapacity.toFixed(2),
      budgetComplianceScore: ((overallCompliance / Object.keys(budgets).length) * 100).toFixed(0) + '%',
      violations: violations
    };
  }

  /**
   * Get smart spending insights
   */
  getSmartInsights(transactions, budgets) {
    const insights = [];
    const categoryData = this.groupByCategory(transactions);

    for (const [category, txs] of categoryData.entries()) {
      if (txs.length === 0) continue;

      const categoryTotal = txs.reduce((sum, t) => sum + (t.amount || 0), 0);
      const avgTransaction = categoryTotal / txs.length;
      const budget = budgets[category] || 0;

      // Generate insights
      if (avgTransaction > 100 && txs.length > 5) {
        insights.push({
          type: 'HIGH_VALUE_TRANSACTIONS',
          category,
          insight: `${txs.length} purchases averaging $${avgTransaction.toFixed(2)} - consider if necessary`,
          impact: 'HIGH'
        });
      }

      if (categoryTotal > budget * 1.2 && txs.length > 10) {
        insights.push({
          type: 'OVERSPENDING',
          category,
          insight: `${((categoryTotal / budget - 1) * 100).toFixed(0)}% over budget - set spending limits`,
          impact: 'HIGH'
        });
      }

      // Detect new spending
      const recentTxLast7 = txs.filter(t => {
        const diff = (Date.now() - new Date(t.date).getTime()) / (1000 * 60 * 60 * 24);
        return diff < 7;
      });

      if (recentTxLast7.length > 0 && txs.length < 3) {
        insights.push({
          type: 'NEW_SPENDING_CATEGORY',
          category,
          insight: `New spending detected in ${category}`,
          impact: 'MEDIUM'
        });
      }
    }

    return insights.sort((a, b) => {
      const impactMap = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
      return impactMap[b.impact] - impactMap[a.impact];
    });
  }
}

// Global instance
const budgetForecaster = new BudgetForecaster();
