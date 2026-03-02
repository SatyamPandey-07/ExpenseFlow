/**
 * Fraud Database Connector
 * Integrates with external fraud databases and threat intelligence sources
 */

class FraudDatabaseConnector {
    constructor() {
        this.knownFraudVendors = new Set();
        this.knownFraudVendorFingerprints = new Map();
        this.threatIntelligence = [];
        this.APIKeys = {};
        this.cacheExpiration = 24 * 60 * 60 * 1000; // 24 hours
        this.lastSync = null;
        
        this.loadData();
    }

    /**
     * Analyze expense using external fraud database
     */
    analyze(expense) {
        const checks = [];
        let riskScore = 0;

        // Check vendor against known fraud database
        const vendorRisk = this.checkVendorReputation(expense.vendor);
        if (vendorRisk.isFraudulent) {
            checks.push({
                check: 'Known Fraudster',
                result: true,
                risk: 80
            });
            riskScore += 50;
        } else if (vendorRisk.highRisk) {
            checks.push({
                check: 'High Risk Vendor',
                result: true,
                risk: vendorRisk.riskScore
            });
            riskScore += 25;
        }

        // Check for known fraud patterns
        const patternMatch = this.checkFraudPatterns(expense);
        if (patternMatch.matched) {
            checks.push({
                check: 'Known Fraud Pattern',
                result: true,
                pattern: patternMatch.pattern
            });
            riskScore += 30;
        }

        // Check against threat intelligence
        const threatLevel = this.checkThreatIntelligence(expense);
        if (threatLevel > 0) {
            checks.push({
                check: 'Threat Intelligence Alert',
                result: true,
                threat: threatLevel
            });
            riskScore += 20;
        }

        return {
            riskScore: Math.min(100, riskScore),
            checks: checks,
            message: checks.length > 0
                ? `External database flagged ${checks.length} concern(s)`
                : 'Expense looks legitimate based on external data',
            severity: riskScore > 70 ? 'high' : riskScore > 40 ? 'medium' : 'low',
            details: {
                vendorRisk: vendorRisk,
                threatLevel: threatLevel
            }
        };
    }

    /**
     * Check vendor reputation
     */
    checkVendorReputation(vendor) {
        const vendorLower = vendor.toLowerCase();

        // Check if in known fraud list
        if (this.knownFraudVendors.has(vendorLower)) {
            return {
                isFraudulent: true,
                riskScore: 100,
                source: 'Known Fraudulent Vendor'
            };
        }

        // Check fingerprint similarity
        const fingerprint = this.generateVendorFingerprint(vendor);
        for (const [knownFingerprint, riskData] of this.knownFraudVendorFingerprints.entries()) {
            const similarity = this.compareFinger prints(fingerprint, knownFingerprint);
            if (similarity > 0.8) {
                return {
                    isFraudulent: false,
                    highRisk: true,
                    riskScore: Math.round(similarity * 100),
                    similarTo: riskData.vendor,
                    source: 'Fingerprint Match'
                };
            }
        }

        return {
            isFraudulent: false,
            highRisk: false,
            riskScore: 0
        };
    }

    /**
     * Check for known fraud patterns
     */
    checkFraudPatterns(expense) {
        // Known patterns extracted from threat intelligence
        const patterns = [
            {
                name: 'Circular Invoicing',
                check: () => expense.description?.includes('invoice') && 
                           expense.description?.includes('duplicate')
            },
            {
                name: 'Round Amount Inflation',
                check: () => (parseFloat(expense.amount) % 100 === 0) && 
                           parseFloat(expense.amount) > 500
            },
            {
                name: 'Ghost Vendor',
                check: () => expense.vendor?.match(/^[a-z]+\s+[a-z]+\s*inc\.?$/i)
            },
            {
                name: 'Rapid Refunds',
                check: () => expense.type === 'refund' && 
                           Math.random() > 0.95 // Simulated
            }
        ];

        for (const pattern of patterns) {
            if (pattern.check()) {
                return {
                    matched: true,
                    pattern: pattern.name
                };
            }
        }

        return { matched: false };
    }

    /**
     * Check threat intelligence
     */
    checkThreatIntelligence(expense) {
        // Score based on recent threats
        let threatScore = 0;

        this.threatIntelligence.forEach(threat => {
            if (threat.type === 'vendor' && expense.vendor.includes(threat.target)) {
                threatScore += threat.severity;
            }
            if (threat.type === 'pattern' && JSON.stringify(expense).includes(threat.target)) {
                threatScore += threat.severity;
            }
        });

        return Math.min(100, threatScore);
    }

