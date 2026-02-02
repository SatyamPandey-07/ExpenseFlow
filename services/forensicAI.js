const { GoogleGenerativeAI } = require('@google/generative-ai');
const StateDelta = require('../models/StateDelta');
const Expense = require('../models/Expense');
const replayEngine = require('./replayEngine');

/**
 * ForensicAI - AI-powered forensic analysis of financial transactions
 * Uses Gemini to explain complex transaction chains in natural language
 */
class ForensicAI {
    constructor() {
        this.genAI = process.env.GEMINI_API_KEY
            ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
            : null;
        this.model = this.genAI ? this.genAI.getGenerativeModel({ model: 'gemini-pro' }) : null;
    }

    /**
     * Trace how a specific balance was reached
     * @param {String} userId - User ID
     * @param {Date} targetDate - Date to analyze
     * @param {Number} targetBalance - Balance to explain
     * @returns {Object} Forensic analysis
     */
    async traceBalanceOrigin(userId, targetDate, targetBalance = null) {
        try {
            // Get state at target date
            const replayResult = await replayEngine.replayToDate(userId, targetDate);
            const actualBalance = replayResult.state.totalBalance;
            const balanceToAnalyze = targetBalance || actualBalance;

            // Get transaction history leading to this balance
            const deltas = await StateDelta.find({
                user: userId,
                timestamp: { $lte: targetDate },
                'financialImpact.balanceChange': { $ne: 0 }
            }).sort({ timestamp: -1 }).limit(50);

            // Build transaction chain
            const transactionChain = await this.buildTransactionChain(deltas);

            // Generate AI explanation
            const aiExplanation = await this.generateBalanceExplanation(
                balanceToAnalyze,
                transactionChain,
                replayResult.state
            );

            return {
                success: true,
                targetDate,
                actualBalance,
                analyzedBalance: balanceToAnalyze,
                transactionChain,
                aiExplanation,
                breakdown: {
                    totalIncome: replayResult.state.totalIncome,
                    totalExpenses: replayResult.state.totalExpenses,
                    netChange: replayResult.state.totalIncome - replayResult.state.totalExpenses,
                    transactionCount: replayResult.state.transactionCount
                }
            };
        } catch (error) {
            console.error('[ForensicAI] Error tracing balance:', error);
            throw error;
        }
    }

    /**
     * Build transaction chain from deltas
     */
    async buildTransactionChain(deltas) {
        const chain = [];

        for (const delta of deltas) {
            const transaction = {
                id: delta.entityId,
                timestamp: delta.timestamp,
                operation: delta.operation,
                type: delta.entityType,
                balanceChange: delta.financialImpact?.balanceChange || 0,
                categories: delta.financialImpact?.affectedCategories || [],
                description: delta.afterState?.description || delta.beforeState?.description || 'Unknown'
            };

            // Add causality if available
            if (delta.causedBy) {
                transaction.causedBy = delta.causedBy;
            }

            chain.push(transaction);
        }

        return chain;
    }

    /**
     * Generate AI explanation using Gemini
     */
    async generateBalanceExplanation(balance, transactionChain, state) {
        if (!this.model) {
            return this.generateFallbackExplanation(balance, transactionChain, state);
        }

        try {
            const prompt = this.buildForensicPrompt(balance, transactionChain, state);
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('[ForensicAI] Gemini API error:', error);
            return this.generateFallbackExplanation(balance, transactionChain, state);
        }
    }

    /**
     * Build forensic analysis prompt for Gemini
     */
    buildForensicPrompt(balance, transactionChain, state) {
        const recentTransactions = transactionChain.slice(0, 10);

        return `You are a financial forensic analyst. Analyze how this balance was reached and explain it in clear, natural language.

**Current Financial State:**
- Balance: ${balance}
- Total Income: ${state.totalIncome}
- Total Expenses: ${state.totalExpenses}
- Net Change: ${state.totalIncome - state.totalExpenses}
- Transaction Count: ${state.transactionCount}

**Recent Transactions (most recent first):**
${recentTransactions.map((t, i) => `${i + 1}. ${t.timestamp.toLocaleDateString()}: ${t.description} (${t.balanceChange > 0 ? '+' : ''}${t.balanceChange}) - ${t.categories.join(', ')}`).join('\n')}

**Category Breakdown:**
${state.categoryBreakdown.map(c => `- ${c.category}: ${c.amount} (${c.transactionCount} transactions)`).join('\n')}

Please provide:
1. A clear explanation of how the current balance was reached
2. Key contributors to the balance (major income/expense sources)
3. Notable patterns or anomalies in the transaction history
4. Any potential concerns or recommendations

Keep the explanation concise, professional, and easy to understand for a non-technical user.`;
    }

