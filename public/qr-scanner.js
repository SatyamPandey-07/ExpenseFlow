/**
 * QR Code Scanner - BarcodeDetector API + Fallback
 * Scans QR codes for vendor check-in and expense tracking
 */

class QRCodeScanner {
    constructor() {
        this.isSupported = false;
        this.barcodeDetector = null;
        this.cameraStream = null;
        this.videoElement = null;
        this.canvasElement = null;
        this.isScanning = false;
        this.scanCallback = null;
    }

    /**
     * Initialize QR code scanner
     */
    async init() {
        try {
            // Check BarcodeDetector API
            if ('BarcodeDetector' in window) {
                try {
                    this.barcodeDetector = new BarcodeDetector({
                        formats: ['qr_code']
                    });
                    this.isSupported = true;
                    console.log('BarcodeDetector API available');
                } catch (error) {
                    console.warn('BarcodeDetector not available, using fallback');
                }
            }

            if (!this.isSupported) {
                console.log('Using canvas-based QR code detection');
            }
        } catch (error) {
            console.error('QR scanner init failed:', error);
        }
    }

    /**
     * Start QR code scanning
     */
    async startScanning(videoElement, callback) {
        try {
            if (this.isScanning) {
                console.warn('Already scanning');
                return;
            }

            this.videoElement = videoElement;
            this.scanCallback = callback;

            // Start camera
            this.cameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });

            this.videoElement.srcObject = this.cameraStream;
            await this.videoElement.play();

            this.isScanning = true;

            // Start detection loop
            if (this.isSupported && this.barcodeDetector) {
                this.scanWithBarcodeDetector();
            } else {
                this.scanWithCanvas();
            }

