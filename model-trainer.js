/**
 * ML Model Trainer
 * Trains and retrains fraud detection models based on true positives and false positives
 * Implements continuous learning from detection results
 */

class ModelTrainer {
    constructor() {
        this.models = {};
        this.trainingData = {
            trueFrauds: [],
            falsePositives: [],
            legitimateTransactions: []
        };
        this.modelMetrics = {
            accuracy: 0.85,
            precision: 0.90,
            recall: 0.80,
            f1Score: 0.85
        };
        this.trainingHistory = [];
        this.loadData();
    }

    /**
     * Train model
     */
    async trainModel(trainingData) {
        try {
            console.log('Starting model training...');

            if (!trainingData || !trainingData.detections) {
                throw new Error('No training data available');
            }

            // Collect feature vectors
            const features = this.extractFeatures(trainingData);

            // Train isolation forest model
            await this.trainIsolationForest(features);

            // Train autoencoder model
            await this.trainAutoencoder(features);

            // Evaluate models
            const metrics = this.evaluateModels(features, trainingData);

            // Store training record
            this.addTrainingRecord({
                timestamp: new Date().toISOString(),
                dataSize: trainingData.detections.length,
                metrics: metrics,
                status: 'completed'
            });

            this.saveData();

            return {
                success: true,
                metrics: metrics,
                modelVersion: this.getModelVersion()
            };
        } catch (error) {
            console.error('Model training error:', error);
            throw error;
        }
    }

    /**
     * Extract features from detections
     */
    extractFeatures(trainingData) {
        const features = [];

        trainingData.detections.forEach(detection => {
            const featureVector = {
                amount: parseFloat(detection.amount) || 0,
                frequency: detection.frequency || 0,
                dayOfWeek: new Date(detection.timestamp).getDay(),
                hour: new Date(detection.timestamp).getHours(),
                vendorCentrality: detection.vendorCentrality || 0,
                typingAnomaly: detection.typingAnomaly || 0,
                mouseAnomaly: detection.mouseAnomaly || 0,
                amountDeviation: detection.amountDeviation || 0,
                frequencyDeviation: detection.frequencyDeviation || 0,
                label: detection.isFraud ? 1 : 0
            };

            features.push(featureVector);
        });

        return features;
    }

    /**
     * Train Isolation Forest model
     */
    async trainIsolationForest(features) {
        // Simplified isolation forest training
        console.log('Training Isolation Forest...');

        const fraudFeatures = features.filter(f => f.label === 1);
        const normalFeatures = features.filter(f => f.label === 0);

        // Calculate anomaly thresholds
        const thresholds = {};
        const featureKeys = Object.keys(features[0]).filter(k => k !== 'label');

        featureKeys.forEach(key => {
            const allValues = features.map(f => f[key]).filter(v => v !== undefined);
            const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
            const variance = allValues.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / allValues.length;
            const stdDev = Math.sqrt(variance);

            thresholds[key] = {
                mean: mean,
                stdDev: stdDev,
                upper: mean + (2.5 * stdDev),
                lower: mean - (2.5 * stdDev)
            };
        });

        this.models.isolationForest = {
            type: 'isolation-forest',
            thresholds: thresholds,
            fraudPatterns: this.extractPatterns(fraudFeatures),
            trainedAt: new Date().toISOString()
        };

        console.log('Isolation Forest training complete');
    }

    /**
     * Train Autoencoder model
     */
    async trainAutoencoder(features) {
        // Simplified autoencoder training
        console.log('Training Autoencoder...');

        // Normalize features
        const normalized = this.normalizeFeatures(features);

        // Build autoencoder architecture
        this.models.autoencoder = {
            type: 'autoencoder',
            layers: [
                { size: features[0] ? Object.keys(features[0]).length - 1 : 0, activation: 'relu' },
                { size: 8, activation: 'relu' },
                { size: 4, activation: 'relu' },
                { size: 8, activation: 'relu' },
                { size: features[0] ? Object.keys(features[0]).length - 1 : 0, activation: 'sigmoid' }
            ],
            encodedNormalFeatures: this.getEncodedDistribution(normalized),
            trainedAt: new Date().toISOString()
        };

        console.log('Autoencoder training complete');
    }

