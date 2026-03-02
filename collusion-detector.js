/**
 * Collusion Detection Module
 * Detects suspicious patterns indicating collusion between employees and vendors
 * Uses network analysis and behavioral correlation
 */

class CollusionDetector {
    constructor() {
        this.transactionGraph = new Map();
        this.suspiciousPatterns = [];
        this.employeeVendorMap = new Map();
        this.loadData();
    }

    /**
     * Analyze expense for collusion indicators
     */
    analyze(expense) {
        const indicators = [];
        const riskScore = this.detectCollusionPatterns(
            expense.submittedBy || 'unknown',
            expense.vendor,
            indicators
        );

        return {
            riskScore: Math.min(100, riskScore),
            indicators: indicators,
            message: indicators.length > 0
                ? `Detected ${indicators.length} collusion indicator(s)`
                : 'No collusion patterns detected',
            severity: riskScore > 75 ? 'high' : riskScore > 45 ? 'medium' : 'low',
            details: {
                commonTransactions: this.findCommonTransactions(expense.submittedBy, expense.vendor),
                networkStrength: this.calculateNetworkStrength(expense.submittedBy, expense.vendor)
            }
        };
    }

    /**
     * Detect collusion patterns
     */
    detectCollusionPatterns(employee, vendor, indicators) {
        let collusionScore = 0;

        // Check employee-vendor transaction frequency
        const transactions = this.getTransactionsBetween(employee, vendor);
        if (transactions.length > 20) {
            indicators.push({
                type: 'High Transaction Volume',
                severity: 'high',
                details: `${transactions.length} transactions with same vendor`
            });
            collusionScore += 25;
        }

        // Check timing patterns (transactions in quick succession)
        const timingAnomaly = this.detectTimingPatterns(transactions);
        if (timingAnomaly.suspicious) {
            indicators.push({
                type: 'Suspicious Timing',
                severity: timingAnomaly.severity,
                details: timingAnomaly.message
            });
            collusionScore += 20;
        }

        // Check amount patterns (consistent amounts suggesting collusion)
        const amountAnomaly = this.detectAmountPatterns(transactions);
        if (amountAnomaly.suspicious) {
            indicators.push({
                type: 'Amount Pattern',
                severity: 'medium',
                details: amountAnomaly.message
            });
            collusionScore += 15;
        }

        // Check for circular transaction patterns
        const circularPattern = this.detectCircularPatterns(employee);
        if (circularPattern.detected) {
            indicators.push({
                type: 'Circular Transaction Pattern',
                severity: 'high',
                details: circularPattern.message
            });
            collusionScore += 30;
        }

        // Check network centrality (is this vendor a hub?)
        const centrality = this.calculateNetworkCentrality(vendor);
        if (centrality > 0.8) {
            indicators.push({
                type: 'Network Hub Vendor',
                severity: 'medium',
                details: `Vendor is central node in transaction network (${Math.round(centrality * 100)}% centrality)`
            });
            collusionScore += 10;
        }

        return Math.min(100, collusionScore);
    }

    /**
     * Detect timing patterns
     */
    detectTimingPatterns(transactions) {
        if (transactions.length < 3) {
            return { suspicious: false };
        }

        // Sort by date
        const sorted = transactions.sort((a, b) => 
            new Date(a.date) - new Date(b.date)
        );

        // Check for rapid-fire transactions (same day/week)
        const intervals = [];
        for (let i = 1; i < sorted.length; i++) {
            const daysDiff = (new Date(sorted[i].date) - new Date(sorted[i-1].date)) / (1000 * 60 * 60 * 24);
            intervals.push(daysDiff);
        }

        const rapidTransactions = intervals.filter(i => i <= 1).length;
        if (rapidTransactions > intervals.length * 0.5) {
            return {
                suspicious: true,
                severity: 'high',
                message: `${rapidTransactions} transactions within 24 hours of each other`
            };
        }

        return { suspicious: false };
    }

    /**
     * Detect amount patterns
     */
    detectAmountPatterns(transactions) {
        if (transactions.length < 5) {
            return { suspicious: false };
        }

        const amounts = transactions.map(t => parseFloat(t.amount) || 0);
        const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
        const variance = amounts.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / amounts.length;
        const stdDev = Math.sqrt(variance);

        // Very low variance suggests amounts are purposely kept similar
        if (stdDev < mean * 0.1) {
            return {
                suspicious: true,
                message: `Unusually consistent amounts (std dev: $${stdDev.toFixed(2)}, mean: $${mean.toFixed(2)})`
            };
        }

        return { suspicious: false };
    }

