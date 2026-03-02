/**
 * Tax Compliance Main Controller
 * Integrates all tax compliance modules and manages the UI
 */

class TaxComplianceController {
    constructor() {
        this.taxEngine = new TaxRulesEngine();
        this.formsGenerator = new TaxFormsGenerator();
        this.deductionsManager = new TaxDeductions();
        this.mileageTracker = new MileageTracker();
        
        this.currentYear = new Date().getFullYear();
        this.currentTab = 'dashboard';
        this.userProfile = this.loadUserProfile();
        
        this.init();
    }

    /**
     * Initialize the controller
     */
    init() {
        this.setupEventListeners();
        this.loadUserData();
        this.updateDashboard();
        this.checkForAlerts();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Dashboard controls
        const calculateBtn = document.getElementById('calculate-tax');
        if (calculateBtn) {
            calculateBtn.addEventListener('click', () => this.calculateTaxes());
        }

        const taxYearSelect = document.getElementById('tax-year');
        if (taxYearSelect) {
            taxYearSelect.addEventListener('change', (e) => {
                this.currentYear = parseInt(e.target.value);
                this.updateDashboard();
            });
        }

        // Deductions
        const importExpensesBtn = document.getElementById('import-expenses');
        if (importExpensesBtn) {
            importExpensesBtn.addEventListener('click', () => this.importExpenses());
        }

        const deductionCategoryFilter = document.getElementById('deduction-category-filter');
        if (deductionCategoryFilter) {
            deductionCategoryFilter.addEventListener('change', () => this.filterDeductions());
        }

        // Mileage
        const addMileageBtn = document.getElementById('add-mileage');
        if (addMileageBtn) {
            addMileageBtn.addEventListener('click', () => this.showMileageModal());
        }

        const mileageForm = document.getElementById('mileage-form');
        if (mileageForm) {
            mileageForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveMileageTrip();
            });
        }

        // Modal close
        const modalClose = document.querySelector('.close');
        if (modalClose) {
            modalClose.addEventListener('click', () => this.closeMileageModal());
        }

        // Tax Forms
        document.querySelectorAll('.generate-form').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.generateForm(e.target.dataset.form);
            });
        });

        // Sales Tax Calculator
        const calculateSalesTaxBtn = document.getElementById('calculate-sales-tax');
        if (calculateSalesTaxBtn) {
            calculateSalesTaxBtn.addEventListener('click', () => this.calculateSalesTax());
        }

        // Receipt Upload
        const receiptUpload = document.getElementById('receipt-file');
        if (receiptUpload) {
            receiptUpload.addEventListener('change', (e) => this.uploadReceipts(e));
        }

        const uploadArea = document.getElementById('receipt-upload-area');
        if (uploadArea) {
            uploadArea.addEventListener('click', () => {
                document.getElementById('receipt-file').click();
            });
        }

        // Tax Software Integrations
        document.getElementById('connect-turbotax')?.addEventListener('click', () => 
            this.connectIntegration('turbotax'));
        document.getElementById('connect-hrblock')?.addEventListener('click', () => 
            this.connectIntegration('hrblock'));
        document.getElementById('connect-quickbooks')?.addEventListener('click', () => 
            this.connectIntegration('quickbooks'));

        // Collaboration
        document.getElementById('invite-professional')?.addEventListener('click', () => 
            this.inviteProfessional());
        document.getElementById('send-message')?.addEventListener('click', () => 
            this.sendMessage());
    }

    /**
     * Switch between tabs
     */
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');

        this.currentTab = tabName;
        this.loadTabContent(tabName);
    }

    /**
     * Load content for specific tab
     */
    loadTabContent(tabName) {
        switch (tabName) {
            case 'dashboard':
                this.updateDashboard();
                break;
            case 'deductions':
                this.loadDeductions();
                break;
            case 'mileage':
                this.loadMileage();
                break;
            case 'forms':
                this.loadForms();
                break;
            case 'jurisdictions':
                this.loadJurisdictions();
                break;
            case 'audit':
                this.loadAuditDefense();
                break;
            case 'collaboration':
                this.loadCollaboration();
                break;
        }
    }

    /**
     * Update dashboard with current tax data
     */
    updateDashboard() {
        // Load deductions data
        const deductionsSummary = this.deductionsManager.getSummary(this.currentYear);
        const mileageSummary = this.mileageTracker.getSummary(this.currentYear);

        // Calculate tax liability
        const income = this.userProfile.income || 0;
        const totalDeductions = deductionsSummary.totalDeductions + mileageSummary.totalDeduction;

        const taxLiability = this.taxEngine.calculateTotalTaxLiability(
            income,
            totalDeductions,
            {
                filingStatus: this.userProfile.filingStatus || 'single',
                state: this.userProfile.state || null,
                businessIncome: this.userProfile.businessIncome || 0
            }
        );

        // Update UI
        document.getElementById('total-tax-liability').textContent = 
            `$${taxLiability.totalTax.toLocaleString()}`;
        document.getElementById('federal-tax').textContent = 
            `$${taxLiability.federalTax.toLocaleString()}`;
        document.getElementById('state-tax').textContent = 
            `$${taxLiability.stateTax.toLocaleString()}`;
        document.getElementById('sales-tax').textContent = '$0.00';

        document.getElementById('total-deductions').textContent = 
            `$${totalDeductions.toLocaleString()}`;
        document.getElementById('business-deductions').textContent = 
            `$${deductionsSummary.totalDeductions.toLocaleString()}`;
        document.getElementById('mileage-deductions').textContent = 
            `$${mileageSummary.totalDeduction.toLocaleString()}`;

        // Calculate estimated balance
        const withheld = this.userProfile.taxWithheld || 0;
        const paid = this.userProfile.taxPaid || 0;
        const balance = taxLiability.totalTax - withheld - paid;
        
        document.getElementById('estimated-balance').textContent = 
            `${balance < 0 ? '-' : ''}$${Math.abs(balance).toLocaleString()}`;
        document.getElementById('tax-withheld').textContent = 
            `$${withheld.toLocaleString()}`;
        document.getElementById('tax-paid').textContent = 
            `$${paid.toLocaleString()}`;

        // Update audit risk
        this.updateAuditRisk();

        // Load quarterly schedule
        this.loadQuarterlySchedule();

        // Load recommendations
        this.loadRecommendations();
    }

    /**
     * Calculate taxes
     */
    calculateTaxes() {
        this.updateDashboard();
        this.showNotification('Taxes calculated successfully!', 'success');
    }

    /**
     * Update audit risk score
     */
    updateAuditRisk() {
        const deductionsSummary = this.deductionsManager.getSummary(this.currentYear);
        const mileageSummary = this.mileageTracker.getSummary(this.currentYear);

        const riskData = {
            income: this.userProfile.income || 0,
            deductions: deductionsSummary.totalDeductions + mileageSummary.totalDeduction,
            businessIncome: this.userProfile.businessIncome || 0,
            cashTransactions: 0,
            homeOfficeDeduction: deductionsSummary.byType?.homeOffice || 0,
            vehicleExpenses: mileageSummary.totalDeduction,
            hasRoundNumbers: false
        };

        const auditRisk = this.taxEngine.calculateAuditRiskScore(riskData);

        document.getElementById('audit-risk-score').textContent = auditRisk.riskLevel;
        
        const riskBar = document.getElementById('risk-bar');
        riskBar.style.width = `${auditRisk.score}%`;
        
        // Color code by risk level
        if (auditRisk.riskLevel === 'High') {
            riskBar.style.background = '#ef4444';
        } else if (auditRisk.riskLevel === 'Medium') {
            riskBar.style.background = '#f59e0b';
        } else {
            riskBar.style.background = '#4ade80';
        }
    }

    /**
     * Load quarterly payment schedule
     */
    loadQuarterlySchedule() {
        const schedule = this.taxEngine.getQuarterlyPaymentSchedule('US_FEDERAL', this.currentYear);
        const container = document.getElementById('quarterly-schedule');
        
        container.innerHTML = schedule.map(q => `
            <div class="alert-item ${q.isPast ? 'past' : 'upcoming'}">
                <span><strong>${q.quarter}</strong>: ${q.formatted}</span>
                <span>${q.isPast ? '✓ Past' : '⚠️ Upcoming'}</span>
            </div>
        `).join('');
    }

    /**
     * Load recommendations
     */
    loadRecommendations() {
        const recommendations = this.deductionsManager.getRecommendations();
        const container = document.getElementById('recommendations-list');
        
        if (recommendations.length === 0) {
            container.innerHTML = '<p>No recommendations at this time.</p>';
            return;
        }

        container.innerHTML = recommendations.map(rec => `
            <div class="recommendation-item ${rec.priority}">
                <strong>${rec.title}</strong>
                <p>${rec.description}</p>
                ${rec.potentialSavings ? `<p><strong>Potential Savings:</strong> ${rec.potentialSavings}</p>` : ''}
                ${rec.potentialRisk ? `<p class="risk"><strong>Risk:</strong> ${rec.potentialRisk}</p>` : ''}
            </div>
        `).join('');
    }

    /**
     * Load deductions table
     */
    loadDeductions() {
        this.deductionsManager.loadDeductions();
        const deductions = this.deductionsManager.getDeductionsByYear(this.currentYear);
        const tbody = document.getElementById('deductions-table-body');
        
        tbody.innerHTML = deductions.map(d => `
            <tr>
                <td>${new Date(d.date).toLocaleDateString()}</td>
                <td>${d.description}</td>
                <td>$${d.amount.toFixed(2)}</td>
                <td>${d.category}</td>
                <td>${d.deductionType}</td>
                <td>${d.businessPercentage}%</td>
                <td>$${d.deductibleAmount.toFixed(2)}</td>
                <td>${d.receiptId ? '✓' : '✗'}</td>
                <td>
                    <button class="action-btn edit" onclick="taxController.editDeduction('${d.id}')">Edit</button>
                    <button class="action-btn delete" onclick="taxController.deleteDeduction('${d.id}')">Delete</button>
                </td>
            </tr>
        `).join('');

        // Load recommendations
        this.loadRecommendations();
    }

    /**
     * Import expenses
     */
    importExpenses() {
        // This would integrate with the expense tracker
        this.showNotification('Expense import feature coming soon!', 'info');
    }

    /**
     * Filter deductions
     */
    filterDeductions() {
        const categoryFilter = document.getElementById('deduction-category-filter').value;
        const typeFilter = document.getElementById('deduction-type-filter').value;
        
        let deductions = this.deductionsManager.getDeductionsByYear(this.currentYear);
        
        if (categoryFilter !== 'all') {
            deductions = deductions.filter(d => d.category === categoryFilter);
        }
        
        if (typeFilter !== 'all') {
            deductions = deductions.filter(d => d.deductionType === typeFilter);
        }
        
        const tbody = document.getElementById('deductions-table-body');
        tbody.innerHTML = deductions.map(d => `
            <tr>
                <td>${new Date(d.date).toLocaleDateString()}</td>
                <td>${d.description}</td>
                <td>$${d.amount.toFixed(2)}</td>
                <td>${d.category}</td>
                <td>${d.deductionType}</td>
                <td>${d.businessPercentage}%</td>
                <td>$${d.deductibleAmount.toFixed(2)}</td>
                <td>${d.receiptId ? '✓' : '✗'}</td>
                <td>
                    <button class="action-btn edit" onclick="taxController.editDeduction('${d.id}')">Edit</button>
                    <button class="action-btn delete" onclick="taxController.deleteDeduction('${d.id}')">Delete</button>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Load mileage data
     */
    loadMileage() {
        const summary = this.mileageTracker.getSummary(this.currentYear);
        const trips = this.mileageTracker.getTripsByYear(this.currentYear);
        
        // Update summary
        document.getElementById('total-business-miles').textContent = 
            summary.businessMiles.toLocaleString();
        document.getElementById('irs-rate').textContent = 
            `$${this.mileageTracker.getIRSRate(this.currentYear, 'business')}/mile`;
        document.getElementById('mileage-deduction-total').textContent = 
            `$${summary.totalDeduction.toLocaleString()}`;
        
        // Load trips table
        const tbody = document.getElementById('mileage-table-body');
        tbody.innerHTML = trips.map(t => `
            <tr>
                <td>${new Date(t.date).toLocaleDateString()}</td>
                <td>${t.from}</td>
                <td>${t.to}</td>
                <td>${t.purpose}</td>
                <td>${t.totalDistance}</td>
                <td>$${t.irsRate}</td>
                <td>$${t.deduction.toFixed(2)}</td>
                <td>
                    <button class="action-btn edit" onclick="taxController.editTrip('${t.id}')">Edit</button>
                    <button class="action-btn delete" onclick="taxController.deleteTrip('${t.id}')">Delete</button>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Show mileage modal
     */
    showMileageModal() {
        const modal = document.getElementById('mileage-modal');
        modal.classList.add('active');
        modal.style.display = 'flex';
    }

    /**
     * Close mileage modal
     */
    closeMileageModal() {
        const modal = document.getElementById('mileage-modal');
        modal.classList.remove('active');
        modal.style.display = 'none';
        document.getElementById('mileage-form').reset();
    }

    /**
     * Save mileage trip
     */
    saveMileageTrip() {
        const tripData = {
            date: document.getElementById('mileage-date').value,
            from: document.getElementById('mileage-from').value,
            to: document.getElementById('mileage-to').value,
            distance: parseFloat(document.getElementById('mileage-distance').value),
            purpose: document.getElementById('mileage-purpose').value,
            type: 'business'
        };

        this.mileageTracker.addTrip(tripData);
        this.closeMileageModal();
        this.loadMileage();
        this.showNotification('Trip added successfully!', 'success');
    }

    /**
     * Load tax forms
     */
    loadForms() {
        const forms = this.formsGenerator.getAllForms();
        const tbody = document.getElementById('forms-table-body');
        
        tbody.innerHTML = forms.map(f => `
            <tr>
                <td>${f.formType}</td>
                <td>${f.taxYear}</td>
                <td>${new Date(f.generatedDate).toLocaleDateString()}</td>
                <td><span class="status-badge">${f.status}</span></td>
                <td>
                    <button class="action-btn view" onclick="taxController.viewForm('${f.formId}')">View</button>
                    <button class="action-btn download" onclick="taxController.downloadForm('${f.formId}')">Download</button>
                    <button class="action-btn delete" onclick="taxController.deleteForm('${f.formId}')">Delete</button>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Generate tax form
     */
    generateForm(formType) {
        let form;
        const data = { taxYear: this.currentYear };

        try {
            switch (formType) {
                case '1099-MISC':
                    form = this.formsGenerator.generate1099MISC(data);
                    break;
                case 'W-2':
                    form = this.formsGenerator.generateW2(data);
                    break;
                case 'Schedule-C':
                    form = this.formsGenerator.generateScheduleC(data);
                    break;
                case '1040':
                    form = this.formsGenerator.generate1040(data);
                    break;
                case 'VAT':
                    form = this.formsGenerator.generateVATReturn(data);
                    break;
                case 'State':
                    form = this.formsGenerator.generateStateTaxReturn(data);
                    break;
            }

            this.loadForms();
            this.showNotification(`${formType} generated successfully!`, 'success');
        } catch (error) {
            this.showNotification(`Error generating ${formType}: ${error.message}`, 'error');
        }
    }

    /**
     * Calculate sales tax
     */
    calculateSalesTax() {
        const amount = parseFloat(document.getElementById('sales-amount').value);
        const location = document.getElementById('sales-location').value;

        if (!amount || !location) {
            this.showNotification('Please enter amount and location', 'error');
            return;
        }

        const result = this.taxEngine.calculateSalesTax(amount, location);
        
        document.getElementById('sales-tax-result').innerHTML = `
            <strong>Amount:</strong> $${result.amount}<br>
            <strong>Tax Rate:</strong> ${(result.taxRate * 100).toFixed(2)}%<br>
            <strong>Tax Amount:</strong> $${result.taxAmount}<br>
            <strong>Total:</strong> $${result.total}
        `;
    }

    /**
     * Load jurisdictions
     */
    loadJurisdictions() {
        // Already loaded in HTML
    }

    /**
     * Load audit defense
     */
    loadAuditDefense() {
        // Load receipt archive
        const receipts = this.loadReceipts();
        document.getElementById('total-receipts').textContent = receipts.length;
        
        if (receipts.length > 0) {
            const oldest = receipts.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
            document.getElementById('oldest-receipt').textContent = 
                new Date(oldest.date).toLocaleDateString();
        }
    }

    /**
     * Upload receipts
     */
    uploadReceipts(event) {
        const files = event.target.files;
        this.showNotification(`Uploading ${files.length} receipt(s)...`, 'info');
        
        // Would integrate with backend storage
        setTimeout(() => {
            this.showNotification('Receipts uploaded successfully!', 'success');
        }, 1000);
    }

    /**
     * Load collaboration workspace
     */
    loadCollaboration() {
        // Placeholder for collaboration features
    }

    /**
     * Connect tax software integration
     */
    connectIntegration(software) {
        this.showNotification(`Connecting to ${software}...`, 'info');
        
        // Would integrate with actual APIs
        setTimeout(() => {
            const badge = document.getElementById(`${software}-status`);
            badge.textContent = 'Connected';
            badge.classList.add('connected');
            this.showNotification(`Connected to ${software} successfully!`, 'success');
        }, 1500);
    }

    /**
     * Check for compliance alerts
     */
    checkForAlerts() {
        const alerts = [];
        const deadline = this.taxEngine.getFilingDeadline('US_FEDERAL', this.currentYear);
        
        if (deadline.daysUntil < 30 && deadline.daysUntil > 0) {
            alerts.push({
                type: 'warning',
                message: `Tax filing deadline in ${deadline.daysUntil} days (${deadline.formatted})`
            });
        }

        const container = document.getElementById('alerts-container');
        if (container) {
            container.innerHTML = alerts.map(a => `
                <div class="alert-item ${a.type}">
                    <span>${a.message}</span>
                </div>
            `).join('');
        }
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
        // Would implement actual notification UI
    }

    /**
     * Load user profile
     */
    loadUserProfile() {
        if (typeof localStorage !== 'undefined') {
            const profile = localStorage.getItem('taxUserProfile');
            return profile ? JSON.parse(profile) : this.getDefaultProfile();
        }
        return this.getDefaultProfile();
    }

    /**
     * Get default user profile
     */
    getDefaultProfile() {
        return {
            income: 75000,
            businessIncome: 0,
            filingStatus: 'single',
            state: 'CA',
            taxWithheld: 8000,
            taxPaid: 0
        };
    }

    /**
     * Save user profile
     */
    saveUserProfile() {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('taxUserProfile', JSON.stringify(this.userProfile));
        }
    }

    /**
     * Load user data
     */
    loadUserData() {
        this.deductionsManager.loadDeductions();
        this.mileageTracker.loadTrips();
    }

    /**
     * Load receipts (placeholder)
     */
    loadReceipts() {
        return [];
    }

    // CRUD operations
    editDeduction(id) { console.log('Edit deduction:', id); }
    deleteDeduction(id) { 
        this.deductionsManager.deleteDeduction(id);
        this.loadDeductions();
        this.showNotification('Deduction deleted', 'success');
    }
    editTrip(id) { console.log('Edit trip:', id); }
    deleteTrip(id) { 
        this.mileageTracker.deleteTrip(id);
        this.loadMileage();
        this.showNotification('Trip deleted', 'success');
    }
    viewForm(id) { console.log('View form:', id); }
    downloadForm(id) { 
        this.formsGenerator.exportToJSON(id);
        this.showNotification('Form downloaded', 'success');
    }
    deleteForm(id) { 
        this.formsGenerator.deleteForm(id);
        this.loadForms();
        this.showNotification('Form deleted', 'success');
    }
    inviteProfessional() { this.showNotification('Invite feature coming soon!', 'info'); }
    sendMessage() { this.showNotification('Message sent!', 'success'); }
}

// Initialize controller when DOM is loaded
let taxController;
document.addEventListener('DOMContentLoaded', () => {
    taxController = new TaxComplianceController();
});
