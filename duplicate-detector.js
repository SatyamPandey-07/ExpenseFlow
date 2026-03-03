/**
 * Duplicate Expense Detector
 * Uses fuzzy matching and image similarity to identify duplicate transactions
 * Prevents duplicate invoices, receipts, and expense entries
 */

class DuplicateDetector {
    constructor() {
        this.expenseHistory = [];
        this.imageHashes = new Map();
        this.similarityThreshold = 0.85; // 85% similarity = likely duplicate
        
        this.loadHistory();
    }

    /**
     * Analyze expense for duplicates
     */
    analyze(expense) {
        const duplicates = this.findDuplicates(expense);
        const riskScore = duplicates.length > 0 ? Math.min(100, 50 + (duplicates.length * 20)) : 0;

        return {
            riskScore: riskScore,
            isDuplicate: duplicates.length > 0,
            duplicateCount: duplicates.length,
            message: duplicates.length > 0 
                ? `Found ${duplicates.length} potential duplicate(s) of this expense`
                : 'No duplicates detected',
            severity: duplicates.length > 0 ? 'high' : 'low',
            duplicates: duplicates
        };
    }

    /**
     * Find potential duplicates
     */
    findDuplicates(expense) {
        const potentialDuplicates = [];

        for (const historical of this.expenseHistory) {
            // Check amount similarity (within 5% tolerance)
            const amountSimilarity = this.calculateAmountSimilarity(expense, historical);
            
            // Check vendor similarity (fuzzy matching)
            const vendorSimilarity = this.calculateStringSimilarity(
                expense.vendor?.toLowerCase() || '',
                historical.vendor?.toLowerCase() || ''
            );

            // Check description similarity
            const descriptionSimilarity = this.calculateStringSimilarity(
                expense.description?.toLowerCase() || '',
                historical.description?.toLowerCase() || ''
            );

            // Check date proximity (within 7 days)
            const dateProximity = this.calculateDateProximity(expense, historical);

            // Check receipt image similarity if available
            const imageSimilarity = this.calculateImageSimilarity(expense, historical);

            // Composite score
            const compositeScore = (
                amountSimilarity * 0.3 +
                vendorSimilarity * 0.25 +
                descriptionSimilarity * 0.2 +
                dateProximity * 0.15 +
                imageSimilarity * 0.1
            );

            if (compositeScore > this.similarityThreshold) {
                potentialDuplicates.push({
                    expense: historical,
                    similarity: Math.round(compositeScore * 100),
                    reasons: [
                        amountSimilarity > 0.9 ? 'Same amount' : '',
                        vendorSimilarity > 0.85 ? 'Same vendor' : '',
                        descriptionSimilarity > 0.8 ? 'Similar description' : '',
                        dateProximity > 0.8 ? 'Same date/time' : '',
                        imageSimilarity > 0.7 ? 'Same receipt image' : ''
                    ].filter(r => r)
                });
            }
        }

        return potentialDuplicates;
    }

    /**
     * Calculate amount similarity
     */
    calculateAmountSimilarity(expense1, expense2) {
        const amount1 = parseFloat(expense1.amount) || 0;
        const amount2 = parseFloat(expense2.amount) || 0;

        if (amount1 === 0 || amount2 === 0) return 0;
        
        const diff = Math.abs(amount1 - amount2) / Math.max(amount1, amount2);
        return Math.max(0, 1 - diff);
    }

    /**
     * Calculate date proximity
     */
    calculateDateProximity(expense1, expense2) {
        const date1 = new Date(expense1.date || expense1.timestamp);
        const date2 = new Date(expense2.date || expense2.timestamp);

        const daysDiff = Math.abs((date1 - date2) / (1000 * 60 * 60 * 24));
        
        // Perfect match if same day, decreasing similarity as days increase
        if (daysDiff === 0) return 1.0;
        if (daysDiff <= 1) return 0.95;
        if (daysDiff <= 3) return 0.85;
        if (daysDiff <= 7) return 0.7;
        return 0;
    }

    /**
     * Fuzzy string matching (Levenshtein distance)
     */
    calculateStringSimilarity(str1, str2) {
        if (str1 === str2) return 1.0;
        if (str1.length === 0 || str2.length === 0) return 0;

        const distance = this.levenshteinDistance(str1, str2);
        const maxLength = Math.max(str1.length, str2.length);
        
        return 1 - (distance / maxLength);
    }

