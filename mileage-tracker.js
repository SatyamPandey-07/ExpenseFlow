/**
 * Mileage Tracker Module
 * Tracks business mileage with IRS standard rates for tax deductions
 */

class MileageTracker {
    constructor() {
        this.trips = [];
        this.irsRates = this.initializeIRSRates();
        this.loadTrips();
    }

    /**
     * Initialize IRS standard mileage rates by year
     */
    initializeIRSRates() {
        return {
            2026: {
                business: 0.67,
                medical: 0.21,
                charity: 0.14
            },
            2025: {
                business: 0.67,
                medical: 0.21,
                charity: 0.14
            },
            2024: {
                business: 0.67,
                medical: 0.21,
                charity: 0.14
            },
            2023: {
                business: 0.655,
                medical: 0.22,
                charity: 0.14
            },
            2022: {
                business: 0.625,
                medical: 0.22,
                charity: 0.14
            },
            2021: {
                business: 0.56,
                medical: 0.16,
                charity: 0.14
            }
        };
    }

    /**
     * Get IRS standard rate for a given year and purpose
     */
    getIRSRate(year, purpose = 'business') {
        const yearRates = this.irsRates[year];
        if (!yearRates) {
            // Return current year rate if year not found
            const currentYear = new Date().getFullYear();
            return this.irsRates[currentYear]?.[purpose] || 0.67;
        }
        return yearRates[purpose] || yearRates.business;
    }

    /**
     * Add a mileage trip
     */
    addTrip(data) {
        const trip = {
            id: `TRIP-${Date.now()}`,
            date: data.date || new Date().toISOString(),
            from: data.from,
            to: data.to,
            distance: parseFloat(data.distance),
            purpose: data.purpose,
            type: data.type || 'business',
            vehicleId: data.vehicleId || null,
            roundTrip: data.roundTrip || false,
            notes: data.notes || '',
            odometer_start: data.odometer_start || null,
            odometer_end: data.odometer_end || null,
            route: data.route || null,
            status: 'active',
            createdAt: new Date().toISOString()
        };

        // Calculate actual distance if roundTrip
        if (trip.roundTrip) {
            trip.totalDistance = trip.distance * 2;
        } else {
            trip.totalDistance = trip.distance;
        }

        // Get applicable IRS rate
        const year = new Date(trip.date).getFullYear();
        trip.irsRate = this.getIRSRate(year, trip.type);
        
        // Calculate deduction
        trip.deduction = Math.round(trip.totalDistance * trip.irsRate * 100) / 100;

        this.trips.push(trip);
        this.saveTrips();
        
        return trip;
    }

    /**
     * Calculate distance using coordinates (Haversine formula)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 3958.8; // Earth's radius in miles
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        
        return Math.round(distance * 100) / 100;
    }

    /**
     * Convert degrees to radians
     */
    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Auto-track trip using GPS (placeholder for actual GPS integration)
     */
    async startAutoTracking(vehicleId) {
        return {
            trackingId: `TRACK-${Date.now()}`,
            vehicleId,
            startTime: new Date().toISOString(),
            status: 'tracking'
        };
    }

    /**
     * Stop auto-tracking and create trip
     */
    async stopAutoTracking(trackingId, purpose, type = 'business') {
        // This would integrate with actual GPS tracking
        // For now, return a placeholder
        return {
            success: true,
            message: 'Trip tracking stopped',
            tripId: null
        };
    }

    /**
     * Import trips from CSV
     */
    importFromCSV(csvData) {
        const lines = csvData.split('\n');
        const headers = lines[0].split(',');
        const imported = [];

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            const values = lines[i].split(',');
            const trip = {
                date: values[0],
                from: values[1],
                to: values[2],
                distance: parseFloat(values[3]),
                purpose: values[4],
                type: values[5] || 'business'
            };

            const addedTrip = this.addTrip(trip);
            imported.push(addedTrip);
        }

