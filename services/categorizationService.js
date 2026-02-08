let brain;
try {
  brain = require('brain.js');
} catch (error) {
  console.log('Brain.js not available, using enhanced rule-based categorization');
  brain = null;
}

const CategoryPattern = require('../models/CategoryPattern');
const CategoryTraining = require('../models/CategoryTraining');

class CategorizationService {
  constructor() {
    this.networks = new Map(); // Store trained networks per user
    this.categories = ['food', 'transport', 'entertainment', 'utilities', 'healthcare', 'shopping', 'other'];
    this.categoryMap = {
      0: 'food',
      1: 'transport',
      2: 'entertainment',
      3: 'utilities',
      4: 'healthcare',
      5: 'shopping',
      6: 'other'
    };
    this.brainAvailable = brain !== null;
  }

  // Legacy method for backward compatibility
  categorize(description) {
    const categories = {
      'food': ['restaurant', 'grocery', 'cafe', 'food', 'dining'],
      'transport': ['uber', 'taxi', 'bus', 'train', 'gas', 'fuel', 'parking'],
      'shopping': ['amazon', 'store', 'mall', 'retail', 'clothing'],
      'entertainment': ['movie', 'theater', 'game', 'music', 'event'],
      'utilities': ['electric', 'water', 'gas', 'internet', 'phone', 'utility'],
      'healthcare': ['doctor', 'pharmacy', 'hospital', 'medical', 'dental'],
      'other': []
    };

    const desc = description.toLowerCase();
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => desc.includes(keyword))) {
        return category;
      }
    }
    return 'other';
  }

  // Convert text to numerical features for ML
  textToFeatures(description, amount = 0) {
    const words = description.toLowerCase().split(/\s+/);
    const features = new Array(50).fill(0); // 50 features

    // Simple bag-of-words features (first 40 positions)
    words.slice(0, 40).forEach((word, index) => {
      if (index < 40) {
        // Simple hash function to convert word to number
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
          hash = ((hash << 5) - hash) + word.charCodeAt(i);
          hash = hash & hash; // Convert to 32-bit integer
        }
        features[index] = (Math.abs(hash) % 1000) / 1000; // Normalize to 0-1
      }
    });

    // Amount features (positions 40-49)
    if (amount > 0) {
      features[40] = Math.log10(amount + 1) / 10; // Log scaled amount
      features[41] = (amount % 100) / 100; // Last two digits
      features[42] = Math.floor(amount / 100) % 10 / 10; // Hundreds digit
      features[43] = Math.floor(amount / 1000) % 10 / 10; // Thousands digit
      features[44] = amount > 100 ? 1 : 0; // Over 100
      features[45] = amount > 1000 ? 1 : 0; // Over 1000
      features[46] = amount < 10 ? 1 : 0; // Under 10
      features[47] = amount < 50 ? 1 : 0; // Under 50
    }

    return features;
  }

  // Train ML model for a user
  async trainModel(userId) {
    try {
      // Get training data
      const trainingData = await CategoryTraining.getTrainingData(userId, 5000);

      if (trainingData.length < 10) {
        console.log(`Not enough training data for user ${userId}`);
        return false;
      }

      // Prepare training set
      const trainingSet = trainingData.map(item => {
        const input = this.textToFeatures(item.description, item.amount);
        const output = new Array(7).fill(0);
        const categoryIndex = this.categories.indexOf(item.category);
        if (categoryIndex >= 0) {
          output[categoryIndex] = 1;
        }
        return { input, output };
      });

      // Create and train network
      const net = new brain.NeuralNetwork({
        hiddenLayers: [20, 10],
        activation: 'sigmoid'
      });

      console.log(`Training ML model for user ${userId} with ${trainingSet.length} samples`);
      net.train(trainingSet, {
        iterations: 2000,
        errorThresh: 0.005,
        log: false
      });

      // Store trained network
      this.networks.set(userId.toString(), net);

      console.log(`ML model trained successfully for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error training ML model:', error);
      return false;
    }
  }

  // Predict category using ML model
  async predictCategory(userId, description, amount = 0) {
    const userKey = userId.toString();

    // Check if we have a trained model
    if (!this.networks.has(userKey)) {
      // Try to load or train model
      await this.trainModel(userId);
    }

    const net = this.networks.get(userKey);
    if (!net) {
      // Fallback to rule-based categorization
      return {
        category: this.categorize(description),
        confidence: 0.5,
        method: 'rule-based'
      };
    }

    try {
      const input = this.textToFeatures(description, amount);
      const output = net.run(input);

      // Find the category with highest probability
      let maxProb = 0;
      let predictedIndex = 6; // default to 'other'

      output.forEach((prob, index) => {
        if (prob > maxProb) {
          maxProb = prob;
          predictedIndex = index;
        }
      });

      return {
        category: this.categoryMap[predictedIndex],
        confidence: maxProb,
        method: 'ml'
      };
    } catch (error) {
      console.error('Error predicting category:', error);
      return {
        category: this.categorize(description),
        confidence: 0.5,
        method: 'rule-based-fallback'
      };
    }
  }

  // Suggest category with ML and fallback to patterns
  async suggestCategory(userId, description, amount = 0) {
    try {
      // First try ML prediction
      const mlResult = await this.predictCategory(userId, description, amount);

      // Get patterns for additional suggestions
      const patterns = await CategoryPattern.findPatternsForDescription(userId, description);

      const suggestions = [{
        category: mlResult.category,
        confidence: mlResult.confidence,
        method: mlResult.method
      }];

      // Add pattern-based suggestions
      patterns.slice(0, 2).forEach(pattern => {
        if (pattern.category !== mlResult.category) {
          suggestions.push({
            category: pattern.category,
            confidence: pattern.confidence * 0.8, // Slightly lower confidence
            method: 'pattern'
          });
        }
      });

      // Sort by confidence
      suggestions.sort((a, b) => b.confidence - a.confidence);

      return suggestions;
    } catch (error) {
      console.error('Error suggesting category:', error);
      return [{
        category: this.categorize(description),
        confidence: 0.5,
        method: 'fallback'
      }];
    }
  }

  // Train from user correction
  async trainFromCorrection(userId, description, suggestedCategory, actualCategory) {
    try {
      // Save training data
      const trainingData = new CategoryTraining({
        user: userId,
        description,
        category: actualCategory,
        source: 'user_correction'
      });
      await trainingData.save();

      // Update patterns
      await CategoryPattern.learnFromExpense(userId, description, actualCategory);

      // Retrain model in background (don't await)
      this.trainModel(userId).catch(err => console.error('Background training error:', err));

      return {
        message: 'Training data saved and model retraining initiated',
        trainingDataId: trainingData._id
      };
    } catch (error) {
      console.error('Error training from correction:', error);
      throw error;
    }
  }

  // Bulk categorize expenses
  async bulkCategorize(userId, expenses) {
    const results = [];

    for (const expense of expenses) {
      try {
        const suggestions = await this.suggestCategory(userId, expense.description, expense.amount);
        const bestSuggestion = suggestions[0];

        results.push({
          expenseId: expense._id,
          suggestedCategory: bestSuggestion.category,
          confidence: bestSuggestion.confidence,
          method: bestSuggestion.method,
          alternatives: suggestions.slice(1, 3)
        });
      } catch (error) {
        console.error(`Error categorizing expense ${expense._id}:`, error);
        results.push({
          expenseId: expense._id,
          suggestedCategory: this.categorize(expense.description),
          confidence: 0.5,
          method: 'fallback',
          error: error.message
        });
      }
    }

    return results;
  }

  // Get user statistics
  async getUserStats(userId) {
    try {
      const totalPatterns = await CategoryPattern.countDocuments({ user: userId, isActive: true });
      const totalTrainingData = await CategoryTraining.countDocuments({ user: userId });
      const hasModel = this.networks.has(userId.toString());

      return {
        totalPatterns,
        totalTrainingData,
        hasTrainedModel: hasModel,
        categories: this.categories
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      return {
        totalPatterns: 0,
        totalTrainingData: 0,
        hasTrainedModel: false,
        categories: this.categories
      };
    }
  }
}

module.exports = new CategorizationService();
