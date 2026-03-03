/**
 * Recommendation Engine - Smart Spending Suggestions
 * Intelligent cost-saving recommendations based on habits
 * Machine learning-driven personalized suggestions
 */

class RecommendationEngine {
  constructor() {
    this.recommendations = [];
    this.userPreferences = new Map();
    this.recommendationHistory = [];
    this.savingsTracker = new Map();
  }

  /**
   * Generate spending recommendations
   * @param {Array} transactions - User transaction history
   * @param {Object} budgets - Current budgets
   * @returns {Array} - Prioritized recommendations
   */
  generateRecommendations(transactions, budgets = {}) {
    const recommendations = [];

    // Analyze each category
    const categoryAnalysis = this.analyzeCategories(transactions);

    // Generate recommendations
    for (const [category, analysis] of categoryAnalysis.entries()) {
      const recs = this.generateCategoryRecommendations(category, analysis, transactions);
      recommendations.push(...recs);
    }

    // Identify subscription opportunities
    recommendations.push(...this.identifySubscriptionSavings(transactions));

    // Coffee/food analysis (specific high-frequency analysis)
    recommendations.push(...this.analyzeCoffeeAndFood(transactions));

    // Duplicate detection recommendations
    recommendations.push(...this.identifyDuplicateCharges(transactions));

    // Sort by estimated savings × likelihood
    recommendations.sort((a, b) => {
      const scoreA = (a.estimatedMonthlySavings || 0) * (a.confidence || 0.5);
      const scoreB = (b.estimatedMonthlySavings || 0) * (b.confidence || 0.5);
      return scoreB - scoreA;
    });

    this.recommendations = recommendations;
    return recommendations.slice(0, 10); // Top 10 recommendations
  }

  /**
   * Analyze spending by category
   */
  analyzeCategories(transactions) {
    const analysis = new Map();

    const grouped = new Map();
    transactions.forEach(tx => {
      const cat = tx.category || 'Uncategorized';
      if (!grouped.has(cat)) {
        grouped.set(cat, []);
      }
      grouped.get(cat).push(tx);
    });

    for (const [category, txs] of grouped.entries()) {
      const amounts = txs.map(t => t.amount);
      const total = amounts.reduce((a, b) => a + b, 0);

      analysis.set(category, {
        transactionCount: txs.length,
        totalSpent: total,
        averageTransaction: total / txs.length,
        maxTransaction: Math.max(...amounts),
        minTransaction: Math.min(...amounts),
        stdDev: Math.sqrt(amounts.reduce((sq, n) => sq + Math.pow(n - (total / txs.length), 2), 0) / txs.length),
        transactions: txs
      });
    }

    return analysis;
  }

