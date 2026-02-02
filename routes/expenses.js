const express = require('express');
const Joi = require('joi');
const Transaction = require('../models/Transaction');
const budgetService = require('../services/budgetService');
const categorizationService = require('../services/categorizationService');
const exportService = require('../services/exportService');
const currencyService = require('../services/currencyService');
const aiService = require('../services/aiService');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { ExpenseSchemas, validateRequest, validateQuery } = require('../middleware/inputValidator');
const { expenseLimiter, exportLimiter } = require('../middleware/rateLimiter');
const ResponseFactory = require('../utils/ResponseFactory');
const { asyncHandler } = require('../middleware/errorMiddleware');
const { NotFoundError } = require('../utils/AppError');
const router = express.Router();

// GET all expenses for authenticated user with pagination support
router.get('/', auth, validateQuery(ExpenseSchemas.filter), asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  const user = await User.findById(req.user._id);

  // Workspace filtering
  const workspaceId = req.query.workspaceId;
  const query = workspaceId
    ? { workspace: workspaceId }
    : { user: req.user._id, workspace: null };

  // Get total count for pagination info
  const total = await Expense.countDocuments(query);

  const expenses = await Expense.find(query)
    .sort({ date: -1 })
    .skip(skip)
    .limit(limit);

  // Convert expenses to user's preferred currency if needed
  const convertedExpenses = await Promise.all(expenses.map(async (expense) => {
    const expenseObj = expense.toObject();

    // If expense currency differs from user preference, show converted amount
    if (expenseObj.originalCurrency !== user.preferredCurrency) {
      try {
        const conversion = await currencyService.convertCurrency(
          expenseObj.originalAmount,
          expenseObj.originalCurrency,
          user.preferredCurrency
        );
        expenseObj.displayAmount = conversion.convertedAmount;
        expenseObj.displayCurrency = user.preferredCurrency;
      } catch (error) {
        // If conversion fails, use original amount
        expenseObj.displayAmount = expenseObj.amount;
        expenseObj.displayCurrency = expenseObj.originalCurrency;
      }
    } else {
      expenseObj.displayAmount = expenseObj.amount;
      expenseObj.displayCurrency = expenseObj.originalCurrency;
    }

    return expenseObj;
  }));

  return ResponseFactory.paginated(res, convertedExpenses, page, limit, total);
}));

// POST new expense (Transaction)
router.post('/', auth, expenseLimiter, validateRequest(ExpenseSchemas.create), async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const expenseCurrency = req.body.currency || user.preferredCurrency;

    // Validate currency
    if (!currencyService.isValidCurrency(expenseCurrency)) {
      return res.status(400).json({ error: 'Invalid currency code' });
    }

    // Store original amount and currency
    const expenseData = {
      ...value,
      user: value.workspaceId ? req.user._id : req.user._id, // User still relevant for reporting
      addedBy: req.user._id,
      workspace: value.workspaceId || null,
      originalAmount: value.amount,
      originalCurrency: expenseCurrency,
      amount: value.amount // Keep original as primary amount
    };

    // If expense currency differs from user preference, add conversion info
    if (expenseCurrency !== user.preferredCurrency) {
      try {
        const conversion = await currencyService.convertCurrency(
          req.body.amount,
          expenseCurrency,
          user.preferredCurrency
        );
        expenseData.convertedAmount = conversion.convertedAmount;
        expenseData.convertedCurrency = user.preferredCurrency;
        expenseData.exchangeRate = conversion.exchangeRate;
      } catch (conversionError) {
        console.error('Currency conversion failed:', conversionError.message);
        // Continue without conversion data
      }
    }

    const expense = new Expense(expenseData);
    await expense.save();

    // Check if expense requires approval
    const approvalService = require('../services/approvalService');
    let requiresApproval = false;
    let workflow = null;

    if (expenseData.workspace) {
      requiresApproval = await approvalService.requiresApproval(expenseData, expenseData.workspace);
    }

    if (requiresApproval) {
      try {
        workflow = await approvalService.submitForApproval(expense._id, req.user._id);
        expense.status = 'pending_approval';
        expense.approvalWorkflow = workflow._id;
        await expense.save();
      } catch (approvalError) {
        console.error('Failed to submit for approval:', approvalError.message);
        // Continue with normal flow if approval submission fails
      }
    }

    // Update budget and goal progress using converted amount if available
    const amountForBudget = expenseData.convertedAmount || value.amount;
    if (value.type === 'expense') {
      await budgetService.checkBudgetAlerts(req.user._id);
    }
    await budgetService.updateGoalProgress(req.user._id, value.type === 'expense' ? -amountForBudget : amountForBudget, value.category);

    // Emit real-time update to all user's connected devices
    const io = req.app.get('io');

    // Create transaction
    const transaction = await transactionService.createTransaction(req.body, req.user._id, io);

    const user = await User.findById(req.user._id);
    const response = transaction.toObject();

    if (response.originalCurrency !== user.preferredCurrency && response.convertedAmount) {
      response.displayAmount = response.convertedAmount;
      response.displayCurrency = user.preferredCurrency;
    } else {
      response.displayAmount = response.amount;
      response.displayCurrency = response.originalCurrency;
    }

    res.status(201).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update expense
router.put('/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({ _id: req.params.id, user: req.user._id });
    if (!transaction) return res.status(404).json({ error: 'Expense not found' });

    if (req.body.amount && req.body.type === 'expense') {
      const oldAmount = transaction.convertedAmount || transaction.amount;
      await budgetService.updateGoalProgress(req.user._id, oldAmount, transaction.category);
    }

    Object.assign(transaction, req.body);

    if (req.body.amount || req.body.currency) {
      const user = await User.findById(req.user._id);
      const currency = req.body.currency || transaction.originalCurrency || 'INR';
      if (currency !== user.preferredCurrency) {
        const conversion = await currencyService.convertCurrency(req.body.amount || transaction.amount, currency, user.preferredCurrency);
        transaction.convertedAmount = conversion.convertedAmount;
        transaction.convertedCurrency = user.preferredCurrency;
        transaction.exchangeRate = conversion.exchangeRate;
      }
      transaction.originalAmount = req.body.amount || transaction.amount;
      transaction.originalCurrency = currency;
    }

    await transaction.save();

    if (req.body.amount && req.body.type === 'expense') {
      const newAmount = transaction.convertedAmount || transaction.amount;
      await budgetService.updateGoalProgress(req.user._id, -newAmount, transaction.category);
    }

    res.json(transaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE expense
router.delete('/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!transaction) return res.status(404).json({ error: 'Expense not found' });

    if (transaction.type === 'expense') {
      const amount = transaction.convertedAmount || transaction.amount;
      await budgetService.updateGoalProgress(req.user._id, amount, transaction.category);
    }

    res.json({ message: 'Expense deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;