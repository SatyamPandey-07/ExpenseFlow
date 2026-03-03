/**
 * Network-Aware Data Fetching - Adaptive Loading Strategy
 * Adjusts data loading based on network conditions (speed, type, battery)
 */

class NetworkAwareDataFetch {
    constructor() {
        this.networkInfo = {
            isOnline: navigator.onLine,
            effectiveType: navigator.connection?.effectiveType,
            downlink: navigator.connection?.downlink,
            rtt: navigator.connection?.rtt,
            saveData: navigator.connection?.saveData
        };
        this.fetchStrategies = new Map();
        this.cache = new Map();
        this.mediaLoadCache = new Map();
        this.quality = {
            image: 'medium',
            video: 'auto',
            data: 'normal'
        };
    }

    /**
     * Initialize network monitoring
     */
    async init() {
        // Listen to network changes
        if (navigator.connection) {
            navigator.connection.addEventListener('change', () => {
                this.updateNetworkInfo();
                this.adjustQuality();
            });
        }

        window.addEventListener('online', () => {
            this.networkInfo.isOnline = true;
            this.adjustQuality();
        });

        window.addEventListener('offline', () => {
            this.networkInfo.isOnline = false;
            this.adjustQuality();
        });

        // Check battery status
        if (navigator.getBattery) {
            this.monitorBattery();
        }

        console.log('Network-aware fetching initialized');
        console.log('Network info:', this.networkInfo);
    }

    /**
     * Update network information
     */
    updateNetworkInfo() {
        if (navigator.connection) {
            this.networkInfo.effectiveType = navigator.connection.effectiveType;
            this.networkInfo.downlink = navigator.connection.downlink;
            this.networkInfo.rtt = navigator.connection.rtt;
            this.networkInfo.saveData = navigator.connection.saveData;
        }

        console.log('Network info updated:', this.networkInfo);
    }

    /**
     * Monitor battery status
     */
    async monitorBattery() {
        try {
            const battery = await navigator.getBattery();

            battery.addEventListener('levelchange', () => {
                if (battery.level < 0.2) {
                    // Low battery mode
                    this.quality.image = 'low';
                    this.quality.data = 'minimal';
                }
            });

            battery.addEventListener('chargingtimechange', () => {
                if (battery.chargingTime === Infinity) {
                    // Discharging, use lower quality
                    this.quality.image = 'low';
                }
            });

        } catch (error) {
            console.warn('Battery monitoring not available:', error);
        }
    }

    /**
     * Adaptive fetch based on network conditions
     */
    async fetch(url, options = {}) {
        const strategy = this.selectStrategy();

        console.log(`Fetching ${url} with strategy: ${strategy}`);

        return this.strategizedFetch(url, options, strategy);
    }

    /**
     * Select fetch strategy based on network
     */
    selectStrategy() {
        const { isOnline, effectiveType, saveData } = this.networkInfo;

        if (!isOnline) {
            return 'offline';
        }

        if (saveData) {
            return 'minimal';
        }

        switch (effectiveType) {
            case '4g':
                return 'aggressive';
            case '3g':
                return 'balanced';
            case '2g':
            case 'slow-2g':
                return 'conservative';
            default:
                return 'balanced';
        }
    }