  /**
   * Generate category-specific recommendations
   */
  generateCategoryRecommendations(category, analysis, allTransactions) {
    const recommendations = [];

    // Food & Dining
    if (category === 'Food & Dining') {
      if (analysis.totalSpent > 300) {
        const monthlyMeals = analysis.transactionCount;
        const potentialSavings = analysis.totalSpent * 0.3; // 30% savings

        recommendations.push({
          id: 'meal-planning',
          category,
          type: 'MEAL_PLANNING',
          title: 'Try meal planning to reduce restaurant spending',
          description: `You spent $${analysis.totalSpent.toFixed(2)} on food this month (${monthlyMeals} transactions). Meal planning could save ~$${potentialSavings.toFixed(2)}/month.`,
          estimatedMonthlySavings: potentialSavings,
          confidence: 0.85,
          action: 'Switch to meal prep for 50% of your dining',
          difficulty: 'Medium',
          impact: 'High'
        });
      }

      // Expensive coffee detection
      const coffeeSpending = this.calculateCoffeeSpending(analysis.transactions);
      if (coffeeSpending > 100) {
        recommendations.push({
          id: 'coffee-reduction',
          category: 'Food & Dining',
          type: 'COFFEE_REDUCTION',
          title: 'Reduce coffee shop visits',
          description: `You spent $${coffeeSpending.toFixed(2)} on coffee this month. A home coffee maker could save $${(coffeeSpending * 0.8).toFixed(2)}/month.`,
          estimatedMonthlySavings: coffeeSpending * 0.8,
          confidence: 0.9,
          action: 'Buy a home coffee maker (~$30-50)',
          difficulty: 'Easy',
          impact: 'High'
        });
      }
    }

    // Shopping & Retail
    if (category === 'Shopping & Retail') {
      if (analysis.transactionCount > 20) {
        recommendations.push({
          id: 'shopping-frequency',
          category,
          type: 'REDUCE_SHOPPING_FREQUENCY',
          title: 'Consolidate shopping to reduce impulse purchases',
          description: `${analysis.transactionCount} shopping transactions this month suggests frequent impulse buying. Limiting to 2x/week could save ~$${(analysis.totalSpent * 0.2).toFixed(2)}/month.`,
          estimatedMonthlySavings: analysis.totalSpent * 0.2,
          confidence: 0.75,
          action: 'Shop once per week with a list',
          difficulty: 'Medium',
          impact: 'Medium'
        });
      }
    }

    // Entertainment
    if (category === 'Entertainment') {
      if (analysis.totalSpent > 150) {
        recommendations.push({
          id: 'entertainment-optimization',
          category,
          type: 'OPTIMIZE_SUBSCRIPTIONS',
          title: 'Review and optimize entertainment subscriptions',
          description: `High entertainment spending. Review subscriptions and consider free alternatives.`,
          estimatedMonthlySavings: analysis.totalSpent * 0.25,
          confidence: 0.7,
          action: 'Cancel unused streaming services',
          difficulty: 'Easy',
          impact: 'Medium'
        });
      }
    }

    // Transportation
    if (category === 'Transportation') {
      if (analysis.totalSpent > 200) {
        recommendations.push({
          id: 'ride-sharing-optimization',
          category,
          type: 'RIDESHARE_OPTIMIZATION',
          title: 'Consider public transit or carpooling',
          description: `Heavy ride-sharing usage detected ($${analysis.totalSpent.toFixed(2)}). Public transit or carpooling could save ~$${(analysis.totalSpent * 0.4).toFixed(2)}/month.`,
          estimatedMonthlySavings: analysis.totalSpent * 0.4,
          confidence: 0.65,
          action: 'Switch to public transit 50% of the time',
          difficulty: 'Hard',
          impact: 'High'
        });
      }
    }

    return recommendations;
  }

  /**
   * Calculate coffee shop spending
   */
  calculateCoffeeSpending(transactions) {
    const coffeeKeywords = ['coffee', 'cafe', 'starbucks', 'dunkin', 'espresso', 'cappuccino', 'latte'];
    
    return transactions
      .filter(t => coffeeKeywords.some(kw => (t.description?.toLowerCase() || '').includes(kw)))
      .reduce((sum, t) => sum + (t.amount || 0), 0);
  }

  /**
   * Identify subscription savings opportunities
   */
  identifySubscriptionSavings(transactions) {
    const recommendations = [];
    const recurring = new Map();

    // Find recurring charges
    transactions.forEach(tx => {
      const merchant = (tx.merchant || '').toLowerCase();
      if (!recurring.has(merchant)) {
        recurring.set(merchant, []);
      }
      recurring.get(merchant).push(tx);
    });

    // Analyze recurring patterns
    for (const [merchant, txs] of recurring.entries()) {
      if (txs.length < 3) continue; // Need at least 3 to be "recurring"

      const amounts = txs.map(t => t.amount);
      const allSame = amounts.every(a => a === amounts[0]);

      if (allSame && txs.length >= 3) {
        // This is a subscription
        const monthlyAmount = amounts[0];

        // Check for service overlap
        const subscriptions = Array.from(recurring.values()).filter(t => 
          t.length >= 3 && t.every(tx => tx.amount === t[0].amount)
        );

        if (subscriptions.length > 5) {
          recommendations.push({
            id: 'subscription-audit',
            category: 'Subscriptions',
            type: 'SUBSCRIPTION_AUDIT',
            title: `Audit your ${subscriptions.length} active subscriptions`,
            description: `You have ${subscriptions.length} recurring subscriptions. Review for duplicates or unused services.`,
            estimatedMonthlySavings: (subscriptions.length * monthlyAmount * 0.2), // Assume 20% waste
            confidence: 0.7,
            action: 'Review all subscriptions this week',
            difficulty: 'Easy',
            impact: 'Medium'
          });
        }
      }
    }

    return recommendations;
  }

