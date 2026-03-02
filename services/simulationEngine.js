/**
 * Monte Carlo Simulation Engine - Issue #798
 * Core simulation loop for probabilistic cashflow forecasting
 * Runs 10,000+ simulations with variance modeling
 */

const MathSimulation = require('../utils/mathSimulation');
const Expense = require('../models/Expense');
const RecurringExpense = require('../models/RecurringExpense');
const ForecastScenario = require('../models/ForecastScenario');
const mongoose = require('mongoose');

class SimulationEngine {
  constructor() {
    // Default simulation parameters
    this.DEFAULT_ITERATIONS = 10000;
    this.DEFAULT_HORIZON_DAYS = 90;
    this.CONFIDENCE_LEVELS = [10, 25, 50, 75, 90]; // P10, P25, P50, P75, P90
    
    // Economic shock parameters
    this.EXPENSE_SHOCK_PROBABILITY = 0.02; // 2% daily chance of expense shock
    this.EXPENSE_SHOCK_MIN = 100;
    this.EXPENSE_SHOCK_MAX = 2000;
    
    // Income variance parameters
    this.INCOME_VOLATILITY = 0.15; // 15% standard deviation
    this.EXPENSE_VOLATILITY = 0.20; // 20% standard deviation
  }

  /**
   * Run full Monte Carlo simulation
   * @param {string} userId - User/Workspace ID
   * @param {Object} scenario - Optional ForecastScenario with adjustments
   * @param {Object} options - Simulation options
   * @returns {Object} Simulation results with confidence intervals
   */
  async runSimulation(userId, scenario = null, options = {}) {
    const iterations = options.iterations || scenario?.config?.iterationCount || this.DEFAULT_ITERATIONS;
    const horizonDays = options.horizonDays || scenario?.config?.timeHorizonDays || this.DEFAULT_HORIZON_DAYS;
    
    // Gather baseline financial data
    const baseline = await this.gatherBaselineData(userId);
    
    // Apply scenario adjustments
    const adjustedBaseline = this.applyScenarioAdjustments(baseline, scenario);
    
    // Run simulations
    const simulationResults = [];
    const runwayResults = [];
    const finalBalances = [];
    
    for (let i = 0; i < iterations; i++) {
      const path = this.simulateCashflowPath(adjustedBaseline, horizonDays, scenario);
      simulationResults.push(path);
      runwayResults.push(path.runwayDays);
      finalBalances.push(path.finalBalance);
    }
    
    // Calculate confidence intervals
    const confidenceIntervals = this.calculateConfidenceIntervals(
      simulationResults,
      runwayResults,
      finalBalances
    );
    
    // Generate summary statistics
    const summary = this.generateSummary(
      baseline,
      adjustedBaseline,
      confidenceIntervals,
      iterations,
      horizonDays
    );
    
    // Generate fan chart data for visualization
    const fanChart = this.generateFanChartData(simulationResults, horizonDays);
    
    // Generate histogram data
    const histograms = {
      runway: MathSimulation.histogram(runwayResults, 30),
      finalBalance: MathSimulation.histogram(finalBalances, 30)
    };

    return {
      success: true,
      summary,
      confidenceIntervals,
      fanChart,
      histograms,
      metadata: {
        iterations,
        horizonDays,
        scenarioId: scenario?._id || null,
        calculatedAt: new Date(),
        baselineBalance: baseline.currentBalance
      }
    };
  }