    /**
     * Levenshtein distance algorithm
     */
    levenshteinDistance(str1, str2) {
        const len1 = str1.length;
        const len2 = str2.length;
        const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(0));

        for (let i = 0; i <= len1; i++) matrix[0][i] = i;
        for (let j = 0; j <= len2; j++) matrix[j][0] = j;

        for (let j = 1; j <= len2; j++) {
            for (let i = 1; i <= len1; i++) {
                if (str1[i - 1] === str2[j - 1]) {
                    matrix[j][i] = matrix[j - 1][i - 1];
                } else {
                    matrix[j][i] = Math.min(
                        matrix[j - 1][i - 1] + 1,
                        matrix[j][i - 1] + 1,
                        matrix[j - 1][i] + 1
                    );
                }
            }
        }

        return matrix[len2][len1];
    }

    /**
     * Calculate image similarity using perceptual hash
     */
    calculateImageSimilarity(expense1, expense2) {
        if (!expense1.receiptImage || !expense2.receiptImage) {
            return 0;
        }

        const hash1 = this.imageHashes.get(expense1.receiptImage);
        const hash2 = this.imageHashes.get(expense2.receiptImage);

        if (!hash1 || !hash2) {
            return 0;
        }

        // Calculate Hamming distance between hashes
        let distance = 0;
        for (let i = 0; i < hash1.length; i++) {
            if (hash1[i] !== hash2[i]) {
                distance++;
            }
        }

        // Convert to similarity (64 bits total)
        const similarity = 1 - (distance / 64);
        return similarity;
    }

    /**
     * Generate perceptual hash of image
     */
    generateImageHash(imageData) {
        // Simplified hash generation (in production, use proper image hashing)
        let hash = '';
        const chars = imageData.split('');
        let sum = 0;

        for (let i = 0; i < chars.length; i += Math.floor(chars.length / 64)) {
            sum += chars.charCodeAt(i);
            hash += (sum % 2).toString();
        }

        return hash.padEnd(64, '0');
    }

    /**
     * Record expense in history
     */
    recordExpense(expense) {
        this.expenseHistory.push({
            ...expense,
            recordedAt: new Date().toISOString()
        });

        // Hash receipt image if available
        if (expense.receiptImage) {
            const hash = this.generateImageHash(expense.receiptImage);
            this.imageHashes.set(expense.receiptImage, hash);
        }

        this.saveHistory();
    }

    /**
     * Mark as legitimate duplicate
     */
    markAsLegitimate(expenseId1, expenseId2) {
        // Record this pair as legitimate in training data
        // This helps the system avoid false positives
        const key = [expenseId1, expenseId2].sort().join('-');
        
        let legitimateDuplicates = this.getLegitimate DuplicatesData();
        legitimateDuplicates.push(key);
        
        localStorage.setItem('legitimateDuplicates', JSON.stringify(legitimateDuplicates));
    }

    /**
     * Get legitimate duplicates for learning
     */
    getLegitimate DuplicatesData() {
        const saved = localStorage.getItem('legitimateDuplicates');
        return saved ? JSON.parse(saved) : [];
    }

    /**
     * Load history from localStorage
     */
    loadHistory() {
        const saved = localStorage.getItem('duplicateDetectorHistory');
        if (saved) {
            this.expenseHistory = JSON.parse(saved);
            
            // Rebuild image hash map
            this.expenseHistory.forEach(expense => {
                if (expense.receiptImage) {
                    const hash = this.generateImageHash(expense.receiptImage);
                    this.imageHashes.set(expense.receiptImage, hash);
                }
            });
        }
    }

    /**
     * Save history to localStorage
     */
    saveHistory() {
        // Limit history to last 1000 expenses
        const recentHistory = this.expenseHistory.slice(-1000);
        localStorage.setItem('duplicateDetectorHistory', JSON.stringify(recentHistory));
    }

    /**
     * Clear duplicate
     */
    clearDuplicate(expenseId) {
        this.expenseHistory = this.expenseHistory.filter(e => e.id !== expenseId);
        this.saveHistory();
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DuplicateDetector;
}