        return imported;
    }

    /**
     * Get total mileage by year
     */
    getTotalMileageByYear(year, type = 'business') {
        const yearTrips = this.getTripsByYear(year);
        const businessTrips = yearTrips.filter(t => t.type === type);
        
        return businessTrips.reduce((sum, t) => sum + t.totalDistance, 0);
    }

    /**
     * Get total deduction by year
     */
    getTotalDeductionByYear(year, type = 'business') {
        const yearTrips = this.getTripsByYear(year);
        const businessTrips = yearTrips.filter(t => t.type === type);
        
        return businessTrips.reduce((sum, t) => sum + t.deduction, 0);
    }

    /**
     * Get trips by year
     */
    getTripsByYear(year) {
        return this.trips.filter(t => {
            const tripYear = new Date(t.date).getFullYear();
            return tripYear === year && t.status === 'active';
        });
    }

    /**
     * Get trips by date range
     */
    getTripsByDateRange(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        return this.trips.filter(t => {
            const tripDate = new Date(t.date);
            return tripDate >= start && tripDate <= end && t.status === 'active';
        });
    }

    /**
     * Get trips by vehicle
     */
    getTripsByVehicle(vehicleId) {
        return this.trips.filter(t => 
            t.vehicleId === vehicleId && t.status === 'active'
        );
    }

    /**
     * Update trip
     */
    updateTrip(id, updates) {
        const index = this.trips.findIndex(t => t.id === id);
        if (index !== -1) {
            this.trips[index] = { ...this.trips[index], ...updates };
            
            // Recalculate if distance or date changed
            if (updates.distance || updates.date || updates.roundTrip) {
                const trip = this.trips[index];
                
                if (trip.roundTrip) {
                    trip.totalDistance = trip.distance * 2;
                } else {
                    trip.totalDistance = trip.distance;
                }
                
                const year = new Date(trip.date).getFullYear();
                trip.irsRate = this.getIRSRate(year, trip.type);
                trip.deduction = Math.round(trip.totalDistance * trip.irsRate * 100) / 100;
            }
            
            this.saveTrips();
            return this.trips[index];
        }
        return null;
    }

    /**
     * Delete trip
     */
    deleteTrip(id) {
        const index = this.trips.findIndex(t => t.id === id);
        if (index !== -1) {
            this.trips[index].status = 'deleted';
            this.saveTrips();
            return true;
        }
        return false;
    }

    /**
     * Get mileage summary
     */
    getSummary(year) {
        const yearTrips = this.getTripsByYear(year);
        
        const summary = {
            totalTrips: yearTrips.length,
            businessMiles: 0,
            medicalMiles: 0,
            charityMiles: 0,
            businessDeduction: 0,
            medicalDeduction: 0,
            charityDeduction: 0,
            totalDeduction: 0,
            averageRate: 0,
            byMonth: {}
        };

        yearTrips.forEach(trip => {
            const month = new Date(trip.date).getMonth() + 1;
            if (!summary.byMonth[month]) {
                summary.byMonth[month] = {
                    miles: 0,
                    deduction: 0,
                    trips: 0
                };
            }
            
            summary.byMonth[month].miles += trip.totalDistance;
            summary.byMonth[month].deduction += trip.deduction;
            summary.byMonth[month].trips++;

            if (trip.type === 'business') {
                summary.businessMiles += trip.totalDistance;
                summary.businessDeduction += trip.deduction;
            } else if (trip.type === 'medical') {
                summary.medicalMiles += trip.totalDistance;
                summary.medicalDeduction += trip.deduction;
            } else if (trip.type === 'charity') {
                summary.charityMiles += trip.totalDistance;
                summary.charityDeduction += trip.deduction;
            }
        });

        summary.totalDeduction = summary.businessDeduction + 
                                summary.medicalDeduction + 
                                summary.charityDeduction;

        const totalMiles = summary.businessMiles + summary.medicalMiles + summary.charityMiles;
        summary.averageRate = totalMiles > 0 ? summary.totalDeduction / totalMiles : 0;

        // Round values
        summary.businessMiles = Math.round(summary.businessMiles * 10) / 10;
        summary.medicalMiles = Math.round(summary.medicalMiles * 10) / 10;
        summary.charityMiles = Math.round(summary.charityMiles * 10) / 10;
        summary.businessDeduction = Math.round(summary.businessDeduction * 100) / 100;
        summary.medicalDeduction = Math.round(summary.medicalDeduction * 100) / 100;
        summary.charityDeduction = Math.round(summary.charityDeduction * 100) / 100;
        summary.totalDeduction = Math.round(summary.totalDeduction * 100) / 100;
        summary.averageRate = Math.round(summary.averageRate * 100) / 100;

        return summary;
    }

    /**
     * Get frequent routes
     */
    getFrequentRoutes(limit = 10) {
        const routes = {};
        
        this.trips.forEach(trip => {
            if (trip.status !== 'active') return;
            
            const routeKey = `${trip.from} → ${trip.to}`;
            if (!routes[routeKey]) {
                routes[routeKey] = {
                    from: trip.from,
                    to: trip.to,
                    count: 0,
                    totalDistance: 0,
                    averageDistance: 0,
                    totalDeduction: 0
                };
            }
            
            routes[routeKey].count++;
            routes[routeKey].totalDistance += trip.totalDistance;
            routes[routeKey].totalDeduction += trip.deduction;
        });

        // Calculate averages and sort
        const routesList = Object.values(routes).map(route => {
            route.averageDistance = Math.round((route.totalDistance / route.count) * 10) / 10;
            return route;
        }).sort((a, b) => b.count - a.count);

        return routesList.slice(0, limit);
    }

    /**
     * Generate mileage log report
     */
    generateMileageLog(year) {
        const yearTrips = this.getTripsByYear(year);
        
        return {
            year,
            generatedDate: new Date().toISOString(),
            summary: this.getSummary(year),
            trips: yearTrips.sort((a, b) => new Date(a.date) - new Date(b.date)),
            frequentRoutes: this.getFrequentRoutes()
        };
    }

    /**
     * Export to CSV
     */
    exportToCSV(year) {
        const yearTrips = this.getTripsByYear(year);
        
        let csv = 'Date,From,To,Purpose,Type,Distance (mi),Round Trip,Total Distance (mi),IRS Rate,Deduction\n';
        
        yearTrips.forEach(trip => {
            csv += `${trip.date},${trip.from},${trip.to},${trip.purpose},${trip.type},${trip.distance},${trip.roundTrip ? 'Yes' : 'No'},${trip.totalDistance},${trip.irsRate},${trip.deduction}\n`;
        });

        return csv;
    }

    /**
     * Export to IRS-compliant format
     */
    exportToIRSFormat(year) {
        const summary = this.getSummary(year);
        const yearTrips = this.getTripsByYear(year);
        
        let report = `IRS MILEAGE LOG - ${year}\n`;
        report += `Generated: ${new Date().toLocaleDateString()}\n\n`;
        report += `SUMMARY\n`;
        report += `Total Business Miles: ${summary.businessMiles}\n`;
        report += `IRS Standard Rate: $${this.getIRSRate(year, 'business')}/mile\n`;
        report += `Total Deduction: $${summary.businessDeduction}\n\n`;
        report += `DETAILED LOG\n`;
        report += `Date | From | To | Purpose | Miles | Deduction\n`;
        report += `-`.repeat(80) + '\n';
        
        yearTrips.forEach(trip => {
            const date = new Date(trip.date).toLocaleDateString();
            report += `${date} | ${trip.from} | ${trip.to} | ${trip.purpose} | ${trip.totalDistance} | $${trip.deduction}\n`;
        });

        return report;
    }

    /**
     * Validate trip data
     */
    validateTrip(data) {
        const errors = [];

        if (!data.date) errors.push('Date is required');
        if (!data.from) errors.push('Starting location is required');
        if (!data.to) errors.push('Destination is required');
        if (!data.distance || data.distance <= 0) errors.push('Valid distance is required');
        if (!data.purpose) errors.push('Purpose is required');

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Save trips to localStorage
     */
    saveTrips() {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('mileageTrips', JSON.stringify(this.trips));
        }
    }

    /**
     * Load trips from localStorage
     */
    loadTrips() {
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('mileageTrips');
            if (saved) {
                this.trips = JSON.parse(saved);
            }
        }
    }

    /**
     * Get all trips
     */
    getAllTrips() {
        return this.trips.filter(t => t.status === 'active');
    }

    /**
     * Search trips
     */
    searchTrips(query) {
        const searchLower = query.toLowerCase();
        return this.trips.filter(trip => 
            trip.status === 'active' && (
                trip.from.toLowerCase().includes(searchLower) ||
                trip.to.toLowerCase().includes(searchLower) ||
                trip.purpose.toLowerCase().includes(searchLower)
            )
        );
    }

    /**
     * Calculate business use percentage
     */
    calculateBusinessUsePercentage(year, vehicleId = null) {
        let trips;
        if (vehicleId) {
            trips = this.getTripsByVehicle(vehicleId);
        } else {
            trips = this.getTripsByYear(year);
        }

        const businessMiles = trips
            .filter(t => t.type === 'business')
            .reduce((sum, t) => sum + t.totalDistance, 0);

        const totalMiles = trips
            .reduce((sum, t) => sum + t.totalDistance, 0);

        const percentage = totalMiles > 0 ? (businessMiles / totalMiles) * 100 : 0;
        
        return {
            businessMiles,
            totalMiles,
            personalMiles: totalMiles - businessMiles,
            businessPercentage: Math.round(percentage * 100) / 100
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MileageTracker;
}
