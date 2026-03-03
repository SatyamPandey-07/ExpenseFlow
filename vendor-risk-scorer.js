/**
 * Vendor Risk Scorer
 * Evaluates vendor trustworthiness, manages blacklists, and tracks vendor reputation
 */

class VendorRiskScorer {
    constructor() {
        this.vendorDatabase = new Map();
        this.blacklist = new Set();
        this.riskFactors = {
            frequentTransactioner: 0.2,
            largeTransactions: 0.25,
            geographicEdge: 0.15,
            paymentMethodVariance: 0.2,
            industryLocation: 0.2
        };
        
        this.loadData();
    }

    /**
     * Analyze expense for vendor risks
     */
    analyze(expense) {
        const vendorRisk = this.evaluateVendor(expense.vendor);
        const riskScore = Math.round(vendorRisk.overallRisk * 100);

        return {
            riskScore: riskScore,
            vendorRisk: vendorRisk,
            message: `Vendor "${expense.vendor}" risk score: ${riskScore}%`,
            severity: riskScore > 70 ? 'high' : riskScore > 40 ? 'medium' : 'low',
            details: vendorRisk
        };
    }

    /**
     * Evaluate vendor risk
     */
    evaluateVendor(vendorName) {
        if (this.blacklist.has(vendorName.toLowerCase())) {
            return {
                overallRisk: 1.0,
                status: 'Blacklisted',
                reason: 'Vendor is on blacklist',
                riskFactors: []
            };
        }

        const vendorData = this.vendorDatabase.get(vendorName.toLowerCase());
        
        if (!vendorData) {
            // Unknown vendor
            return {
                overallRisk: 0.5,
                status: 'Pending Review',
                reason: 'Vendor not yet verified',
                riskFactors: []
            };
        }

        const riskScores = [];

        // Transaction frequency risk
        if (vendorData.transactionCount > 50) {
            riskScores.push({
                factor: 'Transaction Frequency',
                score: Math.min(0.8, vendorData.transactionCount / 200),
                weight: this.riskFactors.frequentTransactioner
            });
        }

        // Transaction amount variance
        if (vendorData.avgAmount && vendorData.stdDevAmount) {
            const coefficientOfVariation = vendorData.stdDevAmount / vendorData.avgAmount;
            if (coefficientOfVariation > 1) {
                riskScores.push({
                    factor: 'Amount Variance',
                    score: Math.min(0.9, coefficientOfVariation / 2),
                    weight: this.riskFactors.largeTransactions
                });
            }
        }

        // Payment method inconsistency
        if (vendorData.paymentMethods && vendorData.paymentMethods.length > 3) {
            riskScores.push({
                factor: 'Payment Method Variance',
                score: vendorData.paymentMethods.length / 10,
                weight: this.riskFactors.paymentMethodVariance
            });
        }

        // Geographic location mismatch
        if (vendorData.locations && vendorData.locations.length > 5) {
            riskScores.push({
                factor: 'Geographic Anomalies',
                score: vendorData.locations.length / 20,
                weight: this.riskFactors.geographicEdge
            });
        }

        // Calculate weighted average
        let overallRisk = 0;
        let totalWeight = 0;

        riskScores.forEach(r => {
            overallRisk += r.score * r.weight;
            totalWeight += r.weight;
        });

        if (totalWeight === 0) {
            overallRisk = 0.3; // Default low risk for new vendors
        } else {
            overallRisk = overallRisk / totalWeight;
        }

        return {
            overallRisk: Math.min(1, overallRisk),
            status: vendorData.status || 'Trusted',
            riskFactors: riskScores,
            metadata: {
                totalTransactions: vendorData.transactionCount,
                avgAmount: vendorData.avgAmount,
                lastTransaction: vendorData.lastTransaction
            }
        };
    }

    /**
     * Add vendor to database
     */
    addVendor(vendorName, config = {}) {
        const vendorLower = vendorName.toLowerCase();
        
        this.vendorDatabase.set(vendorLower, {
            name: vendorName,
            status: config.status || 'Trusted',
            category: config.category || 'Other',
            notes: config.notes || '',
            transactionCount: 0,
            avgAmount: 0,
            stdDevAmount: 0,
            paymentMethods: [],
            locations: [],
            addedAt: new Date().toISOString(),
            lastTransaction: null
        });

        this.saveData();
    }