  /**
   * Gather baseline financial data for simulation
   */
  async gatherBaselineData(userId) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    // Get current balance
    const balanceData = await Expense.aggregate([
      { $match: { user: userObjectId } },
      {
        $group: {
          _id: null,
          income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
          expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } }
        }
      }
    ]);
    
    const currentBalance = balanceData.length > 0 
      ? (balanceData[0].income - balanceData[0].expense) 
      : 0;

    // Get recurring expenses
    const recurringExpenses = await RecurringExpense.find({
      user: userId,
      isActive: true,
      isPaused: false,
      type: 'expense'
    });

    const monthlyRecurringExpense = recurringExpenses.reduce((total, item) => {
      return total + (item.getMonthlyEstimate ? item.getMonthlyEstimate() : item.amount);
    }, 0);

    // Get recurring income
    const recurringIncome = await RecurringExpense.find({
      user: userId,
      isActive: true,
      isPaused: false,
      type: 'income'
    });

    const monthlyRecurringIncome = recurringIncome.reduce((total, item) => {
      return total + (item.getMonthlyEstimate ? item.getMonthlyEstimate() : item.amount);
    }, 0);

    // Calculate historical variance from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const historicalExpenses = await Expense.aggregate([
      {
        $match: {
          user: userObjectId,
          type: 'expense',
          date: { $gte: ninetyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          dailyTotal: { $sum: '$amount' }
        }
      }
    ]);

    const dailyExpenses = historicalExpenses.map(d => d.dailyTotal);
    const expenseMean = MathSimulation.mean(dailyExpenses) || (monthlyRecurringExpense / 30);
    const expenseStdDev = MathSimulation.stdDev(dailyExpenses) || (expenseMean * this.EXPENSE_VOLATILITY);

    const historicalIncome = await Expense.aggregate([
      {
        $match: {
          user: userObjectId,
          type: 'income',
          date: { $gte: ninetyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          dailyTotal: { $sum: '$amount' }
        }
      }
    ]);

    const dailyIncomes = historicalIncome.map(d => d.dailyTotal);
    const incomeMean = MathSimulation.mean(dailyIncomes) || (monthlyRecurringIncome / 30);
    const incomeStdDev = MathSimulation.stdDev(dailyIncomes) || (incomeMean * this.INCOME_VOLATILITY);

    return {
      currentBalance,
      dailyExpenseMean: expenseMean,
      dailyExpenseStdDev: expenseStdDev,
      dailyIncomeMean: incomeMean,
      dailyIncomeStdDev: incomeStdDev,
      monthlyRecurringExpense,
      monthlyRecurringIncome,
      recurringItems: [...recurringExpenses, ...recurringIncome]
    };
  }

  /**
   * Apply What-If scenario adjustments to baseline
   */
  applyScenarioAdjustments(baseline, scenario) {
    if (!scenario || !scenario.adjustments) {
      return { ...baseline };
    }

    const adjusted = { ...baseline };
    const adj = scenario.adjustments;

    // Apply income change percentage
    if (adj.incomeChangePct) {
      const multiplier = 1 + (adj.incomeChangePct / 100);
      adjusted.dailyIncomeMean *= multiplier;
      adjusted.monthlyRecurringIncome *= multiplier;
    }

    // Apply expense change percentage
    if (adj.expenseChangePct) {
      const multiplier = 1 + (adj.expenseChangePct / 100);
      adjusted.dailyExpenseMean *= multiplier;
      adjusted.monthlyRecurringExpense *= multiplier;
    }

    // Store one-time impacts for simulation
    adjusted.oneTimeImpacts = adj.oneTimeImpacts || [];

    return adjusted;
  }

  /**
   * Simulate a single cashflow path
   */
  simulateCashflowPath(baseline, horizonDays, scenario) {
    let balance = baseline.currentBalance;
    const dailyBalances = [balance];
    let runwayDays = horizonDays;
    let hitZero = false;
    
    const today = new Date();
    
    for (let day = 1; day <= horizonDays; day++) {
      const currentDate = new Date(today);
      currentDate.setDate(currentDate.getDate() + day);
      
      // Generate daily income with variance
      const dailyIncome = Math.max(0, MathSimulation.normalRandom(
        baseline.dailyIncomeMean,
        baseline.dailyIncomeStdDev
      ));
      
      // Generate daily expense with variance
      let dailyExpense = Math.max(0, MathSimulation.normalRandom(
        baseline.dailyExpenseMean,
        baseline.dailyExpenseStdDev
      ));
      
      // Add random expense shock
      dailyExpense += MathSimulation.randomShock(
        this.EXPENSE_SHOCK_PROBABILITY,
        this.EXPENSE_SHOCK_MIN,
        this.EXPENSE_SHOCK_MAX
      );
      
      // Apply one-time impacts from scenario
      if (baseline.oneTimeImpacts) {
        baseline.oneTimeImpacts.forEach(impact => {
          const impactDate = new Date(impact.date);
          if (impactDate.toDateString() === currentDate.toDateString()) {
            if (impact.amount > 0) {
              dailyIncome += impact.amount;
            } else {
              dailyExpense += Math.abs(impact.amount);
            }
          }
        });
      }
      
      // Update balance
      balance += dailyIncome - dailyExpense;
      dailyBalances.push(balance);
      
      // Check for runway exhaustion
      if (balance <= 0 && !hitZero) {
        runwayDays = day;
        hitZero = true;
      }
    }
    
    return {
      dailyBalances,
      finalBalance: balance,
      runwayDays: hitZero ? runwayDays : horizonDays,
      hitZero,
      minBalance: Math.min(...dailyBalances),
      maxBalance: Math.max(...dailyBalances)
    };
  }

  /**
   * Calculate confidence intervals from simulation results
   */
  calculateConfidenceIntervals(results, runwayResults, finalBalances) {
    const sortedRunway = [...runwayResults].sort((a, b) => a - b);
    const sortedFinal = [...finalBalances].sort((a, b) => a - b);
    
    const intervals = {};
    
    this.CONFIDENCE_LEVELS.forEach(p => {
      intervals[`P${p}`] = {
        runway: Math.round(MathSimulation.percentile(sortedRunway, p)),
        finalBalance: Math.round(MathSimulation.percentile(sortedFinal, p) * 100) / 100
      };
    });
    
    // Calculate additional risk metrics
    intervals.mean = {
      runway: Math.round(MathSimulation.mean(runwayResults)),
      finalBalance: Math.round(MathSimulation.mean(finalBalances) * 100) / 100
    };
    
    intervals.stdDev = {
      runway: Math.round(MathSimulation.stdDev(runwayResults) * 10) / 10,
      finalBalance: Math.round(MathSimulation.stdDev(finalBalances) * 100) / 100
    };
    
    // Probability of runway exhaustion
    const exhaustionCount = runwayResults.filter(r => r < 90).length;
    intervals.exhaustionProbability = Math.round((exhaustionCount / runwayResults.length) * 10000) / 100;
    
    // Value at Risk (5% worst case)
    intervals.VaR95 = {
      runway: MathSimulation.valueAtRisk(runwayResults, 95),
      finalBalance: Math.round(MathSimulation.valueAtRisk(finalBalances, 95) * 100) / 100
    };
    
    // Conditional VaR (Expected Shortfall)
    intervals.CVaR95 = {
      runway: Math.round(MathSimulation.conditionalVaR(runwayResults, 95)),
      finalBalance: Math.round(MathSimulation.conditionalVaR(finalBalances, 95) * 100) / 100
    };

    return intervals;
  }

  /**
   * Generate summary statistics
   */
  generateSummary(baseline, adjusted, intervals, iterations, horizonDays) {
    const netDailyBurn = adjusted.dailyExpenseMean - adjusted.dailyIncomeMean;
    
    return {
      currentBalance: Math.round(baseline.currentBalance * 100) / 100,
      
      burnRate: {
        daily: Math.round(netDailyBurn * 100) / 100,
        weekly: Math.round(netDailyBurn * 7 * 100) / 100,
        monthly: Math.round(netDailyBurn * 30 * 100) / 100
      },
      
      runway: {
        pessimistic: intervals.P10.runway, // 10th percentile (worst case)
        likely: intervals.P50.runway,       // 50th percentile (median)
        optimistic: intervals.P90.runway,   // 90th percentile (best case)
        mean: intervals.mean.runway,
        uncertainty: intervals.stdDev.runway
      },
      
      endBalance: {
        pessimistic: intervals.P10.finalBalance,
        likely: intervals.P50.finalBalance,
        optimistic: intervals.P90.finalBalance,
        mean: intervals.mean.finalBalance
      },
      
      riskMetrics: {
        exhaustionProbability: intervals.exhaustionProbability,
        valueAtRisk: intervals.VaR95.finalBalance,
        expectedShortfall: intervals.CVaR95.finalBalance
      },
      
      simulationParams: {
        iterations,
        horizonDays,
        expenseVolatility: Math.round((adjusted.dailyExpenseStdDev / adjusted.dailyExpenseMean) * 100) || 0,
        incomeVolatility: Math.round((adjusted.dailyIncomeStdDev / adjusted.dailyIncomeMean) * 100) || 0
      }
    };
  }

  /**
   * Generate fan chart data for visualization
   * Returns percentile bands for each day
   */
  generateFanChartData(results, horizonDays) {
    const fanChart = [];
    
    for (let day = 0; day <= horizonDays; day++) {
      const balancesAtDay = results.map(r => r.dailyBalances[day] || 0);
      const sorted = [...balancesAtDay].sort((a, b) => a - b);
      
      fanChart.push({
        day,
        P10: Math.round(MathSimulation.percentile(sorted, 10) * 100) / 100,
        P25: Math.round(MathSimulation.percentile(sorted, 25) * 100) / 100,
        P50: Math.round(MathSimulation.percentile(sorted, 50) * 100) / 100,
        P75: Math.round(MathSimulation.percentile(sorted, 75) * 100) / 100,
        P90: Math.round(MathSimulation.percentile(sorted, 90) * 100) / 100,
        mean: Math.round(MathSimulation.mean(balancesAtDay) * 100) / 100
      });
    }
    
    return fanChart;
  }

  /**
   * Quick simulation for real-time alerts
   * Uses fewer iterations for speed
   */
  async quickSimulation(userId, iterations = 1000) {
    return this.runSimulation(userId, null, { iterations, horizonDays: 30 });
  }

  /**
   * Run stress test with extreme scenarios
   */
  async runStressTest(userId) {
    const scenarios = [
      { name: 'Income Loss 50%', adjustments: { incomeChangePct: -50 } },
      { name: 'Expense Spike 30%', adjustments: { expenseChangePct: 30 } },
      { name: 'Both: -30% Income, +20% Expense', adjustments: { incomeChangePct: -30, expenseChangePct: 20 } }
    ];
    
    const results = [];
    
    for (const scenario of scenarios) {
      const mockScenario = { adjustments: scenario.adjustments, config: { iterationCount: 5000, timeHorizonDays: 90 } };
      const result = await this.runSimulation(userId, mockScenario, { iterations: 5000 });
      results.push({
        scenario: scenario.name,
        ...result.summary
      });
    }
    
    return results;
  }
}

module.exports = new SimulationEngine();
