/**
 * Team Analytics Dashboard - Collaborative Spending Analytics
 * 
 * Provides comprehensive analytics for team expenses including spending trends,
 * member contributions, category breakdown, and comparative analysis.
 * 
 * @class TeamAnalyticsDashboard
 * @version 1.0.0
 */

class TeamAnalyticsDashboard {
  constructor() {
    this.analytics = {
      spending: {},
      members: {},
      categories: {},
      trends: {}
    };
  }

  /**
   * Initialize analytics dashboard
   */
  async init(workspaceId, expenses) {
    this.workspaceId = workspaceId;
    this.expenses = expenses || [];
    await this.calculateAnalytics();
    console.log('Team analytics dashboard initialized');
  }

  /**
   * Calculate all analytics
   */
  async calculateAnalytics() {
    this.calculateSpendingStats();
    this.calculateMemberStats();
    this.calculateCategoryBreakdown();
    this.calculateTrends();
  }

  /**
   * Calculate spending statistics
   */
  calculateSpendingStats() {
    const total = this.expenses.reduce((sum, e) => sum + e.amount, 0);
    const count = this.expenses.length;
    const average = count > 0 ? total / count : 0;

    const amounts = this.expenses.map(e => e.amount).sort((a, b) => a - b);
    const median = count > 0 ? amounts[Math.floor(count / 2)] : 0;

    this.analytics.spending = {
      totalAmount: this.round(total),
      totalExpenses: count,
      averageExpense: this.round(average),
      medianExpense: this.round(median),
      highestExpense: count > 0 ? Math.max(...amounts) : 0,
      lowestExpense: count > 0 ? Math.min(...amounts) : 0
    };
  }

  /**
   * Calculate member statistics
   */
  calculateMemberStats() {
    const memberData = new Map();

    this.expenses.forEach(expense => {
      const paidBy = expense.paidBy;
      
      if (!memberData.has(paidBy)) {
        memberData.set(paidBy, {
          userId: paidBy,
          totalPaid: 0,
          totalOwed: 0,
          expenseCount: 0,
          averageExpense: 0
        });
      }

      const data = memberData.get(paidBy);
      data.totalPaid += expense.amount;
      data.expenseCount++;

      // Calculate what this member owes from splits
      if (expense.splits) {
        const memberSplit = expense.splits.find(s => s.userId === paidBy);
        if (memberSplit) {
          data.totalOwed += memberSplit.amount;
        }
      }
    });

    // Calculate averages
    memberData.forEach(data => {
      data.averageExpense = this.round(data.totalPaid / data.expenseCount);
      data.netContribution = this.round(data.totalPaid - data.totalOwed);
    });

    this.analytics.members = Array.from(memberData.values())
      .sort((a, b) => b.totalPaid - a.totalPaid);
  }

  /**
   * Calculate category breakdown
   */
  calculateCategoryBreakdown() {
    const categoryData = new Map();

    this.expenses.forEach(expense => {
      const category = expense.category || 'Uncategorized';
      
      if (!categoryData.has(category)) {
        categoryData.set(category, {
          category,
          totalAmount: 0,
          count: 0,
          percentage: 0
        });
      }

      const data = categoryData.get(category);
      data.totalAmount += expense.amount;
      data.count++;
    });

    // Calculate percentages
    const total = this.analytics.spending.totalAmount;
    categoryData.forEach(data => {
      data.percentage = total > 0 ? this.round((data.totalAmount / total) * 100) : 0;
      data.totalAmount = this.round(data.totalAmount);
    });

    this.analytics.categories = Array.from(categoryData.values())
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }

