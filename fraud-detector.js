/**
 * Main Fraud Detection System
 * Orchestrates all fraud detection modules and manages UI updates
 * ML-based fraud detection with behavioral analysis and anomaly scoring
 */

class FraudDetectionSystem {
    constructor() {
        this.detectionModules = {};
        this.alerts = [];
        this.detections = [];
        this.riskScore = 25;
        this.sensitivity = 50;
        this.alertThreshold = 75;
        this.autoInvestigation = true;
        this.modelLearning = true;
        
        this.init();
    }

    /**
     * Initialize fraud detection system
     */
    init() {
        this.setupModules();
        this.setupEventListeners();
        this.loadSettings();
        this.startMonitoring();
        this.updateDashboard();
    }

    /**
     * Setup detection modules
     */
    setupModules() {
        try {
            // Initialize all detection modules
            if (typeof BehavioralBiometrics !== 'undefined') {
                this.detectionModules.behavioral = new BehavioralBiometrics();
            }
            if (typeof DuplicateDetector !== 'undefined') {
                this.detectionModules.duplicate = new DuplicateDetector();
            }
            if (typeof VendorRiskScorer !== 'undefined') {
                this.detectionModules.vendor = new VendorRiskScorer();
            }
            if (typeof AnomalyDetector !== 'undefined') {
                this.detectionModules.anomaly = new AnomalyDetector();
            }
            if (typeof TravelPolicyEnforcer !== 'undefined') {
                this.detectionModules.travelPolicy = new TravelPolicyEnforcer();
            }
            if (typeof ReceiptForensics !== 'undefined') {
                this.detectionModules.receipt = new ReceiptForensics();
            }
            if (typeof CollusionDetector !== 'undefined') {
                this.detectionModules.collusion = new CollusionDetector();
            }
            if (typeof InvestigationManager !== 'undefined') {
                this.detectionModules.investigation = new InvestigationManager();
            }
            if (typeof FraudDatabaseConnector !== 'undefined') {
                this.detectionModules.database = new FraudDatabaseConnector();
            }
            if (typeof ModelTrainer !== 'undefined') {
                this.detectionModules.trainer = new ModelTrainer();
            }
            
            console.log('Fraud detection modules initialized:', Object.keys(this.detectionModules));
        } catch (error) {
            console.error('Error initializing modules:', error);
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // Detection settings
        const sensitivitySlider = document.getElementById('sensitivity-slider');
        if (sensitivitySlider) {
            sensitivitySlider.addEventListener('input', (e) => {
                this.sensitivity = parseInt(e.target.value);
                document.getElementById('sensitivity-value').textContent = this.sensitivity + '%';
                this.saveSettings();
            });
        }

        const thresholdSlider = document.getElementById('threshold-slider');
        if (thresholdSlider) {
            thresholdSlider.addEventListener('input', (e) => {
                this.alertThreshold = parseInt(e.target.value);
                document.getElementById('threshold-value').textContent = this.alertThreshold + '%';
                this.saveSettings();
            });
        }

        const autoInvestigationCheckbox = document.getElementById('auto-investigation');
        if (autoInvestigationCheckbox) {
            autoInvestigationCheckbox.addEventListener('change', (e) => {
                this.autoInvestigation = e.target.checked;
                this.saveSettings();
            });
        }

        const modelLearningCheckbox = document.getElementById('model-learning');
        if (modelLearningCheckbox) {
            modelLearningCheckbox.addEventListener('change', (e) => {
                this.modelLearning = e.target.checked;
                this.saveSettings();
            });
        }

        const trainModelBtn = document.getElementById('train-model-btn');
        if (trainModelBtn) {
            trainModelBtn.addEventListener('click', () => this.retrainModel());
        }

        // Modal controls
        const modals = document.querySelectorAll('.modal');
        const closeButtons = document.querySelectorAll('.modal-close');
        
        closeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal').classList.remove('active');
            });
        });

        modals.forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });

        // Action buttons
        const addVendorBtn = document.getElementById('add-vendor-btn');
        if (addVendorBtn) {
            addVendorBtn.addEventListener('click', () => {
                document.getElementById('vendor-modal').classList.add('active');
            });
        }

        const newCaseBtn = document.getElementById('new-case-btn');
        if (newCaseBtn) {
            newCaseBtn.addEventListener('click', () => {
                document.getElementById('case-modal').classList.add('active');
            });
        }

        // Upload area
        const uploadArea = document.getElementById('receipt-drop-zone');
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.style.background = 'rgba(102, 126, 234, 0.25)';
            });

            uploadArea.addEventListener('dragleave', () => {
                uploadArea.style.background = 'rgba(102, 126, 234, 0.05)';
            });

            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.style.background = 'rgba(102, 126, 234, 0.05)';
                const files = Array.from(e.dataTransfer.files);
                this.handleReceiptFiles(files);
            });

            const fileInput = document.getElementById('receipt-file');
            if (fileInput) {
                fileInput.addEventListener('change', (e) => {
                    this.handleReceiptFiles(Array.from(e.target.files));
                });
            }
        }
    }

    /**
     * Switch tab
     */
    switchTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });

        // Remove active from all nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Show selected tab
        const tabElement = document.getElementById(`${tabName}-tab`);
        if (tabElement) {
            tabElement.classList.add('active');
        }

        // Mark button as active
        document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    }

    /**
     * Analyze new expense for fraud
     */
    analyzeExpense(expense) {
        const analysisResult = {
            expenseId: expense.id,
            timestamp: new Date().toISOString(),
            riskFactors: {},
            overallRiskScore: 0,
            alerts: []
        };

        // Run through all detection modules
        for (const [key, module] of Object.entries(this.detectionModules)) {
            if (module && module.analyze && typeof module.analyze === 'function') {
                try {
                    const result = module.analyze(expense);
                    analysisResult.riskFactors[key] = result;
                    
                    if (result.riskScore > this.alertThreshold) {
                        analysisResult.alerts.push({
                            module: key,
                            riskScore: result.riskScore,
                            message: result.message,
                            severity: result.severity
                        });
                    }
                } catch (error) {
                    console.error(`Error in ${key} module:`, error);
                }
            }
        }

        // Calculate overall risk score
        const riskScores = Object.values(analysisResult.riskFactors)
            .filter(r => r && typeof r.riskScore === 'number')
            .map(r => r.riskScore);
        
        if (riskScores.length > 0) {
            analysisResult.overallRiskScore = Math.round(
                riskScores.reduce((a, b) => a + b, 0) / riskScores.length
            );
        }

        this.detections.push(analysisResult);
        
        // Handle alerts
        if (analysisResult.alerts.length > 0) {
            this.handleAlerts(analysisResult);
        }

        this.updateDashboard();
        return analysisResult;
    }

    /**
     * Handle fraud alerts
     */
    handleAlerts(analysisResult) {
        for (const alert of analysisResult.alerts) {
            this.alerts.push({
                ...alert,
                expenseId: analysisResult.expenseId,
                timestamp: analysisResult.timestamp,
                status: 'open'
            });

            // Auto-create investigation if enabled
            if (this.autoInvestigation && alert.severity === 'high') {
                if (this.detectionModules.investigation) {
                    this.detectionModules.investigation.createCase({
                        title: `Fraud Alert: ${alert.module}`,
                        description: alert.message,
                        expenseId: analysisResult.expenseId,
                        priority: 'high',
                        alerts: [alert]
                    });
                }
            }

            // Display alert UI
            this.displayAlert(alert);
        }
    }

    /**
     * Display alert in UI
     */
    displayAlert(alert) {
        const alertsContainer = document.getElementById('alerts-container');
        if (!alertsContainer) return;

        // Remove "no alerts" message if exists
        const noAlerts = alertsContainer.querySelector('.no-alerts');
        if (noAlerts) noAlerts.remove();

        const alertElement = document.createElement('div');
        alertElement.className = `alert-item ${alert.severity || 'warning'}`;
        alertElement.innerHTML = `
            <strong>${alert.module}</strong> - Risk: ${alert.riskScore}%
            <div>${alert.message}</div>
        `;

        alertsContainer.insertBefore(alertElement, alertsContainer.firstChild);

        // Limit visible alerts
        while (alertsContainer.children.length > 5) {
            alertsContainer.removeChild(alertsContainer.lastChild);
        }

        // Update alert count
        const alertsCount = document.getElementById('alerts-count');
        if (alertsCount) {
            alertsCount.textContent = this.alerts.filter(a => a.status === 'open').length;
        }
    }

    /**
     * Handle receipt files
     */
    handleReceiptFiles(files) {
        if (!this.detectionModules.receipt) return;

        for (const file of files) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = this.detectionModules.receipt.analyzeReceipt({
                    name: file.name,
                    data: e.target.result,
                    type: file.type,
                    size: file.size
                });

                // Display forensic result
                this.displayForensicResult(result);
            };
            reader.readAsDataURL(file);
        }
    }

    /**
     * Display forensic analysis result
     */
    displayForensicResult(result) {
        const forensicList = document.getElementById('forensic-list');
        if (!forensicList) return;

        const item = document.createElement('div');
        item.className = `forensic-item ${result.authentic ? 'safe' : 'warning'}`;
        
        const status = result.authentic ? '✓ Authentic' : '⚠️ Suspicious';
        const borderColor = result.authentic ? 'var(--success-color)' : 'var(--warning-color)';
        
        item.style.borderLeftColor = borderColor;
        item.innerHTML = `
            <div class="forensic-header">
                <span class="receipt-name">${result.name}</span>
                <span class="authenticity-score ${result.authentic ? 'safe' : 'suspicious'}">${status}</span>
            </div>
            <div class="forensic-details">
                <div class="detail">
                    <span>Image Manipulation</span>
                    <strong>${result.manipulation ? '✓ Detected' : 'Not Detected'}</strong>
                </div>
                <div class="detail">
                    <span>Amount Tampering</span>
                    <strong>${result.amountTampering ? '✓ Detected' : 'Not Detected'}</strong>
                </div>
                <div class="detail">
                    <span>Duplicate Detection</span>
                    <strong>${result.isDuplicate ? '⚠️ Duplicate Found' : 'Unique'}</strong>
                </div>
            </div>
        `;

        forensicList.insertBefore(item, forensicList.firstChild);
    }

    /**
     * Update dashboard statistics
     */
    updateDashboard() {
        // Update risk level
        const riskScores = this.detections
            .map(d => d.overallRiskScore)
            .filter(s => s > 0);
        
        if (riskScores.length > 0) {
            this.riskScore = Math.round(
                riskScores.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, riskScores.length)
            );
        }

        const riskLevelEl = document.getElementById('system-risk-level');
        if (riskLevelEl) {
            if (this.riskScore < 30) {
                riskLevelEl.textContent = 'LOW';
                riskLevelEl.style.color = 'var(--success-color)';
            } else if (this.riskScore < 60) {
                riskLevelEl.textContent = 'MEDIUM';
                riskLevelEl.style.color = 'var(--warning-color)';
            } else {
                riskLevelEl.textContent = 'HIGH';
                riskLevelEl.style.color = 'var(--danger-color)';
            }
        }

        const riskScoreEl = document.getElementById('risk-score');
        if (riskScoreEl) {
            riskScoreEl.textContent = this.riskScore + '%';
        }

        // Update alerts count
        const alertsCount = document.getElementById('alerts-count');
        if (alertsCount) {
            alertsCount.textContent = this.alerts.filter(a => a.status === 'open').length;
        }

        // Update cases count
        const casesCount = document.getElementById('cases-count');
        if (casesCount && this.detectionModules.investigation) {
            const openCases = this.detectionModules.investigation.cases
                .filter(c => c.status === 'open').length;
            casesCount.textContent = openCases;
        }

        // Update investigation summary
        if (this.detectionModules.investigation) {
            const casesBy Priority = this.detectionModules.investigation.getCasesByPriority();
            document.getElementById('high-priority-count').textContent = casesByPriority.high.length;
            document.getElementById('medium-priority-count').textContent = casesByPriority.medium.length;
            document.getElementById('low-priority-count').textContent = casesByPriority.low.length;
        }

        // Update detections table
        const detectionsTbody = document.getElementById('detections-tbody');
        if (detectionsTbody && this.detections.length > 0) {
            detectionsTbody.innerHTML = this.detections.slice(-10).reverse().map(d => `
                <tr>
                    <td>${Object.keys(d.riskFactors)[0] || 'Unknown'}</td>
                    <td>${d.overallRiskScore}%</td>
                    <td>${new Date(d.timestamp).toLocaleTimeString()}</td>
                    <td>${d.alerts.length > 0 ? '⚠️ Alert' : '✓ OK'}</td>
                </tr>
            `).join('');
        }
    }

    /**
     * Retrain ML models
     */
    async retrainModel() {
        if (!this.detectionModules.trainer) {
            console.log('Model trainer not available');
            return;
        }

        try {
            const trainingData = {
                detections: this.detections,
                falsePositives: this.alerts.filter(a => a.status === 'false-positive'),
                confirmedFrauds: this.alerts.filter(a => a.status === 'confirmed-fraud')
            };

            const result = await this.detectionModules.trainer.trainModel(trainingData);
            console.log('Model retrained:', result);
            
            // Show success message
            alert('Model retrained successfully!');
        } catch (error) {
            console.error('Error retraining model:', error);
            alert('Error retraining model: ' + error.message);
        }
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        const saved = localStorage.getItem('fraudDetectionSettings');
        if (saved) {
            const settings = JSON.parse(saved);
            this.sensitivity = settings.sensitivity || 50;
            this.alertThreshold = settings.alertThreshold || 75;
            this.autoInvestigation = settings.autoInvestigation !== false;
            this.modelLearning = settings.modelLearning !== false;

            // Update UI
            if (document.getElementById('sensitivity-slider')) {
                document.getElementById('sensitivity-slider').value = this.sensitivity;
                document.getElementById('sensitivity-value').textContent = this.sensitivity + '%';
            }
            if (document.getElementById('threshold-slider')) {
                document.getElementById('threshold-slider').value = this.alertThreshold;
                document.getElementById('threshold-value').textContent = this.alertThreshold + '%';
            }
            if (document.getElementById('auto-investigation')) {
                document.getElementById('auto-investigation').checked = this.autoInvestigation;
            }
            if (document.getElementById('model-learning')) {
                document.getElementById('model-learning').checked = this.modelLearning;
            }
        }
    }

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        localStorage.setItem('fraudDetectionSettings', JSON.stringify({
            sensitivity: this.sensitivity,
            alertThreshold: this.alertThreshold,
            autoInvestigation: this.autoInvestigation,
            modelLearning: this.modelLearning
        }));
    }

    /**
     * Start continuous monitoring
     */
    startMonitoring() {
        // Simulate continuous monitoring
        setInterval(() => {
            this.updateDashboard();
        }, 30000); // Update every 30 seconds
    }

    /**
     * Get fraud statistics
     */
    getStatistics() {
        return {
            totalAnalyzed: this.detections.length,
            totalAnomalies: this.detections.filter(d => d.alerts.length > 0).length,
            confirmFrauds: this.alerts.filter(a => a.status === 'confirmed-fraud').length,
            falsePositives: this.alerts.filter(a => a.status === 'false-positive').length,
            openInvestigations: this.detectionModules.investigation?.cases.filter(c => c.status === 'open').length || 0,
            avgRiskScore: Math.round(
                this.detections.reduce((sum, d) => sum + d.overallRiskScore, 0) / this.detections.length || 0
            )
        };
    }
}

// Initialize system when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.fraudDetectionSystem = new FraudDetectionSystem();
    console.log('Fraud Detection System initialized');
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FraudDetectionSystem;
}