    /**
     * Update vendor after transaction
     */
    updateVendor(vendorName, transaction) {
        const vendorLower = vendorName.toLowerCase();
        let vendorData = this.vendorDatabase.get(vendorLower);

        if (!vendorData) {
            this.addVendor(vendorName);
            vendorData = this.vendorDatabase.get(vendorLower);
        }

        // Update transaction count
        vendorData.transactionCount++;

        // Update amount statistics
        const amount = parseFloat(transaction.amount) || 0;
        if (vendorData.transactionCount === 1) {
            vendorData.avgAmount = amount;
        } else {
            const prevAvg = vendorData.avgAmount;
            vendorData.avgAmount = (prevAvg * (vendorData.transactionCount - 1) + amount) / vendorData.transactionCount;
            
            // Update standard deviation
            const variance = Math.pow(amount - prevAvg, 2);
            vendorData.stdDevAmount = Math.sqrt(variance / vendorData.transactionCount);
        }

        // Track payment methods
        if (transaction.paymentMethod && !vendorData.paymentMethods.includes(transaction.paymentMethod)) {
            vendorData.paymentMethods.push(transaction.paymentMethod);
        }

        // Track locations
        if (transaction.location && !vendorData.locations.includes(transaction.location)) {
            vendorData.locations.push(transaction.location);
        }

        vendorData.lastTransaction = new Date().toISOString();

        this.saveData();
    }

    /**
     * Add to blacklist
     */
    blacklistVendor(vendorName, reason = '') {
        this.blacklist.add(vendorName.toLowerCase());
        
        const vendorLower = vendorName.toLowerCase();
        const vendorData = this.vendorDatabase.get(vendorLower);
        if (vendorData) {
            vendorData.status = 'Blacklisted';
            vendorData.blacklistReason = reason;
            vendorData.blacklistedAt = new Date().toISOString();
        }

        this.saveData();
    }

    /**
     * Remove from blacklist
     */
    removeFromBlacklist(vendorName) {
        this.blacklist.delete(vendorName.toLowerCase());
        
        const vendorLower = vendorName.toLowerCase();
        const vendorData = this.vendorDatabase.get(vendorLower);
        if (vendorData) {
            vendorData.status = 'Trusted';
        }

        this.saveData();
    }

    /**
     * Search vendors
     */
    searchVendors(query) {
        const results = [];
        const queryLower = query.toLowerCase();

        this.vendorDatabase.forEach((data, key) => {
            if (key.includes(queryLower) || data.category.includes(queryLower)) {
                results.push(data);
            }
        });

        return results;
    }

    /**
     * Get all vendors
     */
    getAllVendors() {
        return Array.from(this.vendorDatabase.values());
    }

    /**
     * Get vendor by name
     */
    getVendor(vendorName) {
        return this.vendorDatabase.get(vendorName.toLowerCase());
    }

    /**
     * Load data from localStorage
     */
    loadData() {
        const vendorsSaved = localStorage.getItem('vendorDatabase');
        if (vendorsSaved) {
            const data = JSON.parse(vendorsSaved);
            Object.entries(data).forEach(([key, vendor]) => {
                this.vendorDatabase.set(key, vendor);
            });
        }

        const blacklistSaved = localStorage.getItem('vendorBlacklist');
        if (blacklistSaved) {
            const blacklist = JSON.parse(blacklistSaved);
            blacklist.forEach(v => this.blacklist.add(v));
        }
    }

    /**
     * Save data to localStorage
     */
    saveData() {
        const vendorData = {};
        this.vendorDatabase.forEach((value, key) => {
            vendorData[key] = value;
        });

        localStorage.setItem('vendorDatabase', JSON.stringify(vendorData));
        localStorage.setItem('vendorBlacklist', JSON.stringify(Array.from(this.blacklist)));
    }

    /**
     * Export blacklist
     */
    exportBlacklist() {
        return Array.from(this.blacklist);
    }

    /**
     * Import blacklist
     */
    importBlacklist(blacklistArray) {
        if (Array.isArray(blacklistArray)) {
            blacklistArray.forEach(vendor => {
                this.blacklistVendor(vendor, 'Imported from external list');
            });
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VendorRiskScorer;
}