  /**
   * Calculate spending trends
   */
  calculateTrends() {
    // Group expenses by month
    const monthlyData = new Map();

    this.expenses.forEach(expense => {
      const date = new Date(expense.date || expense.createdAt);
      const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, {
          month: monthKey,
          totalAmount: 0,
          count: 0
        });
      }

      const data = monthlyData.get(monthKey);
      data.totalAmount += expense.amount;
      data.count++;
    });

    // Sort by month
    const sortedMonths = Array.from(monthlyData.values())
      .sort((a, b) => a.month.localeCompare(b.month));

    // Calculate month-over-month growth
    sortedMonths.forEach((month, index) => {
      if (index > 0) {
        const prevMonth = sortedMonths[index - 1];
        const growth = ((month.totalAmount - prevMonth.totalAmount) / prevMonth.totalAmount) * 100;
        month.growth = this.round(growth);
      } else {
        month.growth = 0;
      }
      month.totalAmount = this.round(month.totalAmount);
    });

    this.analytics.trends = sortedMonths;
  }

  /**
   * Get top spenders
   */
  getTopSpenders(limit = 5) {
    return this.analytics.members.slice(0, limit);
  }

  /**
   * Get top categories
   */
  getTopCategories(limit = 5) {
    return this.analytics.categories.slice(0, limit);
  }

  /**
   * Compare member spending
   */
  compareMemberSpending(userId1, userId2) {
    const member1 = this.analytics.members.find(m => m.userId === userId1);
    const member2 = this.analytics.members.find(m => m.userId === userId2);

    if (!member1 || !member2) {
      return null;
    }

    return {
      member1: member1.userId,
      member2: member2.userId,
      totalPaidDiff: this.round(member1.totalPaid - member2.totalPaid),
      expenseCountDiff: member1.expenseCount - member2.expenseCount,
      averageDiff: this.round(member1.averageExpense - member2.averageExpense),
      higher: member1.totalPaid > member2.totalPaid ? member1.userId : member2.userId
    };
  }

  /**
   * Get spending forecast
   */
  getSpendingForecast(monthsAhead = 3) {
    if (this.analytics.trends.length < 2) {
      return [];
    }

    // Simple linear regression forecast
    const recentMonths = this.analytics.trends.slice(-6);
    const avgGrowth = recentMonths.reduce((sum, m) => sum + (m.growth || 0), 0) / recentMonths.length;
    const lastMonth = recentMonths[recentMonths.length - 1];

    const forecast = [];
    let projectedAmount = lastMonth.totalAmount;

    for (let i = 1; i <= monthsAhead; i++) {
      projectedAmount = projectedAmount * (1 + avgGrowth / 100);
      forecast.push({
        month: this.getNextMonth(lastMonth.month, i),
        projectedAmount: this.round(projectedAmount),
        confidence: Math.max(60, 90 - i * 10) // Decreasing confidence
      });
    }

    return forecast;
  }

  /**
   * Get category recommendations
   */
  getCategoryRecommendations() {
    const recommendations = [];

    this.analytics.categories.forEach(cat => {
      if (cat.percentage > 30) {
        recommendations.push({
          category: cat.category,
          type: 'high_spending',
          message: `${cat.category} accounts for ${cat.percentage}% of total spending. Consider reviewing these expenses.`,
          severity: 'warning'
        });
      }
    });

    return recommendations;
  }

  /**
   * Get member insights
   */
  getMemberInsights(userId) {
    const member = this.analytics.members.find(m => m.userId === userId);
    if (!member) return null;

    const avgMemberSpending = this.analytics.members.reduce((sum, m) => sum + m.totalPaid, 0) / this.analytics.members.length;
    const comparison = ((member.totalPaid - avgMemberSpending) / avgMemberSpending) * 100;

    return {
      userId,
      totalPaid: member.totalPaid,
      expenseCount: member.expenseCount,
      averageExpense: member.averageExpense,
      comparisonToTeamAvg: this.round(comparison),
      status: comparison > 20 ? 'above_average' : comparison < -20 ? 'below_average' : 'average'
    };
  }

  /**
   * Export analytics data
   */
  exportData() {
    return {
      workspaceId: this.workspaceId,
      generatedAt: new Date().toISOString(),
      analytics: this.analytics
    };
  }

  /**
   * Get next month string
   */
  getNextMonth(monthStr, offset) {
    const [year, month] = monthStr.split('-').map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
  }

  /**
   * Round number to 2 decimals
   */
  round(num) {
    return Math.round(num * 100) / 100;
  }
}

const teamAnalyticsDashboard = new TeamAnalyticsDashboard();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TeamAnalyticsDashboard;
}