    /**
     * Extract fraud patterns
     */
    extractPatterns(fraudFeatures) {
        const patterns = [];

        // Amount-based patterns
        const amountRange = this.getRange(fraudFeatures.map(f => f.amount));
        patterns.push({
            type: 'amount',
            range: amountRange,
            frequency: fraudFeatures.filter(f => f.amount > amountRange.mean * 1.5).length
        });

        // Time-based patterns
        const hourPattern = {};
        fraudFeatures.forEach(f => {
            hourPattern[f.hour] = (hourPattern[f.hour] || 0) + 1;
        });
        patterns.push({
            type: 'time',
            anomalousHours: Object.entries(hourPattern)
                .filter(([_, count]) => count > fraudFeatures.length * 0.3)
                .map(([hour, _]) => hour)
        });

        // Behavioral patterns
        const behavioralMean = fraudFeatures.reduce((sum, f) => sum + f.typingAnomaly + f.mouseAnomaly, 0) / (fraudFeatures.length * 2);
        patterns.push({
            type: 'behavioral',
            avgAnomalyScore: behavioralMean,
            highAnomalyRate: fraudFeatures.filter(f => f.typingAnomaly > 50 || f.mouseAnomaly > 50).length
        });

        return patterns;
    }

    /**
     * Normalize features
     */
    normalizeFeatures(features) {
        const normalized = [];

        const featureKeys = features[0] ? Object.keys(features[0]).filter(k => k !== 'label') : [];
        const stats = {};

        // Calculate statistics
        featureKeys.forEach(key => {
            const values = features.map(f => f[key]).filter(v => v !== undefined);
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / values.length;
            const stdDev = Math.sqrt(variance);

            stats[key] = { mean, stdDev };
        });

        // Normalize
        features.forEach(feature => {
            const normalized_feature = {};
            featureKeys.forEach(key => {
                const { mean, stdDev } = stats[key];
                normalized_feature[key] = stdDev > 0 ? (feature[key] - mean) / stdDev : 0;
            });
            normalized.push(normalized_feature);
        });

        return normalized;
    }

    /**
     * Get range statistics
     */
    getRange(values) {
        const sorted = values.sort((a, b) => a - b);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        return {
            min: sorted[0],
            max: sorted[sorted.length - 1],
            mean: mean,
            stdDev: stdDev,
            q1: sorted[Math.floor(sorted.length * 0.25)],
            q3: sorted[Math.floor(sorted.length * 0.75)]
        };
    }

    /**
     * Get encoded distribution
     */
    getEncodedDistribution(normalized) {
        // Simulate encoded layer as mean of normalized features
        const distribution = {};
        if (normalized.length > 0) {
            const keys = Object.keys(normalized[0]);
            keys.forEach(key => {
                const values = normalized.map(f => f[key]);
                distribution[key] = {
                    mean: values.reduce((a, b) => a + b, 0) / values.length,
                    stdDev: Math.sqrt(
                        values.reduce((sum, x, i, arr) => {
                            const m = arr.reduce((s, a) => s + a) / arr.length;
                            return sum + Math.pow(x - m, 2);
                        }, 0) / values.length
                    )
                };
            });
        }
        return distribution;
    }