    /**
     * Execute fetch with selected strategy
     */
    async strategizedFetch(url, options, strategy) {
        try {
            // Check cache first
            if (options.method === 'GET' && this.cache.has(url)) {
                const cached = this.cache.get(url);
                if (Date.now() - cached.timestamp < (options.cacheDuration || 300000)) {
                    console.log(`Serving from cache: ${url}`);
                    return new Response(JSON.stringify(cached.data), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json', 'X-From-Cache': 'true' }
                    });
                }
            }

            // Apply strategy-specific settings
            const headers = this.getStrategyHeaders(strategy, options.headers);
            const timeout = this.getStrategyTimeout(strategy);

            // Fetch with timeout and cancellation
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(url, {
                    ...options,
                    headers,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                // Cache GET responses
                if (response.ok && options.method === 'GET' && response.headers.get('Content-Type')?.includes('application/json')) {
                    const data = await response.clone().json();
                    this.cache.set(url, {
                        data,
                        timestamp: Date.now()
                    });
                }

                return response;

            } catch (error) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    throw new Error(`Request timeout (${timeout}ms)`);
                }
                throw error;
            }

        } catch (error) {
            console.error(`Fetch failed: ${url}`, error);

            // Try fallback strategies
            if (strategy !== 'offline') {
                return this.tryFallback(url, options, strategy);
            }

            throw error;
        }
    }

    /**
     * Try fallback strategies
     */
    async tryFallback(url, options, currentStrategy) {
        const fallbacks = {
            'aggressive': ['balanced', 'conservative', 'offline'],
            'balanced': ['conservative', 'offline'],
            'conservative': ['offline']
        };

        const fallbackStrategies = fallbacks[currentStrategy] || [];

        for (const fallbackStrategy of fallbackStrategies) {
            try {
                console.log(`Trying fallback strategy: ${fallbackStrategy}`);
                const response = await this.strategizedFetch(url, options, fallbackStrategy);
                return response;
            } catch (error) {
                console.warn(`Fallback ${fallbackStrategy} failed:`, error);
                continue;
            }
        }

        throw new Error(`All fetch strategies failed for ${url}`);
    }

    /**
     * Get strategy-specific headers
     */
    getStrategyHeaders(strategy, customHeaders = {}) {
        const headers = { ...customHeaders };

        switch (strategy) {
            case 'aggressive':
                // Request full quality
                headers['X-Quality'] = 'high';
                headers['X-Format'] = 'full';
                break;
            case 'balanced':
                headers['X-Quality'] = 'medium';
                headers['X-Format'] = 'compressed';
                break;
            case 'conservative':
                // Request minimal data
                headers['X-Quality'] = 'low';
                headers['X-Format'] = 'minimal';
                headers['Accept-Encoding'] = 'gzip, deflate';
                break;
            case 'minimal':
                headers['Save-Data'] = 'on';
                headers['X-Quality'] = 'low';
                break;
            case 'offline':
                // Only use cache
                headers['Cache-Control'] = 'only-if-cached';
                break;
        }

        return headers;
    }

    /**
     * Get strategy-specific timeout
     */
    getStrategyTimeout(strategy) {
        const timeouts = {
            'aggressive': 30000, // 30 seconds
            'balanced': 20000,   // 20 seconds
            'conservative': 10000, // 10 seconds
            'minimal': 8000,     // 8 seconds
            'offline': 0         // No timeout for cached requests
        };

        return timeouts[strategy] || 15000;
    }

    /**
     * Fetch images with adaptive optimization
     */
    async fetchImage(url, containerWidth = 320) {
        try {
            // Determine quality based on strategy
            const strategy = this.selectStrategy();
            const qualityUrl = this.optimizeImageUrl(url, strategy, containerWidth);

            console.log(`Fetching image: ${qualityUrl}`);

            const response = await fetch(qualityUrl);
            if (!response.ok) {
                throw new Error(`Image fetch failed: ${response.status}`);
            }

            return await response.blob();

        } catch (error) {
            console.error('Image fetch failed:', error);
            // Return placeholder or fallback
            throw error;
        }
    }

    /**
     * Optimize image URL for strategy
     */
    optimizeImageUrl(url, strategy, containerWidth) {
        // Add query parameters for image optimization
        const separator = url.includes('?') ? '&' : '?';

        const params = { format: 'webp', width: containerWidth };

        switch (strategy) {
            case 'aggressive':
                params.quality = '95';
                break;
            case 'balanced':
                params.quality = '75';
                params.width = Math.min(containerWidth, 800);
                break;
            case 'conservative':
            case 'minimal':
                params.quality = '50';
                params.width = Math.min(containerWidth, 400);
                break;
        }

        const queryString = Object.entries(params)
            .map(([key, value]) => `${key}=${value}`)
            .join('&');

        return `${url}${separator}${queryString}`;
    }

    /**
     * Progressive image loading
     */
    async loadProgressiveImage(url, containerElement) {
        try {
            // Load low-quality placeholder first
            const placeholderUrl = this.optimizeImageUrl(url, 'minimal', 100);
            const placeholderBlob = await this.fetchImage(placeholderUrl, 100);
            const placeholderUrl2 = URL.createObjectURL(placeholderBlob);

            const img = document.createElement('img');
            img.src = placeholderUrl2;
            img.style.filter = 'blur(10px)';
            containerElement.appendChild(img);

            // Load medium quality in background
            const mediumUrl = this.optimizeImageUrl(url, 'balanced', 320);
            const mediumBlob = await this.fetchImage(mediumUrl, 320);
            const mediumUrl2 = URL.createObjectURL(mediumBlob);

            img.src = mediumUrl2;
            img.style.filter = 'none';

            // Load full quality if on good connection
            if (this.networkInfo.effectiveType === '4g') {
                const fullBlob = await this.fetchImage(url);
                const fullUrl = URL.createObjectURL(fullBlob);
                img.src = fullUrl;
            }

        } catch (error) {
            console.error('Progressive image loading failed:', error);
        }
    }

    /**
     * Batch fetch with adaptive parallelization
     */
    async batchFetch(urls, options = {}) {
        const strategy = this.selectStrategy();
        const parallelLimit = this.getParallelLimit(strategy);

        const results = [];
        const promises = [];

        for (let i = 0; i < urls.length; i += parallelLimit) {
            const batch = urls.slice(i, i + parallelLimit);

            const batchResults = await Promise.allSettled(
                batch.map(url => this.fetch(url, options))
            );

            results.push(...batchResults);
        }

        return results;
    }

    /**
     * Get parallel request limit based on strategy
     */
    getParallelLimit(strategy) {
        const limits = {
            'aggressive': 6,
            'balanced': 4,
            'conservative': 2,
            'minimal': 1,
            'offline': 0
        };

        return limits[strategy] || 4;
    }

    /**
     * Prefetch resources
     */
    async prefetch(urls) {
        try {
            // Only prefetch on good connections
            if (this.networkInfo.effectiveType !== '4g') {
                return [];
            }

            const results = await Promise.allSettled(
                urls.map(url => this.fetch(url, { cacheDuration: 3600000 }))
            );

            console.log(`Prefetched ${urls.length} resources`);
            return results;

        } catch (error) {
            console.error('Prefetch failed:', error);
        }
    }

    /**
     * Adjust quality based on network conditions
     */
    adjustQuality() {
        const strategy = this.selectStrategy();

        switch (strategy) {
            case 'aggressive':
                this.quality.image = 'high';
                this.quality.video = '1080p';
                this.quality.data = 'full';
                break;
            case 'balanced':
                this.quality.image = 'medium';
                this.quality.video = '720p';
                this.quality.data = 'normal';
                break;
            case 'conservative':
            case 'minimal':
                this.quality.image = 'low';
                this.quality.video = '480p';
                this.quality.data = 'minimal';
                break;
            case 'offline':
                this.quality.image = 'thumbnail';
                this.quality.video = 'none';
                this.quality.data = 'cached';
                break;
        }

        console.log('Quality adjusted:', this.quality);
    }

    /**
     * Get network status
     */
    getStatus() {
        return {
            isOnline: this.networkInfo.isOnline,
            effectiveType: this.networkInfo.effectiveType,
            currentStrategy: this.selectStrategy(),
            quality: this.quality,
            cacheSize: this.cache.size,
            rtt: this.networkInfo.rtt,
            downlink: this.networkInfo.downlink,
            saveData: this.networkInfo.saveData
        };
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        console.log('Cache cleared');
    }

    /**
     * Set custom cache duration
     */
    setCacheDuration(url, duration) {
        if (this.cache.has(url)) {
            const cached = this.cache.get(url);
            cached.duration = duration;
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        let totalSize = 0;

        for (const [url, { data }] of this.cache) {
            totalSize += JSON.stringify(data).length;
        }

        return {
            entries: this.cache.size,
            estimatedSizeKB: Math.round(totalSize / 1024),
            urls: Array.from(this.cache.keys())
        };
    }
}

// Initialize global instance
const networkAwareDataFetch = new NetworkAwareDataFetch();
