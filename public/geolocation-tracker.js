/**
 * Geolocation Tracking - Location tagging for expenses
 * Tracks expense location and provides location-based insights
 */

class GeolocationTracker {
    constructor() {
        this.currentPosition = null;
        this.watchId = null;
        this.isTracking = false;
        this.locationHistory = [];
        this.geofences = [];
        this.permissionGranted = false;
        this.accuracy = 50; // Default accuracy in meters
    }

    /**
     * Initialize geolocation tracking
     */
    async init() {
        try {
            const permissions = await navigator.permissions?.query({ name: 'geolocation' });
            if (permissions) {
                this.permissionGranted = permissions.state === 'granted';
                permissions.addEventListener('change', () => {
                    this.permissionGranted = permissions.state === 'granted';
                });
            }
            console.log('Geolocation tracker initialized');
        } catch (error) {
            console.error('Geolocation init failed:', error);
        }
    }

    /**
     * Request location permission
     */
    async requestLocationPermission() {
        try {
            if (!navigator.geolocation) {
                throw new Error('Geolocation API not supported');
            }

            // Try to get position (this will prompt for permission)
            return new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        this.permissionGranted = true;
                        resolve(true);
                    },
                    (error) => {
                        this.permissionGranted = false;
                        reject(error);
                    }
                );
            });
        } catch (error) {
            console.error('Permission request failed:', error);
            throw error;
        }
    }

    /**
     * Get current location (one-time)
     */
    async getCurrentLocation(options = {}) {
        const {
            enableHighAccuracy = true,
            timeout = 10000,
            maximumAge = 0
        } = options;

        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }

            const watchId = navigator.geolocation.watchPosition(
                (position) => {
                    navigator.geolocation.clearWatch(watchId);

                    this.currentPosition = this.formatPosition(position);
                    this.locationHistory.push(this.currentPosition);

                    resolve(this.currentPosition);
                },
                (error) => {
                    nav.geolocation.clearWatch(watchId);
                    reject(this.handleGeolocationError(error));
                },
                {
                    enableHighAccuracy,
                    timeout,
                    maximumAge
                }
            );
        });
    }

    /**
     * Start continuous location tracking
     */
    async startTracking(options = {}) {
        const {
            enableHighAccuracy = true,
            timeout = 10000,
            maximumAge = 5000
        } = options;

        try {
            if (!navigator.geolocation) {
                throw new Error('Geolocation not supported');
            }

            if (this.isTracking) {
                console.warn('Already tracking location');
                return;
            }

            this.isTracking = true;
            this.watchId = navigator.geolocation.watchPosition(
                (position) => this.onLocationUpdate(position),
                (error) => this.onLocationError(error),
                {
                    enableHighAccuracy,
                    timeout,
                    maximumAge
                }
            );

            console.log('Location tracking started');

        } catch (error) {
            this.isTracking = false;
            console.error('Failed to start tracking:', error);
            throw error;
        }
    }

    /**
     * Stop location tracking
     */
    stopTracking() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
            this.isTracking = false;
            console.log('Location tracking stopped');
        }
    }

    /**
     * Handle location update
     */
    onLocationUpdate(position) {
        this.currentPosition = this.formatPosition(position);
        this.locationHistory.push(this.currentPosition);

        // Keep only last 100 locations to save memory
        if (this.locationHistory.length > 100) {
            this.locationHistory.shift();
        }

        // Check geofences
        this.checkGeofences(this.currentPosition);
    }

    /**
     * Handle location error
     */
    onLocationError(error) {
        console.error('Location tracking error:', this.handleGeolocationError(error));
    }

    /**
     * Format position data
     */
    formatPosition(position) {
        const { coords, timestamp } = position;

        return {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            altitude: coords.altitude,
            altitudeAccuracy: coords.altitudeAccuracy,
            heading: coords.heading,
            speed: coords.speed,
            timestamp: new Date(timestamp).toISOString(),
            unixTimestamp: Math.floor(timestamp / 1000)
        };
    }

    /**
     * Tag expense with location
     */
    async tagExpenseWithLocation(expenseId) {
        try {
            if (!this.currentPosition) {
                await this.getCurrentLocation();
            }

            const location = {
                expenseId,
                ...this.currentPosition
            };

            const locationId = await offlineDB.saveLocation(location);

            // Queue for sync
            await backgroundSyncManager.queueOperation('syncLocation', location);

            return locationId;

        } catch (error) {
            console.error('Failed to tag expense location:', error);
            throw error;
        }
    }

    /**
     * Get location history for expense
     */
    async getExpenseLocation(expenseId) {
        try {
            return await offlineDB.getLocationByExpenseId(expenseId);
        } catch (error) {
            console.error('Failed to get expense location:', error);
            return null;
        }
    }

    /**
     * Add geofence
     */
    addGeofence(name, latitude, longitude, radiusM = 100) {
        const geofence = {
            id: Date.now().toString(),
            name,
            latitude,
            longitude,
            radiusM,
            createdAt: new Date().toISOString()
        };

        this.geofences.push(geofence);
        return geofence.id;
    }

    /**
     * Remove geofence
     */
    removeGeofence(geofenceId) {
        this.geofences = this.geofences.filter(g => g.id !== geofenceId);
    }

    /**
     * Check active geofences
     */
    checkGeofences(position) {
        const { latitude, longitude } = position;

        for (const geofence of this.geofences) {
            const distance = this.calculateDistance(
                latitude,
                longitude,
                geofence.latitude,
                geofence.longitude
            );

            if (distance <= geofence.radiusM) {
                this.onGeofenceEnter(geofence, distance);
            }
        }
    }

    /**
     * Handle geofence entry
     */
    onGeofenceEnter(geofence, distance) {
        console.log(`Entered geofence: ${geofence.name} (${Math.round(distance)}m away)`);

        // Emit event for UI
        window.dispatchEvent(new CustomEvent('geofenceEnter', {
            detail: { geofence, distance }
        }));
    }

    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth's radius in meters
        const φ1 = (lat1 * Math.PI) / 180;
        const φ2 = (lat2 * Math.PI) / 180;
        const Δφ = ((lat2 - lat1) * Math.PI) / 180;
        const Δλ = ((lon2 - lon1) * Math.PI) / 180;

        const a = Math.sin(Δφ / 2) ** 2 +
                  Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        return distance;
    }

    /**
     * Get location name from coordinates (reverse geocoding)
     */
    async getLocationName(latitude, longitude) {
        try {
            const response = await fetch(
                `/api/geocode/reverse?lat=${latitude}&lon=${longitude}`
            );

            if (!response.ok) {
                throw new Error('Reverse geocoding failed');
            }

            const data = await response.json();
            return data.address || `${latitude}, ${longitude}`;

        } catch (error) {
            console.error('Reverse geocoding failed:', error);
            return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        }
    }

    /**
     * Get coordinates from location name (forward geocoding)
     */
    async getCoordinatesFromName(locationName) {
        try {
            const response = await fetch(
                `/api/geocode/forward?address=${encodeURIComponent(locationName)}`
            );

            if (!response.ok) {
                throw new Error('Forward geocoding failed');
            }

            const data = await response.json();
            return {
                latitude: data.latitude,
                longitude: data.longitude,
                accuracy: data.accuracy
            };

        } catch (error) {
            console.error('Forward geocoding failed:', error);
            throw error;
        }
    }

    /**
     * Group expenses by location
     */
    groupExpensesByLocation(expenses, radiusM = 1000) {
        const clusters = [];

        for (const expense of expenses) {
            if (!expense.location) continue;

            let found = false;

            // Check if expense belongs to existing cluster
            for (const cluster of clusters) {
                const distance = this.calculateDistance(
                    expense.location.latitude,
                    expense.location.longitude,
                    cluster.centerLat,
                    cluster.centerLon
                );

                if (distance <= radiusM) {
                    cluster.expenses.push(expense);
                    found = true;
                    break;
                }
            }

            // Create new cluster if needed
            if (!found) {
                clusters.push({
                    centerLat: expense.location.latitude,
                    centerLon: expense.location.longitude,
                    expenses: [expense]
                });
            }
        }

        return clusters;
    }

    /**
     * Get location statistics
     */
    getLocationStats() {
        if (this.locationHistory.length === 0) {
            return null;
        }

        const positions = this.locationHistory;
        const lats = positions.map(p => p.latitude);
        const lons = positions.map(p => p.longitude);

        const avgLat = lats.reduce((a, b) => a + b) / lats.length;
        const avgLon = lons.reduce((a, b) => a + b) / lons.length;

        const distances = [];
        for (let i = 1; i < positions.length; i++) {
            const distance = this.calculateDistance(
                positions[i - 1].latitude,
                positions[i - 1].longitude,
                positions[i].latitude,
                positions[i].longitude
            );
            distances.push(distance);
        }

        const totalDistance = distances.reduce((a, b) => a + b, 0);

        return {
            lastLocation: positions[positions.length - 1],
            centerLocation: { latitude: avgLat, longitude: avgLon },
            totalDistance: Math.round(totalDistance),
            totalLocations: positions.length,
            averageAccuracy: Math.round(
                positions.reduce((sum, p) => sum + p.accuracy, 0) / positions.length
            )
        };
    }

    /**
     * Handle geolocation errors
     */
    handleGeolocationError(error) {
        if (error.code === 1) {
            return new Error('Location permission denied');
        } else if (error.code === 2) {
            return new Error('Location position unavailable');
        } else if (error.code === 3) {
            return new Error('Location request timeout');
        }
        return new Error('Unknown location error');
    }

    /**
     * Check geolocation support
     */
    isSupported() {
        return !!(navigator.geolocation);
    }

    /**
     * Get tracking status
     */
    getStatus() {
        return {
            isSupported: this.isSupported(),
            isTracking: this.isTracking,
            permissionGranted: this.permissionGranted,
            currentPosition: this.currentPosition,
            geofenceCount: this.geofences.length,
            locationHistoryCount: this.locationHistory.length
        };
    }
}

// Initialize global instance
const geolocationTracker = new GeolocationTracker();
