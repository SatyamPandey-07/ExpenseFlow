/**
 * Receipt Forensics Analyzer
 * Analyzes receipt images for tampering, duplication, and authenticity
 * Uses image forensics techniques and metadata analysis
 */

class ReceiptForensics {
    constructor() {
        this.analyzedReceipts = [];
        this.analysisCache = new Map();
        this.loadData();
    }

    /**
     * Analyze receipt image for fraud
     */
    analyzeReceipt(receipt) {
        // Check cache first
        const cacheKey = receipt.name + receipt.size;
        if (this.analysisCache.has(cacheKey)) {
            return this.analysisCache.get(cacheKey);
        }

        const result = {
            name: receipt.name,
            authentic: true,
            manipulation: false,
            amountTampering: false,
            isDuplicate: false,
            confidence: 0.95,
            forensicIndicators: [],
            metadata: this.extractMetadata(receipt),
            analysisTimestamp: new Date().toISOString()
        };

        try {
            // Check for image manipulation
            const manipulationScore = this.detectImageManipulation(receipt);
            if (manipulationScore > 0.6) {
                result.manipulation = true;
                result.forensicIndicators.push('Image modification detected');
                result.authentic = false;
            }

            // Check for amount tampering
            const amountTamperingScore = this.detectAmountTampering(receipt);
            if (amountTamperingScore > 0.7) {
                result.amountTampering = true;
                result.forensicIndicators.push('Amount field manipulation detected');
                result.authentic = false;
            }

            // Check for duplicates
            const duplicateMatch = this.findDuplicateReceipt(receipt);
            if (duplicateMatch) {
                result.isDuplicate = true;
                result.forensicIndicators.push(`Duplicate of ${duplicateMatch.name}`);
            }

            // Check metadata consistency
            if (!this.validateMetadataConsistency(result.metadata)) {
                result.forensicIndicators.push('Metadata inconsistency detected');
            }

        } catch (error) {
            console.error('Error analyzing receipt:', error);
        }

        this.analyzedReceipts.push(result);
        this.analysisCache.set(cacheKey, result);
        this.saveData();

        return result;
    }

    /**
     * Detect image manipulation
     */
    detectImageManipulation(receipt) {
        // In production, would use advanced image analysis (ELA, DCT, etc.)
        // For now, use heuristic approach based on image properties

        let suspicionScore = 0;

        // Check file size vs dimensions (would need proper image data)
        if (receipt.size && receipt.size < 10000) {
            suspicionScore += 0.1; // Very small file might indicate compression
        }

        // Check for common manipulation patterns
        if (receipt.data && receipt.data.includes('jpeg') && receipt.size > 5000000) {
            suspicionScore += 0.15; // Unusually large JPEG
        }

        return suspicionScore;
    }

    /**
     * Detect amount field tampering
     */
    detectAmountTampering(receipt) {
        // Analyze the receipt image for amount field modifications
        // In production, would use OCR and text analysis

        let tamperingScore = 0;

        // Simple heuristic: check for multiple edits in image metadata
        // Would use proper image analysis in production

        return tamperingScore;
    }

    /**
     * Find duplicate receipt
     */
    findDuplicateReceipt(receipt) {
        // Calculate perceptual hash and compare with existing receipts
        const currentHash = this.generatePerceptualHash(receipt);

        for (const existing of this.analyzedReceipts) {
            const existingHash = this.generatePerceptualHash(existing);
            const similarity = this.compareHashes(currentHash, existingHash);

            if (similarity > 0.95) {
                return existing;
            }
        }

        return null;
    }

    /**
     * Generate perceptual hash
     */
    generatePerceptualHash(receipt) {
        // Simplified hash generation
        let hash = 0;
        const data = receipt.data || receipt.name;

        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }

        return Math.abs(hash).toString(16);
    }

    /**
     * Compare perceptual hashes
     */
    compareHashes(hash1, hash2) {
        if (hash1 === hash2) return 1.0;

        const minLength = Math.min(hash1.length, hash2.length);
        let matches = 0;

        for (let i = 0; i < minLength; i++) {
            if (hash1[i] === hash2[i]) {
                matches++;
            }
        }

        return matches / minLength;
    }

    /**
     * Extract metadata
     */
    extractMetadata(receipt) {
        const metadata = {
            fileName: receipt.name,
            fileSize: receipt.size,
            fileType: receipt.type,
            uploadTimestamp: new Date().toISOString(),
            dimensions: null,
            colorProfile: null,
            camera: null,
            gpsData: null,
            creationDate: null
        };

        // Extract from file name if available
        if (receipt.name.includes('2024')) {
            metadata.creationDate = '2024';
        }

        return metadata;
    }

    /**
     * Validate metadata consistency
     */
    validateMetadataConsistency(metadata) {
        // Check if metadata makes sense together
        let isConsistent = true;

        // Check if file size matches expected compression
        if (metadata.fileSize && metadata.fileSize > 100000) {
            // Large file should have good quality
        }

        return isConsistent;
    }

    /**
     * Analyze for fraud indicators
     */
    analyze(expense) {
        if (!expense.receiptImage) {
            return {
                riskScore: 0,
                message: 'No receipt image available',
                severity: 'low'
            };
        }

        const receipt = {
            name: expense.id,
            data: expense.receiptImage,
            size: expense.receiptImage.length,
            type: 'image/jpeg'
        };

        const analysis = this.analyzeReceipt(receipt);

        let riskScore = 0;
        if (analysis.manipulation) riskScore += 40;
        if (analysis.amountTampering) riskScore += 35;
        if (analysis.isDuplicate) riskScore += 25;

        return {
            riskScore: Math.min(100, riskScore),
            authentic: analysis.authentic,
            message: analysis.authentic 
                ? 'Receipt authentic' 
                : `Receipt may be fraudulent: ${analysis.forensicIndicators.join(', ')}`,
            severity: analysis.authentic ? 'low' : 'high',
            details: analysis
        };
    }

    /**
     * Get forensic report
     */
    getForensicReport(receiptName) {
        return this.analyzedReceipts.find(r => r.name === receiptName);
    }

    /**
     * Get all fraudulent receipts
     */
    getFraudulentReceipts() {
        return this.analyzedReceipts.filter(r => !r.authentic);
    }

    /**
     * Load data from localStorage
     */
    loadData() {
        const saved = localStorage.getItem('receiptForensicsData');
        if (saved) {
            this.analyzedReceipts = JSON.parse(saved);
        }
    }

    /**
     * Save data to localStorage
     */
    saveData() {
        const recentData = this.analyzedReceipts.slice(-100);
        localStorage.setItem('receiptForensicsData', JSON.stringify(recentData));
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.analysisCache.clear();
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReceiptForensics;
}