    /**
     * Evaluate models
     */
    evaluateModels(features, trainingData) {
        const predictions = this.predict(features);
        const actual = features.map(f => f.label);

        let truePositives = 0;
        let trueNegatives = 0;
        let falsePositives = 0;
        let falseNegatives = 0;

        predictions.forEach((pred, i) => {
            const predicted = pred.isFraud ? 1 : 0;
            const actualLabel = actual[i];

            if (predicted === 1 && actualLabel === 1) truePositives++;
            else if (predicted === 0 && actualLabel === 0) trueNegatives++;
            else if (predicted === 1 && actualLabel === 0) falsePositives++;
            else falseNegatives++;
        });

        const accuracy = (truePositives + trueNegatives) / (truePositives + trueNegatives + falsePositives + falseNegatives);
        const precision = truePositives / (truePositives + falsePositives || 1);
        const recall = truePositives / (truePositives + falseNegatives || 1);
        const f1 = 2 * (precision * recall) / (precision + recall || 1);

        this.modelMetrics = {
            accuracy: accuracy,
            precision: precision,
            recall: recall,
            f1Score: f1
        };

        return this.modelMetrics;
    }

    /**
     * Predict fraud
     */
    predict(features) {
        return features.map(feature => {
            let fraudScore = 0;

            if (this.models.isolationForest) {
                fraudScore += this.scoreWithIsolationForest(feature);
            }

            if (this.models.autoencoder) {
                fraudScore += this.scoreWithAutoencoder(feature);
            }

            return {
                isFraud: fraudScore > 0.5,
                score: fraudScore,
                confidenceLevel: Math.abs(fraudScore - 0.5) * 2
            };
        });
    }

    /**
     * Score with Isolation Forest
     */
    scoreWithIsolationForest(feature) {
        const thresholds = this.models.isolationForest.thresholds;
        let anomalyCount = 0;
        let totalFeatures = 0;

        Object.keys(thresholds).forEach(key => {
            if (feature[key] !== undefined) {
                totalFeatures++;
                if (feature[key] > thresholds[key].upper || feature[key] < thresholds[key].lower) {
                    anomalyCount++;
                }
            }
        });

        return totalFeatures > 0 ? anomalyCount / totalFeatures : 0;
    }

    /**
     * Score with Autoencoder
     */
    scoreWithAutoencoder(feature) {
        // Simplified reconstruction error calculation
        const encoded = this.encode(feature);
        const reconstructed = this.decode(encoded);

        const error = Object.keys(feature)
            .filter(k => k !== 'label')
            .reduce((sum, key) => {
                return sum + Math.pow(feature[key] - (reconstructed[key] || 0), 2);
            }, 0);

        // Normalize error score
        return Math.min(1, error / 100);
    }

    /**
     * Encode feature
     */
    encode(feature) {
        // Simplified encoding
        return Object.keys(feature)
            .filter(k => k !== 'label')
            .map(k => feature[k])
            .slice(0, 4);
    }

    /**
     * Decode feature
     */
    decode(encoded) {
        // Simplified decoding
        // In production, would use actual neural network operations
        return encoded.reduce((obj, val, i) => {
            obj[`feature_${i}`] = val;
            return obj;
        }, {});
    }

    /**
     * Add training record
     */
    addTrainingRecord(record) {
        this.trainingHistory.push(record);
        // Keep last 50 training records
        if (this.trainingHistory.length > 50) {
            this.trainingHistory.shift();
        }
    }

    /**
     * Get model version
     */
    getModelVersion() {
        return `v${this.trainingHistory.length}.0`;
    }

    /**
     * Get training history
     */
    getTrainingHistory() {
        return this.trainingHistory;
    }

    /**
     * Get model metrics
     */
    getModelMetrics() {
        return this.modelMetrics;
    }

    /**
     * Load data from localStorage
     */
    loadData() {
        const modelsSaved = localStorage.getItem('fraudModels');
        if (modelsSaved) {
            this.models = JSON.parse(modelsSaved);
        }

        const historySaved = localStorage.getItem('trainingHistory');
        if (historySaved) {
            this.trainingHistory = JSON.parse(historySaved);
        }
    }

    /**
     * Save data to localStorage
     */
    saveData() {
        localStorage.setItem('fraudModels', JSON.stringify(this.models));
        localStorage.setItem('trainingHistory', JSON.stringify(this.trainingHistory));
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModelTrainer;
}