  /**
   * Analyze coffee and food patterns
   */
  analyzeCoffeeAndFood(transactions) {
    const recommendations = [];

    const foodTxs = transactions.filter(t => 
      (t.description?.toLowerCase() || '').includes('food') ||
      (t.category || '').includes('Food')
    );

    if (foodTxs.length > 15) {
      const total = foodTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
      recommendations.push({
        id: 'food-frequency-high',
        category: 'Food & Dining',
        type: 'FOOD_FREQUENCY',
        title: `${foodTxs.length} food transactions this month - high frequency`,
        description: `Averaging $${(total / foodTxs.length).toFixed(2)} per transaction. Consider home cooking more often.`,
        estimatedMonthlySavings: total * 0.25,
        confidence: 0.8,
        action: 'Cook at home 3 more days per week',
        difficulty: 'Medium',
        impact: 'High'
      });
    }

    return recommendations;
  }

  /**
   * Identify duplicate charges
   */
  identifyDuplicateCharges(transactions) {
    const recommendations = [];
    const grouped = new Map();

    transactions.forEach(tx => {
      const key = `${tx.merchant}-${tx.amount}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(tx);
    });

    const duplicates = [];
    for (const [key, txs] of grouped.entries()) {
      if (txs.length > 1) {
        // Check if same-day duplicates
        const dates = txs.map(t => new Date(t.date).toDateString());
        const sameDayDuplicates = txs.filter((_, i) => i > 0 && dates[i] === dates[0]);

        if (sameDayDuplicates.length > 0) {
          duplicates.push({
            merchant: txs[0].merchant,
            amount: txs[0].amount,
            count: sameDayDuplicates.length,
            transactions: sameDayDuplicates
          });
        }
      }
    }

    if (duplicates.length > 0) {
      recommendations.push({
        id: 'duplicate-charges',
        category: 'Billing',
        type: 'DUPLICATE_CHARGES',
        title: `${duplicates.length} potential duplicate charges found`,
        description: 'Review same-day duplicate transactions for erroneous charges.',
        estimatedMonthlySavings: duplicates.reduce((sum, d) => sum + d.amount, 0),
        confidence: 0.9,
        action: 'Contact merchant to dispute duplicate charges',
        difficulty: 'Easy',
        impact: 'High'
      });
    }

    return recommendations;
  }

  /**
   * Get recommendations for a specific category
   */
  getCategoryRecommendations(category) {
    return this.recommendations.filter(r => r.category === category || r.type.includes(category));
  }

  /**
   * Accept recommendation and track savings
   */
  acceptRecommendation(recommendationId) {
    const rec = this.recommendations.find(r => r.id === recommendationId);
    if (rec) {
      this.savingsTracker.set(recommendationId, {
        recommendation: rec,
        acceptedAt: new Date(),
        estimatedSavings: rec.estimatedMonthlySavings,
        status: 'Pending'
      });

      return { success: true, message: `Recommendation '${rec.title}' accepted. Tracking savings...` };
    }

    return { success: false, message: 'Recommendation not found' };
  }

  /**
   * Get total estimated savings
   */
  getTotalEstimatedSavings() {
    return this.recommendations.reduce((sum, r) => sum + (r.estimatedMonthlySavings || 0), 0);
  }

  /**
   * Get savings achieved
   */
  getSavingsAchieved() {
    let totalSavings = 0;
    for (const [_, data] of this.savingsTracker.entries()) {
      if (data.status === 'Completed') {
        totalSavings += data.estimatedSavings;
      }
    }
    return totalSavings;
  }

  /**
   * Get personalized recommendations based on user preferences
   */
  getPersonalized(userId, preferences) {
    this.userPreferences.set(userId, preferences);

    return this.recommendations.map(rec => {
      let adjusted = { ...rec };

      if (preferences.healthConscious && rec.category === 'Food & Dining') {
        adjusted.title = `${adjusted.title} (healthier options)`;
        adjusted.description += ` Consider health-conscious restaurants for better nutrition.`;
      }

      if (preferences.ecoFriendly && rec.category === 'Transportation') {
        adjusted.description += ` This also reduces carbon emissions.`;
      }

      return adjusted;
    });
  }
}

// Global instance
const recommendationEngine = new RecommendationEngine();