    /**
     * Generate vendor fingerprint
     */
    generateVendorFingerprint(vendor) {
        // Create hash-like fingerprint
        let hash = '';
        for (let i = 0; i < vendor.length; i++) {
            hash += vendor.charCodeAt(i).toString(16);
        }
        return hash;
    }

    /**
     * Compare fingerprints
     */
    compareFingerprints(fp1, fp2) {
        if (!fp1 || !fp2) return 0;
        
        let matches = 0;
        const minLength = Math.min(fp1.length, fp2.length);

        for (let i = 0; i < minLength; i++) {
            if (fp1[i] === fp2[i]) {
                matches++;
            }
        }

        return matches / minLength;
    }

    /**
     * Sync with external fraud databases
     */
    async syncFraudDatabase() {
        try {
            console.log('Syncing with external fraud databases...');

            // In production, would connect to:
            // - FBI Fraud Database
            // - OFAC (Office of Foreign Assets Control)
            // - FinCEN (Financial Crimes Enforcement Network)
            // - Industry-specific fraud databases

            // Simulated response
            const fraudVendors = [
                'fraudulent corp',
                'shell company inc',
                'phony services llc'
            ];

            fraudVendors.forEach(v => {
                this.knownFraudVendors.add(v.toLowerCase());
            });

            this.lastSync = new Date().toISOString();
            this.saveData();

            return {
                success: true,
                vendorsAdded: fraudVendors.length,
                lastSync: this.lastSync
            };
        } catch (error) {
            console.error('Error syncing fraud database:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Add known fraud vendor
     */
    addFraudVendor(vendor, reason = '') {
        const vendorLower = vendor.toLowerCase();
        this.knownFraudVendors.add(vendorLower);

        const fingerprint = this.generateVendorFingerprint(vendor);
        this.knownFraudVendorFingerprints.set(fingerprint, {
            vendor: vendor,
            reason: reason,
            addedAt: new Date().toISOString()
        });

        this.saveData();
    }

    /**
     * Add threat intelligence
     */
    addThreatIntelligence(threat) {
        this.threatIntelligence.push({
            ...threat,
            addedAt: new Date().toISOString(),
            severity: threat.severity || 5
        });

        this.saveData();
    }

    /**
     * Get threat intelligence
     */
    getThreatIntelligence(days = 30) {
        const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
        return this.threatIntelligence.filter(t => {
            const addedDate = new Date(t.addedAt).getTime();
            return addedDate > cutoffDate;
        });
    }

    /**
     * Load data from localStorage
     */
    loadData() {
        const fraudVendorsSaved = localStorage.getItem('fraudDatabaseVendors');
        if (fraudVendorsSaved) {
            const vendors = JSON.parse(fraudVendorsSaved);
            vendors.forEach(v => this.knownFraudVendors.add(v));
        }

        const fingerprintsSaved = localStorage.getItem('fraudDatabaseFingerprints');
        if (fingerprintsSaved) {
            const fingerprints = JSON.parse(fingerprintsSaved);
            fingerprints.forEach(([fp, data]) => {
                this.knownFraudVendorFingerprints.set(fp, data);
            });
        }

        const threatsSaved = localStorage.getItem('threatIntelligence');
        if (threatsSaved) {
            this.threatIntelligence = JSON.parse(threatsSaved);
        }
    }

    /**
     * Save data to localStorage
     */
    saveData() {
        localStorage.setItem('fraudDatabaseVendors', JSON.stringify(Array.from(this.knownFraudVendors)));
        localStorage.setItem('fraudDatabaseFingerprints', JSON.stringify(
            Array.from(this.knownFraudVendorFingerprints.entries())
        ));
        localStorage.setItem('threatIntelligence', JSON.stringify(this.threatIntelligence));
    }

    /**
     * Get database statistics
     */
    getStatistics() {
        return {
            knownFraudVendors: this.knownFraudVendors.size,
            fingerprintMatches: this.knownFraudVendorFingerprints.size,
            threatIntelligenceItems: this.threatIntelligence.length,
            lastSync: this.lastSync
        };
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FraudDatabaseConnector;
}
