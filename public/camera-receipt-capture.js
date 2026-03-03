/**
 * Camera & Receipt Capture - Native Camera Integration
 * Handles receipt capture, image processing, and OCR
 */

class CameraReceiptCapture {
    constructor() {
        this.cameraStream = null;
        this.videoElement = null;
        this.canvasElement = null;
        this.isCapturing = false;
        this.supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.() || {};
        this.cameraPermissionGranted = false;
    }

    /**
     * Initialize camera capture
     */
    async init() {
        try {
            const permissions = await navigator.permissions?.query({ name: 'camera' });
            if (permissions) {
                this.cameraPermissionGranted = permissions.state === 'granted';
                permissions.addEventListener('change', () => {
                    this.cameraPermissionGranted = permissions.state === 'granted';
                });
            }
            console.log('Camera capture initialized');
        } catch (error) {
            console.error('Camera initialization failed:', error);
        }
    }

    /**
     * Start camera stream
     */
    async startCamera(videoElement, constraints = {}) {
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('Camera API not supported');
            }

            // Default constraints for mobile
            const defaultConstraints = {
                video: {
                    facingMode: 'environment', // Rear camera
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };

            const finalConstraints = { ...defaultConstraints, ...constraints };

            this.cameraStream = await navigator.mediaDevices.getUserMedia(finalConstraints);
            this.videoElement = videoElement;
            this.videoElement.srcObject = this.cameraStream;

            // Play video
            await this.videoElement.play();

            // Add auto-focus
            if (this.supportedConstraints['focusMode']) {
                const track = this.cameraStream.getVideoTracks()[0];
                const settings = track.getSettings();
                if (settings.focusMode) {
                    try {
                        await track.applyConstraints({
                            advanced: [{ focusMode: 'continuous' }]
                        });
                    } catch (error) {
                        console.warn('Auto-focus not supported:', error);
                    }
                }
            }

            this.isCapturing = true;
            console.log('Camera started successfully');

            return this.cameraStream;

        } catch (error) {
            console.error('Failed to start camera:', error);
            throw this.handleCameraError(error);
        }
    }

    /**
     * Stop camera stream
     */
    stopCamera() {
        if (this.cameraStream) {
            this.cameraStream.getTracks().forEach(track => track.stop());
            this.cameraStream = null;
            this.isCapturing = false;
            console.log('Camera stopped');
        }
    }

    /**
     * Capture photo from video stream
     */
    async capturePhoto() {
        if (!this.videoElement) {
            throw new Error('Camera not initialized');
        }

        if (!this.canvasElement) {
            this.canvasElement = document.createElement('canvas');
        }

        const context = this.canvasElement.getContext('2d');
        this.canvasElement.width = this.videoElement.videoWidth;
        this.canvasElement.height = this.videoElement.videoHeight;

        context.drawImage(this.videoElement, 0, 0);

        return this.canvasElement.toDataURL('image/jpeg', 0.8);
    }

    /**
     * Capture photo with flash effect (visual only)
     */
    async capturePhotoWithFlash() {
        try {
            // Start with normal capture
            const photo = await this.capturePhoto();

            // Apply flash effect
            if (this.videoElement && this.canvasElement) {
                const context = this.canvasElement.getContext('2d');
                context.fillStyle = 'rgba(255, 255, 255, 0.5)';
                context.fillRect(0, 0, this.canvasElement.width, this.canvasElement.height);
            }

            return photo;

        } catch (error) {
            console.error('Flash capture failed:', error);
            throw error;
        }
    }

    /**
     * Process receipt image (compress and optimize)
     */
    async processReceiptImage(imageData, options = {}) {
        const {
            quality = 0.7,
            maxWidth = 1280,
            maxHeight = 1280,
            autoOrientation = true
        } = options;

        try {
            return await this.compressImage(imageData, {
                quality,
                maxWidth,
                maxHeight,
                autoOrientation
            });
        } catch (error) {
            console.error('Receipt processing failed:', error);
            throw error;
        }
    }

    /**
     * Compress image
     */
    async compressImage(imageData, options = {}) {
        const {
            quality = 0.7,
            maxWidth = 1280,
            maxHeight = 1280
        } = options;

        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                try {
                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width = Math.round(width * ratio);
                        height = Math.round(height * ratio);
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const compressed = canvas.toDataURL('image/jpeg', quality);
                    resolve(compressed);

                } catch (error) {
                    reject(error);
                }
            };

            img.onerror = () => reject(new Error('Image loading failed'));
            img.src = imageData;
        });
    }

    /**
     * Extract text from receipt image (requires API)
     */
    async extractReceiptText(imageData) {
        try {
            const response = await fetch('/api/receipts/ocr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: imageData })
            });

            if (!response.ok) {
                throw new Error(`OCR failed: ${response.status}`);
            }

            const result = await response.json();
            return result;

        } catch (error) {
            console.error('OCR extraction failed:', error);
            throw error;
        }
    }

    /**
     * Parse receipt data into expense fields
     */
    async parseReceipt(receiptData) {
        const {
            image,
            ocrText = '',
            vendor = '',
            amount = 0,
            date = new Date().toISOString().split('T')[0],
            category = 'uncategorized'
        } = receiptData;

        try {
            // Try OCR if enabled
            let extractedData = {};
            if (ocrText) {
                extractedData = this.smartParseOCR(ocrText);
            }

            return {
                vendor: extractedData.vendor || vendor,
                amount: extractedData.amount || amount,
                date: extractedData.date || date,
                category: extractedData.category || category,
                description: extractedData.description || '',
                receipt: {
                    image,
                    uploadedAt: new Date().toISOString(),
                    format: 'image/jpeg'
                },
                confidence: extractedData.confidence || 0.5
            };

        } catch (error) {
            console.error('Receipt parsing failed:', error);
            throw error;
        }
    }

    /**
     * Smart parse OCR text
     */
    smartParseOCR(text) {
        const parsed = {
            vendor: '',
            amount: 0,
            date: '',
            category: 'uncategorized',
            description: '',
            confidence: 0
        };

        if (!text) return parsed;

        // Extract amount (look for currency patterns)
        const amountMatch = text.match(/[$£€₹]\s?(\d+\.?\d*)|(\d+\.?\d*)\s?[$£€₹]/);
        if (amountMatch) {
            parsed.amount = parseFloat(amountMatch[1] || amountMatch[2]);
        }

        // Extract date
        const dateMatch = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        if (dateMatch) {
            const [, day, month, year] = dateMatch;
            const fullYear = parseInt(year) < 100 ? 2000 + parseInt(year) : parseInt(year);
            parsed.date = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }

        // Try to identify vendor (usually at top)
        const lines = text.split('\n');
        if (lines.length > 0) {
            parsed.vendor = lines[0].trim().substring(0, 50);
        }

        // Categorize based on keywords
        const categoryMap = {
            'food|restaurant|cafe|pizza|burger|lunch|dinner|breakfast': 'Food',
            'gas|petrol|fuel|station': 'Transportation',
            'hotel|motel|lodging|accommodation|room': 'Travel',
            'pharmacy|medicine|drug|medical': 'Healthcare',
            'movie|cinema|theater|entertainment|ticket': 'Entertainment',
            'grocery|supermarket|shopping': 'Groceries'
        };

        for (const [keywords, category] of Object.entries(categoryMap)) {
            if (new RegExp(keywords, 'i').test(text)) {
                parsed.category = category;
                parsed.confidence = 0.8;
                break;
            }
        }

        parsed.description = text.substring(0, 200); // Store first 200 chars as description

        return parsed;
    }

    /**
     * Save receipt to database
     */
    async saveReceipt(expenseId, receiptData) {
        try {
            const receipt = {
                expenseId,
                image: receiptData.image,
                vendor: receiptData.vendor,
                amount: receiptData.amount,
                date: receiptData.date,
                category: receiptData.category,
                description: receiptData.description,
                uploadedAt: new Date().toISOString(),
                synced: false
            };

            const receiptId = await offlineDB.saveReceipt(receipt);

            // Queue for sync
            await backgroundSyncManager.queueOperation('syncReceipt', receipt);

            return receiptId;

        } catch (error) {
            console.error('Failed to save receipt:', error);
            throw error;
        }
    }

    /**
     * Handle camera errors
     */
    handleCameraError(error) {
        if (error.name === 'NotAllowedError') {
            return new Error('Camera permission denied');
        } else if (error.name === 'NotFoundError') {
            return new Error('No camera device found');
        } else if (error.name === 'NotReadableError') {
            return new Error('Camera is in use by another application');
        } else if (error.name === 'SecurityError') {
            return new Error('Camera access requires HTTPS');
        }
        return error;
    }

    /**
     * Check camera capabilities
     */
    async checkCameraCapabilities() {
        const capabilities = {
            hasCamera: !!(navigator.mediaDevices?.getUserMedia),
            hasPermission: this.cameraPermissionGranted,
            supportedConstraints: this.supportedConstraints,
            facingModes: [],
            resolutions: []
        };

        if (navigator.mediaDevices?.enumerateDevices) {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                capabilities.cameraCount = devices.filter(d => d.kind === 'videoinput').length;
            } catch (error) {
                console.warn('Could not enumerate devices:', error);
            }
        }

        return capabilities;
    }

    /**
     * Take multiple photos for receipt (burst mode)
     */
    async takePhotoBurst(count = 3, interval = 500) {
        const photos = [];

        try {
            for (let i = 0; i < count; i++) {
                const photo = await this.capturePhoto();
                photos.push(photo);

                if (i < count - 1) {
                    await new Promise(resolve => setTimeout(resolve, interval));
                }
            }

            return photos;

        } catch (error) {
            console.error('Burst capture failed:', error);
            throw error;
        }
    }
}

// Initialize global instance
const cameraReceiptCapture = new CameraReceiptCapture();
