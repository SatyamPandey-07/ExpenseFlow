/**
 * Device Verification UI JavaScript
 * Handles device attestation and trust scoring
 */

class DeviceVerification {
    constructor() {
        this.deviceId = null;
        this.selectedProvider = 'FALLBACK';
        this.deviceFingerprint = null;
        
        this.init();
    }

    async init() {
        // Generate device ID and fingerprint
        this.deviceId = await this.generateDeviceId();
        this.deviceFingerprint = await this.generateFingerprint();
        
        // Display device info
        this.displayDeviceInfo();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Check existing attestation
        this.checkExistingAttestation();
    }

    setupEventListeners() {
        // Method selection
        document.querySelectorAll('.method-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.method-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.selectedProvider = card.dataset.provider;
            });
        });

        // Select default method
        const defaultCard = document.querySelector('.method-card[data-default="true"]');
        if (defaultCard) defaultCard.classList.add('selected');

        // Verify button
        document.getElementById('verify-btn').addEventListener('click', () => {
            this.performAttestation();
        });

        // Check status button
        document.getElementById('check-status-btn').addEventListener('click', () => {
            this.checkVerificationStatus();
        });
    }

    async generateDeviceId() {
        // Try to get from storage
        let deviceId = localStorage.getItem('expenseflow_device_id');
        
        if (!deviceId) {
            // Generate new device ID
            deviceId = this.generateUUID();
            localStorage.setItem('expenseflow_device_id', deviceId);
        }
        
        return deviceId;
    }

    async generateFingerprint() {
        const components = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screenResolution: `${screen.width}x${screen.height}`,
            colorDepth: screen.colorDepth,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            hardwareConcurrency: navigator.hardwareConcurrency || null,
            deviceMemory: navigator.deviceMemory || null,
            cookiesEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack,
            
            // Canvas fingerprint
            canvasFingerprint: await this.getCanvasFingerprint(),
            
            // WebGL fingerprint
            webglFingerprint: this.getWebGLFingerprint(),
            
            // Fonts
            fontsDetected: await this.detectFonts(),
            
            // Plugins
            plugins: Array.from(navigator.plugins || []).map(p => p.name),
            
            // Touch support
            touchSupport: 'ontouchstart' in window,
            maxTouchPoints: navigator.maxTouchPoints || 0,
            
            // Automation detection
            webdriver: navigator.webdriver === true,
            automationControlled: window.navigator.webdriver === true,
            
            // Behavioral
            mouseMovements: 0,
            keyboardActivity: 0,
            scrollActivity: 0
        };

        // Store combined fingerprint
        const fingerprintString = JSON.stringify(components);
        const fingerprintHash = await this.hashString(fingerprintString);
        
        return {
            hash: fingerprintHash,
            components
        };
    }

    async getCanvasFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('ExpenseFlow', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('ExpenseFlow', 4, 17);
            
            const dataURL = canvas.toDataURL();
            return await this.hashString(dataURL);
        } catch (error) {
            return null;
        }
    }

    getWebGLFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            
            if (!gl) return null;
            
            const info = {
                vendor: gl.getParameter(gl.VENDOR),
                renderer: gl.getParameter(gl.RENDERER),
                version: gl.getParameter(gl.VERSION)
            };
            
            return JSON.stringify(info);
        } catch (error) {
            return null;
        }
    }

    async detectFonts() {
        const baseFonts = ['monospace', 'sans-serif', 'serif'];
        const testFonts = ['Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia'];
        const detected = [];

        const testString = 'mmmmmmmmmmlli';
        const testSize = '72px';

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Get baseline widths
        const baselineWidths = {};
        baseFonts.forEach(baseFont => {
            ctx.font = `${testSize} ${baseFont}`;
            baselineWidths[baseFont] = ctx.measureText(testString).width;
        });

        // Test each font
        testFonts.forEach(font => {
            let detected = false;
            
            baseFonts.forEach(baseFont => {
                ctx.font = `${testSize} '${font}', ${baseFont}`;
                const width = ctx.measureText(testString).width;
                
                if (width !== baselineWidths[baseFont]) {
                    detected = true;
                }
            });
            
            if (detected) {
                detected.push(font);
            }
        });

        return detected;
    }

    async hashString(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    displayDeviceInfo() {
        document.getElementById('device-id').textContent = this.deviceId.substring(0, 16) + '...';
        document.getElementById('platform').textContent = navigator.platform;
        document.getElementById('browser').textContent = this.getBrowserName();
    }

    getBrowserName() {
        const ua = navigator.userAgent;
        if (ua.includes('Firefox')) return 'Firefox';
        if (ua.includes('Chrome')) return 'Chrome';
        if (ua.includes('Safari')) return 'Safari';
        if (ua.includes('Edge')) return 'Edge';
        return 'Unknown';
    }

    async performAttestation() {
        const btn = document.getElementById('verify-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Verifying...';

        try {
            let attestationData = {};

            // Prepare attestation data based on provider
            if (this.selectedProvider === 'WEBAUTHENTICATION') {
                attestationData = await this.prepareWebAuthnData();
            } else if (this.selectedProvider === 'TPM') {
                attestationData = await this.prepareTPMData();
            } else {
                attestationData = this.prepareFallbackData();
            }

            // Send attestation request
            const response = await fetch('/api/device-attestation/attest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': this.deviceId
                },
                body: JSON.stringify({
                    provider: this.selectedProvider,
                    deviceId: this.deviceId,
                    attestationData
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccess('Device verified successfully!');
                this.displayAttestationResult(result);
                
                // Update device info
                document.getElementById('trust-score').textContent = result.attestation.trustScore;
                document.getElementById('attestation-status').textContent = result.attestation.status;
                document.getElementById('attestation-status').className = `badge badge-${result.attestation.status.toLowerCase()}`;
                
                // Load trust details
                await this.loadTrustDetails();
            } else {
                this.showError(result.error || 'Verification failed');
            }

        } catch (error) {
            this.showError('Verification error: ' + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">✓</span> Verify This Device';
        }
    }

    async prepareWebAuthnData() {
        // In production, use WebAuthn API
        // This is a simplified version
        return {
            credentialId: this.generateUUID(),
            publicKey: this.deviceFingerprint.hash,
            authenticatorData: await this.hashString(navigator.userAgent),
            userAgent: navigator.userAgent,
            navigator: {
                webdriver: navigator.webdriver,
                platform: navigator.platform,
                userAgent: navigator.userAgent
            },
            hardwareConcurrency: navigator.hardwareConcurrency,
            screen: {
                width: screen.width,
                height: screen.height,
                colorDepth: screen.colorDepth
            },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    }

    async prepareTPMData() {
        // TPM attestation requires native integration
        // This is a placeholder
        return {
            aikCertificate: 'SIMULATED_AIK_CERT',
            platformHash: this.deviceFingerprint.hash,
            pcrs: {
                0: await this.hashString('PCR0'),
                1: await this.hashString('PCR1'),
                2: await this.hashString('PCR2')
            }
        };
    }

    prepareFallbackData() {
        return {
            deviceFingerprint: this.deviceFingerprint.hash,
            ...this.deviceFingerprint.components
        };
    }

    async checkExistingAttestation() {
        try {
            const response = await fetch(`/api/device-attestation/verify/${this.deviceId}`);
            const result = await response.json();

            if (result.valid && result.attestation) {
                document.getElementById('trust-score').textContent = result.attestation.trustScore;
                document.getElementById('attestation-status').textContent = result.attestation.status;
                document.getElementById('attestation-status').className = `badge badge-${result.attestation.status.toLowerCase()}`;
                
                await this.loadTrustDetails();
            }
        } catch (error) {
            console.error('Error checking attestation:', error);
        }
    }

    async checkVerificationStatus() {
        await this.checkExistingAttestation();
        this.showInfo('Verification status updated');
    }

    async loadTrustDetails() {
        try {
            const response = await fetch(`/api/device-attestation/trust-component/${this.deviceId}`);
            const data = await response.json();

            if (data.success) {
                // Show trust details section
                document.getElementById('trust-details').style.display = 'block';

                // Update trust components
                const components = data.components;
                this.updateTrustBar('attestation', components.attestation.score);
                this.updateTrustBar('stability', components.stability.score);
                this.updateTrustBar('behavioral', components.behavioral.score);
                this.updateTrustBar('historical', components.historical.score);

                // Show risk factors if any
                if (data.integrityFailures && data.integrityFailures.length > 0) {
                    this.displayRiskFactors(data.integrityFailures);
                }

                // Show recommendations
                if (data.recommendations && data.recommendations.length > 0) {
                    this.displayRecommendations(data.recommendations);
                }
            }
        } catch (error) {
            console.error('Error loading trust details:', error);
        }
    }

    updateTrustBar(component, score) {
        const fill = document.getElementById(`trust-${component}`);
        const scoreEl = document.getElementById(`score-${component}`);
        
        if (fill && scoreEl) {
            fill.style.width = `${score}%`;
            fill.className = `component-fill ${this.getScoreClass(score)}`;
            scoreEl.textContent = score;
        }
    }

    getScoreClass(score) {
        if (score >= 80) return 'high';
        if (score >= 60) return 'medium';
        if (score >= 40) return 'low';
        return 'critical';
    }

    displayRiskFactors(factors) {
        const container = document.getElementById('risk-factors');
        const list = document.getElementById('risk-list');
        
        list.innerHTML = factors.map(factor => `
            <div class="risk-item ${factor.severity.toLowerCase()}">
                <span class="risk-type">${factor.type}</span>
                <span class="risk-desc">${factor.description}</span>
                <span class="risk-severity">${factor.severity}</span>
            </div>
        `).join('');
        
        container.style.display = 'block';
    }

    displayRecommendations(recommendations) {
        const container = document.getElementById('recommendations');
        const list = document.getElementById('recommendation-list');
        
        list.innerHTML = recommendations.map(rec => `
            <div class="recommendation-item ${rec.priority.toLowerCase()}">
                <span class="rec-priority">${rec.priority}</span>
                <span class="rec-message">${rec.message}</span>
            </div>
        `).join('');
        
        container.style.display = 'block';
    }

    displayAttestationResult(result) {
        const msg = `
            <div class="result-card success">
                <h3>✓ Verification Successful</h3>
                <p>Trust Score: <strong>${result.attestation.trustScore}</strong></p>
                <p>Provider: ${result.attestation.provider}</p>
                <p>Valid Until: ${new Date(result.attestation.validUntil).toLocaleString()}</p>
            </div>
        `;
        document.getElementById('status-messages').innerHTML = msg;
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showInfo(message) {
        this.showMessage(message, 'info');
    }

    showMessage(message, type) {
        const container = document.getElementById('status-messages');
        const msg = document.createElement('div');
        msg.className = `message ${type}`;
        msg.textContent = message;
        container.appendChild(msg);

        setTimeout(() => {
            msg.remove();
        }, 5000);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    new DeviceVerification();
});