    /**
     * Detect circular transaction patterns
     */
    detectCircularPatterns(employee) {
        const vendors = this.getVendorsForEmployee(employee);
        
        // Check if employee pays vendors who in turn pay back the employee
        // (through other employees or indirect paths)
        let circularPaths = [];

        for (const vendor of vendors) {
            const inverse = this.getEmployeesForVendor(vendor);
            if (inverse.length > 0) {
                circularPaths.push({
                    vendor: vendor,
                    inverseConnections: inverse.length
                });
            }
        }

        return {
            detected: circularPaths.length > 2,
            message: circularPaths.length > 0 
                ? `Found ${circularPaths.length} potential circular transaction paths`
                : 'No circular patterns detected',
            paths: circularPaths
        };
    }

    /**
     * Calculate network centrality
     */
    calculateNetworkCentrality(vendor) {
        let connections = 0;
        let maxConnections = 0;

        this.transactionGraph.forEach((value, key) => {
            if (key.includes(vendor)) {
                connections += value;
            }
            maxConnections += value;
        });

        return maxConnections > 0 ? connections / maxConnections : 0;
    }

    /**
     * Get transactions between employee and vendor
     */
    getTransactionsBetween(employee, vendor) {
        const key = `${employee}:${vendor}`;
        const transactions = [];

        // Retrieve from transaction graph
        if (this.transactionGraph.has(key)) {
            return this.transactionGraph.get(key);
        }

        return transactions;
    }

    /**
     * Find common transactions
     */
    findCommonTransactions(employee, vendor) {
        return this.getTransactionsBetween(employee, vendor).length;
    }

    /**
     * Calculate network strength
     */
    calculateNetworkStrength(employee, vendor) {
        const directConnections = this.getTransactionsBetween(employee, vendor).length;
        const employeeVendors = this.getVendorsForEmployee(employee).length;
        const vendorEmployees = this.getEmployeesForVendor(vendor).length;

        return {
            direct: directConnections,
            employeeVendorCount: employeeVendors,
            vendorEmployeeCount: vendorEmployees,
            strength: (directConnections + vendorEmployees) / Math.max(employeeVendors, 1)
        };
    }

    /**
     * Get vendors for employee
     */
    getVendorsForEmployee(employee) {
        if (!this.employeeVendorMap.has(employee)) {
            return [];
        }
        return Array.from(this.employeeVendorMap.get(employee).keys());
    }

    /**
     * Get employees for vendor
     */
    getEmployeesForVendor(vendor) {
        const employees = [];
        this.employeeVendorMap.forEach((vendors, employee) => {
            if (vendors.has(vendor)) {
                employees.push(employee);
            }
        });
        return employees;
    }

    /**
     * Record transaction in network
     */
    recordTransaction(employee, vendor, transaction) {
        const key = `${employee}:${vendor}`;
        
        if (!this.transactionGraph.has(key)) {
            this.transactionGraph.set(key, []);
        }
        this.transactionGraph.get(key).push(transaction);

        // Update employee-vendor map
        if (!this.employeeVendorMap.has(employee)) {
            this.employeeVendorMap.set(employee, new Map());
        }
        this.employeeVendorMap.get(employee).set(vendor, true);

        this.saveData();
    }

    /**
     * Get network statistics
     */
    getNetworkStatistics() {
        return {
            totalNodes: this.employeeVendorMap.size,
            totalEdges: this.transactionGraph.size,
            averageConnections: this.transactionGraph.size / Math.max(this.employeeVendorMap.size, 1)
        };
    }

    /**
     * Load data from localStorage
     */
    loadData() {
        const saved = localStorage.getItem('collusionDetectorData');
        if (saved) {
            const data = JSON.parse(saved);
            this.transactionGraph = new Map(data.transactionGraph);
            this.employeeVendorMap = new Map(
                data.employeeVendorMap.map(([emp, vendors]) => [emp, new Map(vendors)])
            );
        }
    }

    /**
     * Save data to localStorage
     */
    saveData() {
        const data = {
            transactionGraph: Array.from(this.transactionGraph.entries()),
            employeeVendorMap: Array.from(this.employeeVendorMap.entries()).map(([emp, vendors]) => [
                emp,
                Array.from(vendors.entries())
            ])
        };
        localStorage.setItem('collusionDetectorData', JSON.stringify(data));
    }

    /**
     * Clear suspicious patterns
     */
    clearSuspiciousPatterns() {
        this.suspiciousPatterns = [];
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CollusionDetector;
}
