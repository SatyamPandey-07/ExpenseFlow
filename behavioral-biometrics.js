/**
 * Behavioral Biometrics Module
 * Analyzes typing patterns, mouse movements, and behavioral signatures
 * Detects unusual behavior patterns that may indicate fraud or account compromise
 */

class BehavioralBiometrics {
    constructor() {
        this.baselineData = {
            typingSpeed: 0,
            typingAccuracy: 0,
            mouseVelocity: 0,
            clickFrequency: 0,
            scrollBehavior: 0,
            sessionPatterns: []
        };

        this.currentSession = {
            startTime: Date.now(),
            keystrokes: 0,
            clicks: 0,
            scrolls: 0,
            mouseMoves: 0,
            tabChanges: 0,
            typingPatterns: [],
            mousePatterns: [],
            anomalyScore: 0
        };

        this.baselineThresholds = {
            typingSpeedVariance: 0.3,
            mouseVelocityVariance: 0.25,
            clickFrequencyVariance: 0.4,
            sessionDurationVariance: 0.5
        };

        this.init();
    }

    /**
     * Initialize behavioral biometrics
     */
    init() {
        this.setupEventListeners();
        this.loadBaseline();
        this.displayMetrics();
    }

    /**
     * Setup event listeners for behavioral tracking
     */
    setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (e) => this.trackKeyDown(e));
        document.addEventListener('keyup', (e) => this.trackKeyUp(e));

        // Mouse events
        document.addEventListener('mousemove', (e) => this.trackMouseMove(e));
        document.addEventListener('click', (e) => this.trackClick(e));
        document.addEventListener('scroll', (e) => this.trackScroll(e));

        // Window events
        window.addEventListener('blur', () => this.trackTabChange());
        window.addEventListener('focus', () => this.trackTabChange());

        // Form input for typing analysis
        const inputs = document.querySelectorAll('input[type="text"], textarea');
        inputs.forEach(input => {
            input.addEventListener('input', (e) => this.analyzeTyping(e));
        });
    }

    /**
     * Track key down event
     */
    trackKeyDown(event) {
        this.currentSession.keystrokes++;
        
        if (!this.lastKeyDownTime) {
            this.lastKeyDownTime = Date.now();
        }
    }

    /**
     * Track key up event
     */
    trackKeyUp(event) {
        const currentTime = Date.now();
        const keystrokeInterval = currentTime - (this.lastKeyDownTime || currentTime);
        
        this.currentSession.typingPatterns.push({
            key: event.key,
            interval: keystrokeInterval,
            timestamp: currentTime
        });

        this.lastKeyDownTime = currentTime;

        // Calculate keystroke dynamics (dwell time and flight time)
        if (this.currentSession.typingPatterns.length > 2) {
            const recentPatterns = this.currentSession.typingPatterns.slice(-10);
            const avgIntervalTime = recentPatterns.reduce((sum, p) => sum + p.interval, 0) / recentPatterns.length;
            
            this.currentSession.typingSpeed = Math.round(60000 / (avgIntervalTime || 1)); // WPM
        }
    }

    /**
     * Track mouse movement
     */
    trackMouseMove(event) {
        this.currentSession.mouseMoves++;

        if (!this.lastMousePos) {
            this.lastMousePos = { x: event.clientX, y: event.clientY };
            return;
        }

        const currentPos = { x: event.clientX, y: event.clientY };
        const distance = Math.sqrt(
            Math.pow(currentPos.x - this.lastMousePos.x, 2) +
            Math.pow(currentPos.y - this.lastMousePos.y, 2)
        );

        const currentTime = Date.now();
        const timeDiff = currentTime - (this.lastMouseTime || currentTime);
        const velocity = timeDiff > 0 ? distance / timeDiff * 1000 : 0; // pixels per second

        this.currentSession.mousePatterns.push({
            x: currentPos.x,
            y: currentPos.y,
            velocity: velocity,
            timestamp: currentTime
        });

        this.lastMousePos = currentPos;
        this.lastMouseTime = currentTime;

        // Calculate average mouse velocity
        if (this.currentSession.mousePatterns.length > 0) {
            const recentMoves = this.currentSession.mousePatterns.slice(-20);
            const velocities = recentMoves.map(m => m.velocity).filter(v => v > 0);
            this.currentSession.mouseVelocity = velocities.length > 0
                ? Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length)
                : 0;
        }
    }

    /**
     * Track mouse click
     */
    trackClick(event) {
        this.currentSession.clicks++;
        this.currentSession.clickFrequency = this.currentSession.clicks / ((Date.now() - this.currentSession.startTime) / 60000);
    }

    /**
     * Track scroll events
     */
    trackScroll(event) {
        this.currentSession.scrolls++;
        this.currentSession.scrollBehavior = this.currentSession.scrolls / ((Date.now() - this.currentSession.startTime) / 60000);
    }

    /**
     * Track tab changes
     */
    trackTabChange() {
        this.currentSession.tabChanges++;
    }

    /**
     * Analyze typing behavior
     */
    analyzeTyping(event) {
        const input = event.target;
        const value = input.value;

        // Calculate typing metrics
        const typingSpeed = this.calculateTypingSpeed();
        const typingAccuracy = this.calculateTypingAccuracy(value);

        this.currentSession.typingSpeed = typingSpeed;
        this.currentSession.typingAccuracy = typingAccuracy;
    }

    /**
     * Calculate typing speed
     */
    calculateTypingSpeed() {
        if (this.currentSession.typingPatterns.length < 2) return 0;

        const recentPatterns = this.currentSession.typingPatterns.slice(-50);
        const avgInterval = recentPatterns.reduce((sum, p) => sum + p.interval, 0) / recentPatterns.length;
        
        // Convert to words per minute (average word = 5 characters)
        return Math.round((60000 / (avgInterval || 1)) / 5);
    }

    /**
     * Calculate typing accuracy
     */
    calculateTypingAccuracy(text) {
        if (!text) return 100;

        // Simple heuristic based on common typing errors
        const suspiciousPatterns = [
            { pattern: /(.)\1{3,}/g, weight: 0.1 }, // Repeated characters
            { pattern: /[A-Z]{3,}/g, weight: 0.05 } // Consecutive capitals
        ];

        let errorScore = 0;
        suspiciousPatterns.forEach(p => {
            const matches = text.match(p.pattern);
            if (matches) {
                errorScore += matches.length * p.weight;
            }
        });

        return Math.max(0, Math.round(100 - (errorScore * 10)));
    }

    /**
     * Calculate behavioral anomaly score
     */
    calculateAnomalyScore() {
        const score = {
            typing: this.calculateTypingAnomaly(),
            mouse: this.calculateMouseAnomaly(),
            click: this.calculateClickAnomaly(),
            scroll: this.calculateScrollAnomaly(),
            session: this.calculateSessionAnomaly()
        };

        const weights = {
            typing: 0.25,
            mouse: 0.20,
            click: 0.15,
            scroll: 0.10,
            session: 0.30
        };

        return Object.keys(score).reduce((total, key) => {
            return total + (score[key] * weights[key]);
        }, 0);
    }

    /**
     * Calculate typing anomaly
     */
    calculateTypingAnomaly() {
        if (!this.baselineData.typingSpeed) return 0;

        const deviation = Math.abs(
            (this.currentSession.typingSpeed - this.baselineData.typingSpeed) / 
            this.baselineData.typingSpeed
        );

        return Math.min(100, deviation * 100);
    }

    /**
     * Calculate mouse movement anomaly
     */
    calculateMouseAnomaly() {
        if (!this.baselineData.mouseVelocity || this.baselineData.mouseVelocity === 0) return 0;

        const deviation = Math.abs(
            (this.currentSession.mouseVelocity - this.baselineData.mouseVelocity) /
            this.baselineData.mouseVelocity
        );

        return Math.min(100, deviation * 100);
    }

    /**
     * Calculate click frequency anomaly
     */
    calculateClickAnomaly() {
        if (!this.baselineData.clickFrequency) return 0;

        const deviation = Math.abs(
            (this.currentSession.clickFrequency - this.baselineData.clickFrequency) /
            this.baselineData.clickFrequency
        );

        return Math.min(100, deviation * 100);
    }

    /**
     * Calculate scroll behavior anomaly
     */
    calculateScrollAnomaly() {
        if (!this.baselineData.scrollBehavior) return 0;

        const deviation = Math.abs(
            (this.currentSession.scrollBehavior - this.baselineData.scrollBehavior) /
            this.baselineData.scrollBehavior
        );

        return Math.min(100, deviation * 100);
    }

    /**
     * Calculate session-level anomaly
     */
    calculateSessionAnomaly() {
        const sessionDuration = (Date.now() - this.currentSession.startTime) / 60000; // minutes
        
        // Check for unusual session patterns
        let anomalyScore = 0;

        // Rapid-fire clicks might indicate automation
        if (this.currentSession.clickFrequency > 50) {
            anomalyScore += 20;
        }

        // Unusual keystroke-to-click ratio
        const keystrokeClickRatio = this.currentSession.keystrokes / (this.currentSession.clicks || 1);
        if (keystrokeClickRatio < 2 || keystrokeClickRatio > 20) {
            anomalyScore += 15;
        }

        // Many tab changes might indicate distraction or suspicious activity
        if (this.currentSession.tabChanges > 10) {
            anomalyScore += 10;
        }

        return Math.min(100, anomalyScore);
    }

    /**
     * Analyze expense for behavioral anomalies
     */
    analyze(expense) {
        const anomalyScore = this.calculateAnomalyScore();
        const riskScore = Math.round(anomalyScore);

        return {
            riskScore: riskScore,
            anomalyScore: anomalyScore,
            message: `Behavioral anomaly detected: ${riskScore}% deviation from baseline`,
            severity: riskScore > 70 ? 'high' : riskScore > 40 ? 'medium' : 'low',
            details: {
                typingSpeed: this.currentSession.typingSpeed,
                mouseVelocity: this.currentSession.mouseVelocity,
                clickFrequency: Math.round(this.currentSession.clickFrequency),
                sessionDuration: Math.round((Date.now() - this.currentSession.startTime) / 1000)
            }
        };
    }

    /**
     * Update baseline from current session
     */
    updateBaseline() {
        // Use exponential moving average to update baseline
        const alpha = 0.3; // Learning rate

        this.baselineData.typingSpeed = 
            alpha * this.currentSession.typingSpeed + 
            (1 - alpha) * this.baselineData.typingSpeed;

        this.baselineData.mouseVelocity = 
            alpha * this.currentSession.mouseVelocity + 
            (1 - alpha) * this.baselineData.mouseVelocity;

        this.baselineData.clickFrequency = 
            alpha * this.currentSession.clickFrequency + 
            (1 - alpha) * this.baselineData.clickFrequency;

        this.baselineData.scrollBehavior = 
            alpha * this.currentSession.scrollBehavior + 
            (1 - alpha) * this.baselineData.scrollBehavior;

        this.saveBaseline();
    }

    /**
     * Load baseline from localStorage
     */
    loadBaseline() {
        const saved = localStorage.getItem('behavioralBaseline');
        if (saved) {
            this.baselineData = JSON.parse(saved);
        } else {
            // Initialize with default values if no baseline exists
            this.baselineData = {
                typingSpeed: 60,
                typingAccuracy: 95,
                mouseVelocity: 300,
                clickFrequency: 3,
                scrollBehavior: 2,
                sessionPatterns: []
            };
        }
    }

    /**
     * Save baseline to localStorage
     */
    saveBaseline() {
        localStorage.setItem('behavioralBaseline', JSON.stringify(this.baselineData));
    }

    /**
     * Display metrics in UI
     */
    displayMetrics() {
        // Update typing pattern metrics
        const typingScaleEl = document.getElementById('typing-score');
        if (typingScaleEl) {
            const deviationScore = 100 - this.calculateTypingAnomaly();
            typingScaleEl.textContent = Math.round(deviationScore) + '%';
        }

        const baselineMatchEl = document.getElementById('baseline-match');
        if (baselineMatchEl) {
            baselineMatchEl.textContent = Math.round(100 - this.calculateSessionAnomaly()) + '%';
        }

        const typingAnomalyEl = document.getElementById('typing-anomaly');
        if (typingAnomalyEl) {
            const anomaly = this.calculateTypingAnomaly();
            if (anomaly < 30) {
                typingAnomalyEl.textContent = 'LOW';
                typingAnomalyEl.className = 'safe';
            } else if (anomaly < 60) {
                typingAnomalyEl.textContent = 'MEDIUM';
                typingAnomalyEl.className = 'warning';
            } else {
                typingAnomalyEl.textContent = 'HIGH';
                typingAnomalyEl.className = 'danger';
            }
        }

        // Update mouse pattern metrics
        const mouseScoreEl = document.getElementById('mouse-score');
        if (mouseScoreEl) {
            const deviationScore = 100 - this.calculateMouseAnomaly();
            mouseScoreEl.textContent = Math.round(deviationScore) + '%';
        }

        const velocityEl = document.getElementById('velocity-baseline');
        if (velocityEl) {
            velocityEl.textContent = Math.round(100 - (this.calculateMouseAnomaly() / 2)) + '%';
        }

        const mouseAnomalyEl = document.getElementById('mouse-anomaly');
        if (mouseAnomalyEl) {
            const anomaly = this.calculateMouseAnomaly();
            if (anomaly < 30) {
                mouseAnomalyEl.textContent = 'LOW';
                mouseAnomalyEl.className = 'safe';
            } else if (anomaly < 60) {
                mouseAnomalyEl.textContent = 'MEDIUM';
                mouseAnomalyEl.className = 'warning';
            } else {
                mouseAnomalyEl.textContent = 'HIGH';
                mouseAnomalyEl.className = 'danger';
            }
        }

        // Update session behavior
        document.getElementById('session-duration').textContent = 
            this.formatTime((Date.now() - this.currentSession.startTime) / 1000);
        document.getElementById('click-count').textContent = this.currentSession.clicks.toLocaleString();
        document.getElementById('keystroke-count').textContent = this.currentSession.keystrokes.toLocaleString();
        document.getElementById('scroll-count').textContent = this.currentSession.scrolls;
        document.getElementById('movement-count').textContent = this.currentSession.mouseMoves.toLocaleString();
        document.getElementById('tab-changes').textContent = this.currentSession.tabChanges;

        // Update periodically
        setTimeout(() => this.displayMetrics(), 5000);
    }

    /**
     * Format time
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}m ${secs}s`;
    }

    /**
     * Reset session
     */
    resetSession() {
        this.updateBaseline();
        this.currentSession = {
            startTime: Date.now(),
            keystrokes: 0,
            clicks: 0,
            scrolls: 0,
            mouseMoves: 0,
            tabChanges: 0,
            typingPatterns: [],
            mousePatterns: [],
            anomalyScore: 0
        };
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BehavioralBiometrics;
}
