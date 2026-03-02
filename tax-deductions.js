/**
 * Tax Deductions Module
 * Handles expense categorization, deduction tracking, and optimization recommendations
 */

class TaxDeductions {
    constructor() {
        this.deductions = [];
        this.categories = this.initializeCategories();
        this.receipts = new Map();
    }

    /**
     * Initialize deduction categories with IRS-approved types
     */
    initializeCategories() {
        return {
            office: {
                name: 'Office Expenses',
                description: 'Office supplies, furniture, equipment',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            travel: {
                name: 'Travel',
                description: 'Business travel, lodging, transportation',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            meals: {
                name: 'Meals & Entertainment',
                description: 'Business meals (50% deductible)',
                businessPercentage: 50,
                requiresReceipt: true,
                limit: null
            },
            supplies: {
                name: 'Supplies',
                description: 'Business supplies and materials',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            utilities: {
                name: 'Utilities',
                description: 'Phone, internet, electricity (business portion)',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            professional: {
                name: 'Professional Services',
                description: 'Legal, accounting, consulting fees',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            depreciation: {
                name: 'Depreciation',
                description: 'Asset depreciation and Section 179',
                businessPercentage: 100,
                requiresReceipt: false,
                limit: null
            },
            homeOffice: {
                name: 'Home Office',
                description: 'Dedicated home office space',
                businessPercentage: 100,
                requiresReceipt: false,
                limit: null,
                simplified: { rate: 5, maxSquareFeet: 300 }
            },
            vehicle: {
                name: 'Vehicle Expenses',
                description: 'Business use of vehicle',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            insurance: {
                name: 'Insurance',
                description: 'Business insurance premiums',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            advertising: {
                name: 'Advertising & Marketing',
                description: 'Marketing, advertising, promotion costs',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            education: {
                name: 'Education & Training',
                description: 'Job-related education and training',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            software: {
                name: 'Software & Subscriptions',
                description: 'Business software and online services',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            },
            retirement: {
                name: 'Retirement Contributions',
                description: 'SEP IRA, Solo 401(k), etc.',
                businessPercentage: 100,
                requiresReceipt: false,
                limit: null
            },
            healthInsurance: {
                name: 'Health Insurance',
                description: 'Self-employed health insurance',
                businessPercentage: 100,
                requiresReceipt: true,
                limit: null
            }
        };
    }

    /**
     * Add a deduction
     */
    addDeduction(data) {
        const deduction = {
            id: `DED-${Date.now()}`,
            date: data.date || new Date().toISOString(),
            description: data.description,
            amount: parseFloat(data.amount),
            category: data.category || 'other',
            deductionType: data.deductionType,
            businessPercentage: data.businessPercentage || 100,
            receiptId: data.receiptId || null,
            notes: data.notes || '',
            vendor: data.vendor || '',
            paymentMethod: data.paymentMethod || '',
            status: 'active',
            createdAt: new Date().toISOString()
        };

        // Calculate deductible amount
        deduction.deductibleAmount = this.calculateDeductibleAmount(deduction);

        this.deductions.push(deduction);
        this.saveDeductions();
        
        return deduction;
    }

    /**
     * Calculate deductible amount based on category rules
     */
    calculateDeductibleAmount(deduction) {
        const category = this.categories[deduction.deductionType];
        if (!category) {
            return deduction.amount * (deduction.businessPercentage / 100);
        }

        let deductible = deduction.amount * (deduction.businessPercentage / 100);
        
        // Apply category-specific rules
        if (category.businessPercentage < 100) {
            deductible = deduction.amount * (category.businessPercentage / 100);
        }

        // Special case for meals - only 50% deductible
        if (deduction.deductionType === 'meals') {
            deductible = deduction.amount * 0.5;
        }

        return Math.round(deductible * 100) / 100;
    }

    /**
     * Categorize expense as business or personal
     */
    categorizeExpense(expense) {
        const businessKeywords = [
            'office', 'business', 'professional', 'consulting', 'meeting',
            'client', 'software', 'subscription', 'supplies', 'equipment',
            'advertising', 'marketing', 'conference', 'training'
        ];

        const personalKeywords = [
            'personal', 'home', 'family', 'grocery', 'restaurant',
            'entertainment', 'vacation', 'clothing', 'gift'
        ];

        const description = expense.description.toLowerCase();
        
        let businessScore = 0;
        let personalScore = 0;

        businessKeywords.forEach(keyword => {
            if (description.includes(keyword)) businessScore++;
        });

        personalKeywords.forEach(keyword => {
            if (description.includes(keyword)) personalScore++;
        });

        if (businessScore > personalScore) {
            return 'business';
        } else if (personalScore > businessScore) {
            return 'personal';
        } else {
            return 'mixed';
        }
    }

    /**
     * Import expenses from expense tracker
     */
    importExpenses(expenses) {
        const imported = [];
        
        expenses.forEach(expense => {
            const category = this.categorizeExpense(expense);
            
            if (category === 'business') {
                const deduction = this.addDeduction({
                    date: expense.date,
                    description: expense.description,
                    amount: expense.amount,
                    category: category,
                    deductionType: this.mapToDeductionType(expense),
                    businessPercentage: 100,
                    vendor: expense.vendor || expense.description
                });
                imported.push(deduction);
            } else if (category === 'mixed') {
                const deduction = this.addDeduction({
                    date: expense.date,
                    description: expense.description,
                    amount: expense.amount,
                    category: category,
                    deductionType: this.mapToDeductionType(expense),
                    businessPercentage: 50, // Default 50% for mixed use
                    vendor: expense.vendor || expense.description
                });
                imported.push(deduction);
            }
        });

        return imported;
    }

    /**
     * Map expense to deduction type
     */
    mapToDeductionType(expense) {
        const description = expense.description.toLowerCase();
        
        if (description.includes('office') || description.includes('desk')) return 'office';
        if (description.includes('travel') || description.includes('hotel')) return 'travel';
        if (description.includes('meal') || description.includes('restaurant')) return 'meals';
        if (description.includes('phone') || description.includes('internet')) return 'utilities';
        if (description.includes('software') || description.includes('subscription')) return 'software';
        if (description.includes('advertising') || description.includes('marketing')) return 'advertising';
        if (description.includes('gas') || description.includes('parking')) return 'vehicle';
        if (description.includes('insurance')) return 'insurance';
        
        return 'supplies';
    }

    /**
     * Get deduction recommendations
     */
    getRecommendations() {
        const recommendations = [];
        const currentYear = new Date().getFullYear();
        const yearDeductions = this.getDeductionsByYear(currentYear);

        // Check for home office deduction
        const homeOfficeDeductions = yearDeductions.filter(d => d.deductionType === 'homeOffice');
        if (homeOfficeDeductions.length === 0) {
            recommendations.push({
                type: 'home-office',
                priority: 'high',
                title: 'Consider Home Office Deduction',
                description: 'If you use part of your home exclusively for business, you may qualify for a home office deduction.',
                potentialSavings: 'Up to $1,500/year',
                action: 'Calculate home office deduction'
            });
        }

        // Check for vehicle deductions
        const vehicleDeductions = yearDeductions.filter(d => d.deductionType === 'vehicle');
        if (vehicleDeductions.length === 0) {
            recommendations.push({
                type: 'vehicle',
                priority: 'medium',
                title: 'Track Vehicle Expenses',
                description: 'If you use your vehicle for business, track your mileage to claim deductions.',
                potentialSavings: '$0.67 per business mile',
                action: 'Start tracking mileage'
            });
        }

        // Check for retirement contributions
        const retirementDeductions = yearDeductions.filter(d => d.deductionType === 'retirement');
        if (retirementDeductions.length === 0) {
            recommendations.push({
                type: 'retirement',
                priority: 'high',
                title: 'Maximize Retirement Contributions',
                description: 'Self-employed individuals can contribute to SEP IRA or Solo 401(k) for significant tax savings.',
                potentialSavings: 'Up to $66,000/year deductible',
                action: 'Set up retirement plan'
            });
        }

        // Check for health insurance deduction
        const healthInsurance = yearDeductions.filter(d => d.deductionType === 'healthInsurance');
        if (healthInsurance.length === 0) {
            recommendations.push({
                type: 'health-insurance',
                priority: 'high',
                title: 'Deduct Health Insurance Premiums',
                description: 'Self-employed individuals can deduct health insurance premiums.',
                potentialSavings: 'Full premium amount',
                action: 'Add health insurance deduction'
            });
        }

        // Check for missing receipts
        const missingReceipts = yearDeductions.filter(d => 
            d.amount > 75 && !d.receiptId && this.categories[d.deductionType]?.requiresReceipt
        );
        if (missingReceipts.length > 0) {
            recommendations.push({
                type: 'receipts',
                priority: 'critical',
                title: `${missingReceipts.length} Deductions Missing Receipts`,
                description: 'IRS requires receipts for expenses over $75. Upload receipts to protect your deductions.',
                potentialRisk: 'Deductions may be disallowed in audit',
                action: 'Upload missing receipts'
            });
        }

        // Check for education/training expenses
        const educationExpenses = yearDeductions.filter(d => d.deductionType === 'education');
        if (educationExpenses.length === 0) {
            recommendations.push({
                type: 'education',
                priority: 'medium',
                title: 'Deduct Education Expenses',
                description: 'Job-related education and training costs are deductible.',
                potentialSavings: 'Up to $5,250/year',
                action: 'Add education expenses'
            });
        }

        // Check for high personal percentage expenses
        const mixedUseExpenses = yearDeductions.filter(d => 
            d.businessPercentage < 100 && d.businessPercentage > 0
        );
        if (mixedUseExpenses.length > 0) {
            recommendations.push({
                type: 'mixed-use',
                priority: 'low',
                title: 'Review Mixed-Use Expense Percentages',
                description: 'Ensure business percentage allocations are accurate and documented.',
                action: 'Review expense allocations'
            });
        }

        return recommendations;
    }

    /**
     * Calculate home office deduction (simplified method)
     */
    calculateHomeOfficeDeduction(squareFeet) {
        const maxSquareFeet = 300;
        const ratePerSquareFoot = 5;
        
        const qualifyingSquareFeet = Math.min(squareFeet, maxSquareFeet);
        const deduction = qualifyingSquareFeet * ratePerSquareFoot;

        return {
            method: 'simplified',
            squareFeet: qualifyingSquareFeet,
            rate: ratePerSquareFoot,
            totalDeduction: deduction,
            maxDeduction: maxSquareFeet * ratePerSquareFoot
        };
    }

    /**
     * Get total deductions by year
     */
    getTotalDeductionsByYear(year) {
        const yearDeductions = this.getDeductionsByYear(year);
        return yearDeductions.reduce((sum, d) => sum + d.deductibleAmount, 0);
    }

    /**
     * Get deductions by year
     */
    getDeductionsByYear(year) {
        return this.deductions.filter(d => {
            const deductionYear = new Date(d.date).getFullYear();
            return deductionYear === year && d.status === 'active';
        });
    }

    /**
     * Get deductions by category
     */
    getDeductionsByCategory(category) {
        return this.deductions.filter(d => 
            d.category === category && d.status === 'active'
        );
    }

    /**
     * Get deductions by type
     */
    getDeductionsByType(type) {
        return this.deductions.filter(d => 
            d.deductionType === type && d.status === 'active'
        );
    }

    /**
     * Update deduction
     */
    updateDeduction(id, updates) {
        const index = this.deductions.findIndex(d => d.id === id);
        if (index !== -1) {
            this.deductions[index] = { ...this.deductions[index], ...updates };
            
            // Recalculate deductible amount if relevant fields changed
            if (updates.amount || updates.businessPercentage || updates.deductionType) {
                this.deductions[index].deductibleAmount = 
                    this.calculateDeductibleAmount(this.deductions[index]);
            }
            
            this.saveDeductions();
            return this.deductions[index];
        }
        return null;
    }

    /**
     * Delete deduction
     */
    deleteDeduction(id) {
        const index = this.deductions.findIndex(d => d.id === id);
        if (index !== -1) {
            this.deductions[index].status = 'deleted';
            this.saveDeductions();
            return true;
        }
        return false;
    }

    /**
     * Attach receipt to deduction
     */
    attachReceipt(deductionId, receiptId) {
        const deduction = this.deductions.find(d => d.id === deductionId);
        if (deduction) {
            deduction.receiptId = receiptId;
            this.saveDeductions();
            return true;
        }
        return false;
    }

    /**
     * Get deduction summary
     */
    getSummary(year) {
        const yearDeductions = this.getDeductionsByYear(year);
        
        const summary = {
            totalDeductions: 0,
            byCategory: {},
            byType: {},
            withReceipts: 0,
            withoutReceipts: 0,
            count: yearDeductions.length
        };

        yearDeductions.forEach(deduction => {
            summary.totalDeductions += deduction.deductibleAmount;
            
            // By category
            if (!summary.byCategory[deduction.category]) {
                summary.byCategory[deduction.category] = 0;
            }
            summary.byCategory[deduction.category] += deduction.deductibleAmount;
            
            // By type
            if (!summary.byType[deduction.deductionType]) {
                summary.byType[deduction.deductionType] = 0;
            }
            summary.byType[deduction.deductionType] += deduction.deductibleAmount;
            
            // Receipt tracking
            if (deduction.receiptId) {
                summary.withReceipts++;
            } else {
                summary.withoutReceipts++;
            }
        });

        summary.totalDeductions = Math.round(summary.totalDeductions * 100) / 100;

        return summary;
    }

    /**
     * Save deductions to localStorage
     */
    saveDeductions() {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('taxDeductions', JSON.stringify(this.deductions));
        }
    }

    /**
     * Load deductions from localStorage
     */
    loadDeductions() {
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('taxDeductions');
            if (saved) {
                this.deductions = JSON.parse(saved);
            }
        }
    }

    /**
     * Export deductions to CSV
     */
    exportToCSV(year) {
        const yearDeductions = this.getDeductionsByYear(year);
        
        let csv = 'Date,Description,Amount,Category,Type,Business %,Deductible Amount,Vendor,Receipt\n';
        
        yearDeductions.forEach(d => {
            csv += `${d.date},${d.description},${d.amount},${d.category},${d.deductionType},${d.businessPercentage},${d.deductibleAmount},${d.vendor},${d.receiptId ? 'Yes' : 'No'}\n`;
        });

        return csv;
    }

    /**
     * Get all categories
     */
    getAllCategories() {
        return this.categories;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaxDeductions;
}