            console.log('QR code scanning started');

        } catch (error) {
            console.error('Failed to start scanning:', error);
            throw error;
        }
    }

    /**
     * Stop QR code scanning
     */
    stopScanning() {
        this.isScanning = false;

        if (this.cameraStream) {
            this.cameraStream.getTracks().forEach(track => track.stop());
            this.cameraStream = null;
        }

        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }

        console.log('QR code scanning stopped');
    }

    /**
     * Scan using BarcodeDetector API
     */
    async scanWithBarcodeDetector() {
        while (this.isScanning) {
            try {
                const barcodes = await this.barcodeDetector.detect(this.videoElement);

                if (barcodes.length > 0) {
                    for (const barcode of barcodes) {
                        if (barcode.format === 'qr_code') {
                            await this.handleDetection(barcode.rawValue);
                            return; // Stop after first detection
                        }
                    }
                }

                // Continue scanning
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error('Barcode detection error:', error);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }

    /**
     * Scan using canvas fallback (jsQR library would be needed)
     */
    async scanWithCanvas() {
        if (!this.canvasElement) {
            this.canvasElement = document.createElement('canvas');
        }

        const context = this.canvasElement.getContext('2d', { willReadFrequently: true });

        while (this.isScanning) {
            try {
                this.canvasElement.width = this.videoElement.videoWidth;
                this.canvasElement.height = this.videoElement.videoHeight;

                context.drawImage(this.videoElement, 0, 0);

                // Note: Requires jsQR library to be loaded
                if (typeof jsQR !== 'undefined') {
                    const imageData = context.getImageData(
                        0, 0,
                        this.canvasElement.width,
                        this.canvasElement.height
                    );

                    const qrCode = jsQR(imageData.data, imageData.width, imageData.height);

                    if (qrCode) {
                        await this.handleDetection(qrCode.data);
                        return;
                    }
                }

                // Continue scanning
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error('Canvas scan error:', error);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }

    /**
     * Handle QR code detection
     */
    async handleDetection(qrData) {
        console.log('QR Code detected:', qrData);

        try {
            // Parse QR data
            const parsed = this.parseQRData(qrData);

            // Call scan callback
            if (this.scanCallback) {
                await this.scanCallback(parsed);
            }

            // Stop scanning after detection
            this.isScanning = false;

        } catch (error) {
            console.error('QR handling error:', error);
        }
    }

    /**
     * Parse QR code data
     */
    parseQRData(qrData) {
        try {
            // Try to parse as JSON
            try {
                return JSON.parse(qrData);
            } catch (e) {
                // Not JSON, treat as URL or text
            }

            // Check if it's a URL
            if (qrData.startsWith('http')) {
                return {
                    type: 'url',
                    data: qrData,
                    url: qrData
                };
            }

            // Parse as vendor data string (vendor_id:location_id:timestamp format)
            if (qrData.includes(':')) {
                const parts = qrData.split(':');
                return {
                    type: 'vendor_checkin',
                    vendorId: parts[0],
                    locationId: parts[1],
                    timestamp: parts[2],
                    raw: qrData
                };
            }

            // Default: treat as identifier
            return {
                type: 'text',
                data: qrData,
                raw: qrData
            };

        } catch (error) {
            console.error('QR parsing error:', error);
            return {
                type: 'unknown',
                raw: qrData
            };
        }
    }

    /**
     * Generate QR code for expense
     */
    async generateExpenseQR(expenseId, containerId) {
        try {
            // Requires QRCode library
            if (typeof QRCode === 'undefined') {
                throw new Error('QRCode library not loaded');
            }

            const qrContainer = document.getElementById(containerId);
            if (!qrContainer) {
                throw new Error(`Container ${containerId} not found`);
            }

            // Clear previous QR
            qrContainer.innerHTML = '';

            // Generate QR data
            const qrData = JSON.stringify({
                type: 'expense',
                expenseId,
                timestamp: new Date().toISOString(),
                app: 'ExpenseFlow'
            });

            // Create QR code
            new QRCode(qrContainer, {
                text: qrData,
                width: 200,
                height: 200,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });

            return qrData;

        } catch (error) {
            console.error('QR generation failed:', error);
            throw error;
        }
    }

    /**
     * Generate vendor check-in QR
     */
    async generateVendorQR(vendorId, locationId, containerId) {
        try {
            if (typeof QRCode === 'undefined') {
                throw new Error('QRCode library not loaded');
            }

            const qrContainer = document.getElementById(containerId);
            if (!qrContainer) {
                throw new Error(`Container ${containerId} not found`);
            }

            qrContainer.innerHTML = '';

            const qrData = `${vendorId}:${locationId}:${Date.now()}`;

            new QRCode(qrContainer, {
                text: qrData,
                width: 200,
                height: 200,
                colorDark: '#667eea',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });

            return qrData;

        } catch (error) {
            console.error('Vendor QR generation failed:', error);
            throw error;
        }
    }

    /**
     * Scan and auto-tag expense with vendor
     */
    async scanAndTagExpense(expenseId) {
        return new Promise(async (resolve, reject) => {
            try {
                const videoElement = document.createElement('video');
                videoElement.style.display = 'none';
                document.body.appendChild(videoElement);

                await this.startScanning(videoElement, async (parsed) => {
                    videoElement.remove();

                    if (parsed.type === 'vendor_checkin') {
                        // Tag expense with vendor
                        const expense = {
                            id: expenseId,
                            vendorId: parsed.vendorId,
                            vendorLocationId: parsed.locationId,
                            scanTime: new Date().toISOString()
                        };

                        await backgroundSyncManager.queueOperation('updateExpense', expense);

                        resolve({
                            success: true,
                            vendor: parsed.vendorId,
                            location: parsed.locationId
                        });
                    } else {
                        reject(new Error('Invalid vendor QR code'));
                    }
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Batch scan and tag expenses
     */
    async batchScanExpenses(expenseIds, containerSelector) {
        const results = [];

        for (const expenseId of expenseIds) {
            try {
                const result = await this.scanAndTagExpense(expenseId);
                results.push({
                    expenseId,
                    ...result
                });
            } catch (error) {
                results.push({
                    expenseId,
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Get QR code format info
     */
    getFormatInfo(format) {
        const formats = {
            'qr_code': {
                name: 'QR Code',
                maxCapacity: 4296,
                supportedCharsets: ['alphanumeric', 'byte', 'kanji'],
                errorCorrection: 'up to 30%'
            },
            'code_128': {
                name: 'Code 128',
                maxCapacity: 48,
                supportedCharsets: ['ASCII']
            },
            'ean_13': {
                name: 'EAN-13',
                maxCapacity: 13,
                supportedCharsets: ['numeric']
            }
        };

        return formats[format] || null;
    }

    /**
     * Check scanner capabilities
     */
    async getCapabilities() {
        return {
            supported: this.isSupported,
            barcodeDetectorAvailable: !!this.barcodeDetector,
            cameraAvailable: !!(navigator.mediaDevices?.getUserMedia),
            isScanning: this.isScanning
        };
    }

    /**
     * Test QR code format
     */
    isValidQRFormat(qrData) {
        try {
            // Try JSON parse
            try {
                JSON.parse(qrData);
                return true;
            } catch (e) {}

            // Check format patterns
            if (qrData.startsWith('http')) return true;
            if (qrData.match(/^\w+:\w+:\d+$/)) return true; // vendor format
            if (qrData.length > 0 && qrData.length < 2953) return true; // QR capacity

            return false;

        } catch (error) {
            return false;
        }
    }

    /**
     * Handle scan errors
     */
    handleScanError(error) {
        if (error.name === 'NotAllowedError') {
            return new Error('Camera permissions denied');
        } else if (error.name === 'NotFoundError') {
            return new Error('No camera device found');
        }
        return error;
    }
}

// Initialize global instance
const qrCodeScanner = new QRCodeScanner();