    /**
     * Fallback explanation when Gemini is unavailable
     */
    generateFallbackExplanation(balance, transactionChain, state) {
        const topIncome = transactionChain
            .filter(t => t.balanceChange > 0)
            .sort((a, b) => b.balanceChange - a.balanceChange)
            .slice(0, 3);

        const topExpenses = transactionChain
            .filter(t => t.balanceChange < 0)
            .sort((a, b) => a.balanceChange - b.balanceChange)
            .slice(0, 3);

        let explanation = `**Balance Analysis: ${balance}**\n\n`;

        explanation += `Your current balance of ${balance} is the result of ${state.transactionCount} transactions, `;
        explanation += `with total income of ${state.totalIncome} and total expenses of ${state.totalExpenses}.\n\n`;

        if (topIncome.length > 0) {
            explanation += `**Top Income Sources:**\n`;
            topIncome.forEach((t, i) => {
                explanation += `${i + 1}. ${t.description}: +${t.balanceChange} (${t.timestamp.toLocaleDateString()})\n`;
            });
            explanation += `\n`;
        }

        if (topExpenses.length > 0) {
            explanation += `**Top Expenses:**\n`;
            topExpenses.forEach((t, i) => {
                explanation += `${i + 1}. ${t.description}: ${t.balanceChange} (${t.timestamp.toLocaleDateString()})\n`;
            });
            explanation += `\n`;
        }

        if (state.categoryBreakdown.length > 0) {
            const topCategory = state.categoryBreakdown.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
            explanation += `**Spending Pattern:**\n`;
            explanation += `Your largest spending category is ${topCategory.category} with ${Math.abs(topCategory.amount)} `;
            explanation += `across ${topCategory.transactionCount} transactions.\n`;
        }

        return explanation;
    }

    /**
     * Analyze suspicious patterns
     */
    async detectAnomalies(userId, startDate, endDate) {
        const deltas = await StateDelta.find({
            user: userId,
            timestamp: { $gte: startDate, $lte: endDate }
        }).sort({ timestamp: 1 });

        const anomalies = [];

        // Detect large transactions
        const amounts = deltas
            .filter(d => d.financialImpact?.balanceChange)
            .map(d => Math.abs(d.financialImpact.balanceChange));

        if (amounts.length > 0) {
            const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
            const stdDev = Math.sqrt(
                amounts.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / amounts.length
            );

            deltas.forEach(delta => {
                const amount = Math.abs(delta.financialImpact?.balanceChange || 0);
                if (amount > avg + (2 * stdDev)) {
                    anomalies.push({
                        type: 'large_transaction',
                        severity: 'medium',
                        delta,
                        reason: `Transaction amount (${amount}) is significantly higher than average (${avg.toFixed(2)})`
                    });
                }
            });
        }

        // Detect rapid transactions
        for (let i = 1; i < deltas.length; i++) {
            const timeDiff = deltas[i].timestamp - deltas[i - 1].timestamp;
            if (timeDiff < 60000) { // Less than 1 minute
                anomalies.push({
                    type: 'rapid_transactions',
                    severity: 'low',
                    deltas: [deltas[i - 1], deltas[i]],
                    reason: `Two transactions occurred within ${Math.round(timeDiff / 1000)} seconds`
                });
            }
        }

        return {
            success: true,
            period: { startDate, endDate },
            anomaliesDetected: anomalies.length,
            anomalies
        };
    }

    /**
     * Generate transaction narrative
     */
    async generateTransactionNarrative(userId, startDate, endDate) {
        const deltas = await StateDelta.find({
            user: userId,
            timestamp: { $gte: startDate, $lte: endDate }
        }).sort({ timestamp: 1 }).limit(100);

        if (!this.model) {
            return this.generateSimpleNarrative(deltas);
        }

        try {
            const prompt = `Generate a brief, engaging narrative summary of these financial transactions:\n\n${deltas.map(d =>
                `- ${d.timestamp.toLocaleDateString()}: ${d.operation} ${d.entityType} (${d.financialImpact?.balanceChange || 0})`
            ).join('\n')}\n\nProvide a 2-3 sentence summary highlighting the main financial activities and overall trend.`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            return this.generateSimpleNarrative(deltas);
        }
    }

    /**
     * Simple narrative without AI
     */
    generateSimpleNarrative(deltas) {
        const totalChange = deltas.reduce((sum, d) => sum + (d.financialImpact?.balanceChange || 0), 0);
        const transactionCount = deltas.length;

        return `During this period, you had ${transactionCount} transactions with a net change of ${totalChange}. ` +
            `${totalChange > 0 ? 'Your balance increased' : 'Your balance decreased'} overall.`;
    }
}

module.exports = new ForensicAI();
