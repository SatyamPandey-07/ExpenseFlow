/**
 * Travel Policy Enforcer
 * Detects travel policy violations and enforces company travel guidelines
 */

class TravelPolicyEnforcer {
    constructor() {
        this.policies = this.initializePolicies();
        this.travelExpenses = [];
        this.violations = [];
        this.loadData();
    }

    /**
     * Initialize default travel policies
     */
    initializePolicies() {
        return {
            dailyHotelLimit: 300,
            mealPerDiem: 75,
            flightClassLimit: 'economy',
            carRentalLimit: 100,
            dailyPhoneAllowance: 50,
            maxTravelDaysPerQuarter: 60,
            advanceBookingRequired: 14,
            blacklistedAirlines: [],
            blacklistedHotels: [],
            requiresPreApproval: {
                flights: true,
                hotels: true,
                carRentals: true
            }
        };
    }

    /**
     * Analyze expense for policy violations
     */
    analyze(expense) {
        const violations = this.checkPolicyViolations(expense);
        const riskScore = violations.length > 0 ? Math.min(100, 30 + (violations.length * 15)) : 0;

        return {
            riskScore: riskScore,
            violations: violations,
            message: violations.length > 0
                ? `Found ${violations.length} policy violation(s)`
                : 'Policy compliant',
            severity: violations.some(v => v.severity === 'critical') ? 'high' : 'medium',
            details: violations
        };
    }

    /**
     * Check policy violations
     */
    checkPolicyViolations(expense) {
        const violations = [];

        if (!expense.category) {
            return violations;
        }

        const categoryLower = expense.category.toLowerCase();

        // Check hotel policy
        if (categoryLower.includes('hotel') || categoryLower.includes('accommodation')) {
            const hotelViolations = this.checkHotelPolicy(expense);
            violations.push(...hotelViolations);
        }

        // Check meal policy
        if (categoryLower.includes('meal') || categoryLower.includes('dining')) {
            const mealViolations = this.checkMealPolicy(expense);
            violations.push(...mealViolations);
        }

        // Check flight policy
        if (categoryLower.includes('flight') || categoryLower.includes('airfare')) {
            const flightViolations = this.checkFlightPolicy(expense);
            violations.push(...flightViolations);
        }

        // Check car rental policy
        if (categoryLower.includes('car') || categoryLower.includes('rental')) {
            const carViolations = this.checkCarRentalPolicy(expense);
            violations.push(...carViolations);
        }

        // Check advance booking
        if (this.requiresAdvanceBooking(expense.category)) {
            const bookingViolations = this.checkAdvanceBooking(expense);
            violations.push(...bookingViolations);
        }

        return violations;
    }

    /**
     * Check hotel policy
     */
    checkHotelPolicy(expense) {
        const violations = [];
        const amount = parseFloat(expense.amount) || 0;

        // Check daily limit
        if (amount > this.policies.dailyHotelLimit) {
            violations.push({
                rule: `Daily Hotel Limit: $${this.policies.dailyHotelLimit}`,
                violation: `Exceeded by $${(amount - this.policies.dailyHotelLimit).toFixed(2)}`,
                severity: amount > this.policies.dailyHotelLimit * 1.5 ? 'critical' : 'warning'
            });
        }

        // Check blacklisted hotels
        if (expense.vendor) {
            const vendorLower = expense.vendor.toLowerCase();
            if (this.policies.blacklistedHotels.some(h => vendorLower.includes(h))) {
                violations.push({
                    rule: 'Blacklisted Hotel',
                    violation: `${expense.vendor} is not approved`,
                    severity: 'critical'
                });
            }
        }

        return violations;
    }

    /**
     * Check meal policy
     */
    checkMealPolicy(expense) {
        const violations = [];
        const amount = parseFloat(expense.amount) || 0;

        if (amount > this.policies.mealPerDiem) {
            violations.push({
                rule: `Meal Per Diem: $${this.policies.mealPerDiem}`,
                violation: `Exceeded by $${(amount - this.policies.mealPerDiem).toFixed(2)}`,
                severity: 'warning'
            });
        }

        return violations;
    }

    /**
     * Check flight policy
     */
    checkFlightPolicy(expense) {
        const violations = [];

        // Check blacklisted airlines
        if (expense.vendor) {
            const vendorLower = expense.vendor.toLowerCase();
            if (this.policies.blacklistedAirlines.some(a => vendorLower.includes(a))) {
                violations.push({
                    rule: 'Airline Restriction',
                    violation: `${expense.vendor} is not approved`,
                    severity: 'critical'
                });
            }
        }

        // Check flight class
        if (expense.flightClass && expense.flightClass !== 'economy') {
            if (this.policies.flightClassLimit === 'economy') {
                violations.push({
                    rule: 'Flight Class: Economy only',
                    violation: `${expense.flightClass} class not permitted`,
                    severity: 'warning'
                });
            }
        }

        return violations;
    }

    /**
     * Check car rental policy
     */
    checkCarRentalPolicy(expense) {
        const violations = [];
        const amount = parseFloat(expense.amount) || 0;

        if (amount > this.policies.carRentalLimit) {
            violations.push({
                rule: `Daily Car Rental Limit: $${this.policies.carRentalLimit}`,
                violation: `Exceeded by $${(amount - this.policies.carRentalLimit).toFixed(2)}`,
                severity: 'warning'
            });
        }

        return violations;
    }

    /**
     * Check advance booking requirement
     */
    checkAdvanceBooking(expense) {
        const violations = [];
        const expenseDate = new Date(expense.date || expense.timestamp);
        const bookingDate = new Date(expense.bookingDate || expense.createdAt);
        const daysDifference = (expenseDate - bookingDate) / (1000 * 60 * 60 * 24);

        if (daysDifference < this.policies.advanceBookingRequired) {
            violations.push({
                rule: `Advance Booking Required: ${this.policies.advanceBookingRequired} days`,
                violation: `Booked only ${Math.round(daysDifference)} days in advance`,
                severity: 'warning'
            });
        }

        return violations;
    }

    /**
     * Check if category requires advance booking
     */
    requiresAdvanceBooking(category) {
        const categoryLower = category.toLowerCase();
        return categoryLower.includes('flight') || categoryLower.includes('hotel');
    }

    /**
     * Update policy
     */
    updatePolicy(policyName, value) {
        if (this.policies.hasOwnProperty(policyName)) {
            this.policies[policyName] = value;
            this.saveData();
        }
    }

    /**
     * Get current policies
     */
    getPolicies() {
        return this.policies;
    }

    /**
     * Get violations for period
     */
    getViolationsForPeriod(days = 30) {
        const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
        return this.violations.filter(v => {
            const date = new Date(v.timestamp);
            return date.getTime() > cutoffDate;
        });
    }

    /**
     * Record violation
     */
    recordViolation(expense, violations) {
        violations.forEach(violation => {
            this.violations.push({
                ...violation,
                expenseId: expense.id,
                timestamp: new Date().toISOString()
            });
        });
        this.saveData();
    }

    /**
     * Load data from localStorage
     */
    loadData() {
        const policiesSaved = localStorage.getItem('travelPolicies');
        if (policiesSaved) {
            this.policies = { ...this.policies, ...JSON.parse(policiesSaved) };
        }

        const violationsSaved = localStorage.getItem('travelViolations');
        if (violationsSaved) {
            this.violations = JSON.parse(violationsSaved);
        }
    }

    /**
     * Save data to localStorage
     */
    saveData() {
        localStorage.setItem('travelPolicies', JSON.stringify(this.policies));
        const recentViolations = this.violations.slice(-500);
        localStorage.setItem('travelViolations', JSON.stringify(recentViolations));
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TravelPolicyEnforcer;
}
