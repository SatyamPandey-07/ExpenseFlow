# Issue #936 - Mobile-First Progressive Web App & Offline Support
## Complete Implementation Guide

**Status:** ✅ Core Modules Implemented  
**Last Updated:** March 3, 2026  
**Version:** 1.0.0

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Module Documentation](#module-documentation)
4. [Integration Guide](#integration-guide)
5. [API Reference](#api-reference)
6. [Best Practices](#best-practices)
7. [Testing](#testing)
8. [Deployment](#deployment)

---

## 🎯 Overview

This implementation provides a comprehensive progressive web app (PWA) solution for ExpenseFlow with full offline support, intelligent sync, and advanced mobile features.

### Key Features Implemented

- ✅ **Offline Database** - IndexedDB with sync queue management
- ✅ **Background Sync** - Automatic sync when online with conflict resolution
- ✅ **Camera Integration** - Receipt capture with OCR-ready support
- ✅ **Geolocation Tracking** - Location tagging and geofencing
- ✅ **Biometric Authentication** - WebAuthn with Face ID/Touch ID support
- ✅ **QR Code Scanner** - Vendor check-in and expense tracking
- ✅ **Network-Aware Fetching** - Adaptive loading based on connection speed
- ✅ **Conflict Resolution** - Smart merge strategies for sync conflicts

---

## 🏗️ Architecture

### Module Dependency Graph

```
┌─────────────────────────────────────────────────────┐
│         ExpenseFlow PWA Core Modules               │
└─────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
    ┌───▼────┐      ┌─────▼─────┐    ┌─────▼────────┐
    │OfflineDB│     │ Background │    │ Conflict    │
    │         │     │ Sync       │    │ Resolution  │
    └────┬────┘     └─────┬──────┘    └─────┬────────┘
         │                │                   │
    ┌────▼──────┬────────▼─────────┬────────▼────┐
    │            │                  │             │
┌───▼──┐    ┌───▼────┐       ┌────▼──┐    ┌───▼─────┐
│Camera│    │Geoloc  │       │Biometric   │QR Scanner
│      │    │Tracking│       │Auth        │
└──────┘    └────────┘       └─────┬──────┘
                                    │
                           ┌────────▼────────┐
                           │Network-Aware    │
                           │Fetch            │
                           └─────────────────┘
```

### Data Flow

```
User Action
    ↓
[Offline? → Store in IndexedDB] OR [Online? → Direct API]
    ↓
Background Sync Manager
    ├─ Detects changes
    ├─ Queues operations
    └─ Syncs when online
    ↓
Conflict Detection
    ├─ Analyzes differences
    ├─ Suggests resolution
    └─ Auto-resolves or prompts user
    ↓
Server Update
    ↓
Local Sync Confirmation
```

---

## 📚 Module Documentation

### 1. OfflineDB (`offline-db.js`)

Complete IndexedDB management system for offline data storage.

**Features:**
- Multiple object stores (expenses, receipts, budgets, locations, etc.)
- Sync metadata tracking
- Conflict detection and storage
- Automatic data cleanup
- Storage quota management

**Key Methods:**

```javascript
// Initialize
await offlineDB.init();

// Add/Update expense
const id = await offlineDB.addExpense({
    amount: 50.00,
    category: 'Food',
    description: 'Lunch',
    currency: 'USD',
    userId: 'user123'
});

// Get pending expenses
const pending = await offlineDB.getPendingExpenses();

// Save receipt
const receiptId = await offlineDB.saveReceipt({
    expenseId: id,
    image: 'data:image/jpeg;base64,...',
    vendor: 'Restaurant ABC'
});

// Create conflict
const conflictId = await offlineDB.createConflict({
    expenseId: id,
    serverVersion: serverData,
    localVersion: localData
});

// Get storage stats
const stats = await offlineDB.getStorageStats();
```

**Storage Structure:**

```javascript
Expenses: {
    id: int (auto)
    amount: number
    category: string
    date: ISO string
    syncStatus: 'pending' | 'synced' | 'failed'
    synced: boolean
    version: int
    lastModified: ISO string
    indexes: [syncStatus, timestamp, userId, category, synced]
}

TransactionQueue: {
    id: int (auto)
    type: 'addExpense' | 'updateExpense' | 'deleteExpense'
    data: object
    status: 'pending' | 'synced' | 'failed'
    timestamp: ISO string
    indexes: [type, status, timestamp, expenseId]
}
```

---

### 2. BackgroundSyncManager (`background-sync.js`)

Handles automatic synchronization of pending changes.

**Features:**
- Network status monitoring
- Automatic sync when online
- Retry logic with exponential backoff
- Sync queue management
- Event emission for UI updates

**Key Methods:**

```javascript
// Initialize
await backgroundSyncManager.init();

// Listen for sync events
backgroundSyncManager.on('syncStart', (data) => {
    console.log('Sync started', data);
});

backgroundSyncManager.on('syncComplete', (data) => {
    console.log(`Synced ${data.synced} items`);
});

backgroundSyncManager.on('syncError', (data) => {
    console.error('Sync error:', data.error);
});

// Queue an operation
const id = await backgroundSyncManager.queueOperation('addExpense', {
    amount: 50,
    category: 'Food'
});

// Manually trigger sync
await backgroundSyncManager.syncPendingOperations();

// Get sync status
const status = backgroundSyncManager.getSyncStatus();
// {
//   isOnline: true,
//   syncInProgress: false,
//   metrics: { totalSynced: 10, totalFailed: 0, ... }
// }

// Handle conflicts
const conflictId = await backgroundSyncManager.handleConflict(
    expenseId,
    serverVersion,
    localVersion
);

// Resolve conflict
await backgroundSyncManager.resolveConflict(conflictId, 'keepLocal');
```

**Event Types:**

- `syncStart` - Sync begins
- `syncProgress` - Individual item synced
- `syncComplete` - Sync finished
- `syncError` - Sync failed

---

### 3. CameraReceiptCapture (`camera-receipt-capture.js`)

Mobile camera integration for receipt capture.

**Features:**
- Camera access and permissions
- Photo capture with optional flash
- Image compression and optimization
- OCR integration (server-side)
- Receipt data extraction
- Automatic categorization

**Key Methods:**

```javascript
// Initialize
await cameraReceiptCapture.init();

// Start camera
const stream = await cameraReceiptCapture.startCamera(
    videoElement,
    { facingMode: 'environment' }
);

// Capture photo
const photo = await cameraReceiptCapture.capturePhoto();
// Returns: 'data:image/jpeg;base64,...'

// Capture with flash
const photoWithFlash = await cameraReceiptCapture.capturePhotoWithFlash();

// Process and compress
const compressed = await cameraReceiptCapture.processReceiptImage(
    photoData,
    { quality: 0.7, maxWidth: 1280 }
);

// Extract text (requires server OCR)
const ocrResult = await cameraReceiptCapture.extractReceiptText(imageData);
// Returns: { vendor: 'ABC Restaurant', amount: 50, ...}

// Parse receipt into expense
const expense = await cameraReceiptCapture.parseReceipt({
    image: photoData,
    vendor: 'ABC Restaurant',
    amount: 50.00
});

// Save receipt
const receiptId = await cameraReceiptCapture.saveReceipt(expenseId, {
    image: photoData,
    vendor: 'ABC Restaurant',
    amount: 50.00
});

// Get capabilities
const caps = await cameraReceiptCapture.checkCameraCapabilities();
```

**Receipt Parsing:**

The system automatically extracts:
- Amount (currency symbols supported: $, £, €, ₹)
- Date (multiple formats: MM/DD/YY, DD-MM-YYYY, etc.)
- Vendor name
- Automatic category detection
- Confidence scoring

---

### 4. GeolocationTracker (`geolocation-tracker.js`)

Location tracking and geofencing for expense tagging.

**Features:**
- Continuous location tracking
- Geofence management and detection
- Reverse geocoding (location name)
- Forward geocoding (address → coordinates)
- Location history and clustering
- Distance calculations (Haversine)

**Key Methods:**

```javascript
// Initialize
await geolocationTracker.init();

// Request permissions
await geolocationTracker.requestLocationPermission();

// Get current location (one-time)
const location = await geolocationTracker.getCurrentLocation({
    enableHighAccuracy: true,
    timeout: 10000
});
// Returns: { latitude, longitude, accuracy, altitude, timestamp, ... }

// Start continuous tracking
await geolocationTracker.startTracking({
    enableHighAccuracy: true,
    maximumAge: 5000
});

// Tag expense with location
const locationId = await geolocationTracker.tagExpenseWithLocation(expenseId);

// Get expense location
const expenseLocation = await geolocationTracker.getExpenseLocation(expenseId);

// Add geofence
const geofenceId = geolocationTracker.addGeofence(
    'Favorite Restaurant',
    40.7128, // latitude
    -74.0060, // longitude
    100 // radius in meters
);

// Get location name from coordinates
const name = await geolocationTracker.getLocationName(40.7128, -74.0060);
// Returns: '1600 Pennsylvania Ave NW, Washington, DC'

// Get location statistics
const stats = geolocationTracker.getLocationStats();
// {
//   lastLocation: {...},
//   centerLocation: {...},
//   totalDistance: 1500,
//   totalLocations: 42,
//   averageAccuracy: 15
// }

// Stop tracking
geolocationTracker.stopTracking();

// Get status
const status = geolocationTracker.getStatus();
```

**Geofence Events:**

```javascript
window.addEventListener('geofenceEnter', (event) => {
    const { geofence, distance } = event.detail;
    console.log(`Entered ${geofence.name} (${distance}m away)`);
    // Auto-suggest vendor/location
});
```

---

### 5. BiometricAuthentication (`biometric-auth.js`)

WebAuthn-based biometric authentication (Face ID, Touch ID, Fingerprint).

**Features:**
- Platform authenticator registration
- Biometric verification
- Backup codes generation
- Transaction confirmation
- Cross-device migration

**Key Methods:**

```javascript
// Initialize
await biometricAuthentication.init();

// Check support
const supported = biometricAuthentication.isSupported();

// Get supported authenticators
const authenticators = await biometricAuthentication.getSupportedAuthenticators();
// {
//   platform: true,     // Face ID, Touch ID
//   crossPlatform: true, // FIDO2 keys
//   residentKey: true   // Passwordless
// }

// Register biometric
const credential = await biometricAuthentication.registerBiometric(
    'user123',
    'John Doe',
    'john@example.com'
);

// Authenticate with biometric
const authData = await biometricAuthentication.authenticate('user123');

// Check if enabled
const isEnabled = await biometricAuthentication.isBiometricEnabled('user123');

// Enable for user
await biometricAuthentication.enableBiometric('user123', 'John Doe', 'john@example.com');

// Require biometric for transaction
const approved = await biometricAuthentication.requireBiometricForTransaction(
    'user123',
    150 // amount
);

// Generate backup codes
const codes = biometricAuthentication.generateBackupCodes(10);

// Store backup codes
await biometricAuthentication.storeBackupCodes('user123', codes);

// Verify backup code
const isValid = await biometricAuthentication.verifyBackupCode('user123', code);

// Get status
const status = biometricAuthentication.getStatus();
```

**Transaction Confirmation Flow:**

```javascript
// High-value transaction
if (amount > 100) {
    const approved = await biometricAuthentication.requireBiometricForTransaction(
        userId,
        amount
    );
    if (!approved) {
        throw new Error('Biometric verification failed');
    }
}
```

---

### 6. QRCodeScanner (`qr-scanner.js`)

QR code scanning for vendor check-in and expense linking.

**Features:**
- BarcodeDetector API with canvas fallback
- QR generation for expenses
- Vendor check-in support
- Batch scanning
- Format validation

**Key Methods:**

```javascript
// Initialize
await qrCodeScanner.init();

// Check capabilities
const capabilities = await qrCodeScanner.getCapabilities();

// Start scanning
await qrCodeScanner.startScanning(videoElement, async (qrData) => {
    console.log('Scanned:', qrData);
    if (qrData.type === 'expense') {
        // Handle expense QR
    } else if (qrData.type === 'vendor_checkin') {
        // Handle vendor check-in
    }
});

// Scan and tag expense
const result = await qrCodeScanner.scanAndTagExpense(expenseId);
// { success: true, vendor: 'vendor123', location: 'location123' }

// Generate expense QR
const qrData = await qrCodeScanner.generateExpenseQR(expenseId, 'qr-container');

// Generate vendor QR
const vendorQR = await qrCodeScanner.generateVendorQR(
    'vendor123',
    'location456',
    'qr-container'
);

// Stop scanning
qrCodeScanner.stopScanning();

// Validate QR format
const isValid = qrCodeScanner.isValidQRFormat(qrData);
```

**QR Code Formats:**

```javascript
// Expense QR
{
  type: 'expense',
  expenseId: '123',
  timestamp: '2026-03-03T...',
  app: 'ExpenseFlow'
}

// Vendor Check-in
vendor123:location456:1646265600000

// General text
'Any text data'

// URL
'https://expenseflow.app/e/123'
```

---

### 7. NetworkAwareDataFetch (`network-aware-fetch.js`)

Intelligent data fetching that adapts to network conditions.

**Features:**
- Network speed detection
- Automatic quality adjustment
- Progressive image loading
- Request batching
- Smart caching
- Battery-aware loading

**Key Methods:**

```javascript
// Initialize
await networkAwareDataFetch.init();

// Adaptive fetch
const response = await networkAwareDataFetch.fetch('/api/expenses', {
    method: 'GET',
    cacheDuration: 300000 // 5 minutes
});

// Fetch images with quality optimization
const imageBlob = await networkAwareDataFetch.fetchImage(
    '/receipts/123.jpg',
    320 // container width
);

// Progressive image loading (placeholder → full quality)
await networkAwareDataFetch.loadProgressiveImage(
    '/receipts/123.jpg',
    containerElement
);

// Batch fetch with adaptive parallelization
const results = await networkAwareDataFetch.batchFetch([
    '/api/expenses',
    '/api/budgets',
    '/api/user/profile'
]);

// Prefetch resources
await networkAwareDataFetch.prefetch([
    '/api/categories',
    '/api/vendors'
]);

// Get network status
const status = networkAwareDataFetch.getStatus();
// {
//   isOnline: true,
//   effectiveType: '4g',
//   currentStrategy: 'aggressive',
//   quality: { image: 'high', video: '1080p', data: 'full' }
// }

// Get cache stats
const stats = networkAwareDataFetch.getCacheStats();
// { entries: 5, estimatedSizeKB: 245, urls: [...] }

// Clear cache
networkAwareDataFetch.clearCache();
```

**Quality Strategies:**

- **Aggressive (4G):** High quality, full data, multiple parallel requests
- **Balanced (3G):** Medium quality, compressed data, 4 parallel requests
- **Conservative (2G):** Low quality, minimal data, 2 parallel requests
- **Minimal (Save Data):** Very low quality, only essential data
- **Offline:** Cache only

---

### 8. ConflictResolutionEngine (`conflict-resolution.js`)

Intelligent conflict detection and resolution.

**Features:**
- Automatic conflict detection
- 6+ resolution strategies
- Smart merging with 3-way merge
- User-guided resolution
- Conflict history tracking
- Statistics and analysis

**Key Methods:**

```javascript
// Initialize
await conflictResolutionEngine.init();

// Detect conflict
const conflict = await conflictResolutionEngine.detectConflict(
    localVersion,
    serverVersion
);
// {
//   id: 'conflict_xyz',
//   local: {...},
//   server: {...},
//   analysis: {
//     fieldsChanged: ['amount', 'description'],
//     severity: 'medium',
//     confidence: 0.7,
//     suggestedStrategy: 'smartMerge'
//   }
// }

// Auto-resolve conflicts
const resolved = await conflictResolutionEngine.autoResolveConflicts();

// Resolve with specific strategy
const conflict = await conflictResolutionEngine.resolveConflict(
    conflictId,
    'smartMerge' // or 'lastWriteWins', 'serverWins', etc.
);

// Resolve with user input
const conflict = await conflictResolutionEngine.resolveWithUserInput(
    conflictId,
    'local' // or 'server' or custom merged object
);

// Get unresolved conflicts
const unresolved = conflictResolutionEngine.getUnresolvedConflicts();

// Get resolution statistics
const stats = conflictResolutionEngine.getConflictStats();
// {
//   total: 10,
//   resolved: 7,
//   pending: 3,
//   bySeverity: { low: 5, medium: 3, high: 2 },
//   resolutionStrategies: { smartMerge: 4, lastWriteWins: 2, ... }
// }

// Export history
const history = conflictResolutionEngine.exportConflictHistory();
```

**Resolution Strategies:**

1. **Last Write Wins** - Most recent modification time wins
2. **Server Wins** - Always trust server as source of truth
3. **Local Wins** - Prioritize user's local changes
4. **Smart Merge** - Intelligently merge non-conflicting fields
5. **Highest Amount** - Choose expense with greater amount
6. **Most Recent Date** - Use transaction with most recent date

---

## 🔌 Integration Guide

### Step 1: Include Scripts in HTML

```html
<!-- Core modules -->
<script src="/offline-db.js"></script>
<script src="/background-sync.js"></script>
<script src="/conflict-resolution.js"></script>

<!-- Feature modules -->
<script src="/camera-receipt-capture.js"></script>
<script src="/geolocation-tracker.js"></script>
<script src="/biometric-auth.js"></script>
<script src="/qr-scanner.js"></script>
<script src="/network-aware-fetch.js"></script>

<!-- Optional: OCR library (for receipt text extraction) -->
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@v2"></script>

<!-- Optional: QR code generation library -->
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.0"></script>

<!-- Optional: QR code detection library (fallback) -->
<script src="https://cdn.jsdelivr.net/npm/jsqr@0.1.0"></script>
```

### Step 2: Initialize All Modules

```javascript
// Initialize in order of dependencies
async function initializeExpenseFlowPWA() {
    try {
        // Core initialization
        console.log('Initializing OfflineDB...');
        await offlineDB.init();

        console.log('Initializing BackgroundSyncManager...');
        await backgroundSyncManager.init();

        console.log('Initializing ConflictResolutionEngine...');
        await conflictResolutionEngine.init();

        // Feature initialization
        console.log('Initializing Camera...');
        await cameraReceiptCapture.init();

        console.log('Initializing Geolocation...');
        await geolocationTracker.init();

        console.log('Initializing Biometric Auth...');
        await biometricAuthentication.init();

        console.log('Initializing QR Scanner...');
        await qrCodeScanner.init();

        console.log('Initializing Network-Aware Fetch...');
        await networkAwareDataFetch.init();

        console.log('✅ All PWA modules initialized successfully');

        // Set up event listeners
        setupEventListeners();

        return true;

    } catch (error) {
        console.error('❌ PWA initialization failed:', error);
        return false;
    }
}

// Call on app startup
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExpenseFlowPWA);
} else {
    initializeExpenseFlowPWA();
}
```

### Step 3: Handle Sync Events

```javascript
function setupEventListeners() {
    // Background sync events
    backgroundSyncManager.on('syncStart', (data) => {
        showSyncIndicator('Syncing...');
    });

    backgroundSyncManager.on('syncProgress', (data) => {
        if (data.status === 'success') {
            logSyncSuccess(data);
        } else {
            logSyncError(data);
        }
    });

    backgroundSyncManager.on('syncComplete', (data) => {
        hideSyncIndicator();
        showNotification(`Synced ${data.synced} items`);
        refreshUI();
    });

    backgroundSyncManager.on('syncError', (data) => {
        if (data.type === 'conflict') {
            showConflictResolutionDialog(data);
        } else {
            showErrorNotification(`Sync failed: ${data.error}`);
        }
    });

    // Network status changes
    window.addEventListener('online', () => {
        showNotification('You are back online!');
        backgroundSyncManager.syncPendingOperations();
    });

    window.addEventListener('offline', () => {
        showNotification('You are now offline. Changes will sync when online.');
    });

    // Geofence events
    window.addEventListener('geofenceEnter', (event) => {
        const { geofence } = event.detail;
        suggestVendorAutoTag(geofence.name);
    });
}
```

### Step 4: Create an Expense with All Features

```javascript
async function createExpenseWithFeatures() {
    try {
        // 1. Capture receipt with camera
        const receiptPhoto = await cameraReceiptCapture.capturePhoto();
        const processedReceipt = await cameraReceiptCapture.processReceiptImage(
            receiptPhoto,
            { quality: 0.75, maxWidth: 1280 }
        );

        // 2. Extract text via OCR
        let receiptData = await cameraReceiptCapture.extractReceiptText(
            processedReceipt
        );

        // 3. Get current location
        const location = await geolocationTracker.getCurrentLocation();

        // 4. Create expense object
        const expense = {
            amount: receiptData.amount,
            currency: 'USD',
            category: receiptData.category,
            vendor: receiptData.vendor,
            description: receiptData.description,
            date: receiptData.date || new Date().toISOString().split('T')[0],
            userNote: 'Business expense',
            tags: ['business', 'dining'],
            
            // Location data
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy,
                address: await geolocationTracker.getLocationName(
                    location.latitude,
                    location.longitude
                )
            }
        };

        // 5. Save to offline database
        const expenseId = await offlineDB.addExpense(expense);

        // 6. Save receipt image
        const receiptId = await cameraReceiptCapture.saveReceipt(
            expenseId,
            {
                image: processedReceipt,
                vendor: receiptData.vendor,
                amount: receiptData.amount
            }
        );

        // 7. Tag location
        const locationId = await geolocationTracker.tagExpenseWithLocation(expenseId);

        // 8. Generate QR code for reference
        const qrCode = await qrCodeScanner.generateExpenseQR(
            expenseId,
            'expense-qr-container'
        );

        // 9. Queue for sync
        await backgroundSyncManager.queueOperation('addExpense', expense);

        console.log('✅ Expense created with all features');
        return expenseId;

    } catch (error) {
        console.error('❌ Failed to create expense:', error);
        showErrorNotification('Failed to save expense');
    }
}
```

---

## 📖 API Reference

### Common Response Format

```javascript
// Success
{
  success: true,
  data: {...},
  timestamp: '2026-03-03T...'
}

// Error
{
  success: false,
  error: 'Error message',
  code: 'ERROR_CODE',
  timestamp: '2026-03-03T...'
}
```

### Expense Data Structure

```javascript
{
  id: number,
  amount: number,
  currency: 'USD' | 'EUR' | 'GBP' | ...,
  category: string,
  vendor: string,
  description: string,
  date: 'YYYY-MM-DD',
  userNote: string,
  tags: string[],
  userId: string,
  
  // Location
  location: {
    latitude: number,
    longitude: number,
    accuracy: number,
    address: string
  },
  
  // Receipt
  receipt: {
    id: number,
    image: 'data:image/jpeg;base64,...',
    vendor: string,
    amount: number,
    uploadedAt: ISO string
  },
  
  // QR Code
  qrCode: {
    value: string,
    generatedAt: ISO string
  },
  
  // Sync status
  syncStatus: 'pending' | 'synced' | 'failed',
  synced: boolean,
  lastModified: ISO string,
  version: number
}
```

---

## ✅ Best Practices

### 1. Always Initialize in Correct Order

```javascript
// ✅ Correct
await offlineDB.init();
await backgroundSyncManager.init();
await conflictResolutionEngine.init();

// ❌ Wrong
await backgroundSyncManager.init();
await offlineDB.init(); // offlineDB is called after!
```

### 2. Handle Offline Scenarios Gracefully

```javascript
async function addExpense(expenseData) {
    try {
        if (navigator.onLine) {
            // Send directly to server
            return await fetch('/api/expenses', {
                method: 'POST',
                body: JSON.stringify(expenseData)
            });
        } else {
            // Save locally and queue for sync
            const id = await offlineDB.addExpense(expenseData);
            await backgroundSyncManager.queueOperation('addExpense', expenseData);
            return { id };
        }
    } catch (error) {
        // Fallback: save locally
        return await offlineDB.addExpense(expenseData);
    }
}
```

### 3. Use Network-Aware Fetching for Large Datasets

```javascript
// ✅ Good
const images = await networkAwareDataFetch.batchFetch(imageUrls);

// ❌ Bad
const images = await Promise.all(imageUrls.map(url => fetch(url)));
```

### 4. Implement Proper Conflict Handling

```javascript
// Listen for conflicts
backgroundSyncManager.on('syncError', async (data) => {
    if (data.type === 'conflict') {
        const conflict = await offlineDB.getUnresolvedConflicts().find(
            c => c.id === data.conflictId
        );

        // Let user choose resolution
        const userChoice = await getUserConflictChoice(conflict);
        await conflictResolutionEngine.resolveWithUserInput(
            data.conflictId,
            userChoice
        );
    }
});
```

### 5. Periodically Clean Up Old Data

```javascript
// Clean up every day
setInterval(async () => {
    const cleaned = await offlineDB.clearExpiredData(90); // 90 days
    console.log(`Cleaned ${cleaned} expired records`);
}, 24 * 60 * 60 * 1000);
```

### 6. Respect Battery and Data Limits

```javascript
async function smartFetchData() {
    const status = networkAwareDataFetch.getStatus();
    
    // Check battery
    if (navigator.getBattery) {
        const battery = await navigator.getBattery();
        if (battery.level < 0.1) {
            // Don't sync on very low battery
            return;
        }
    }
    
    // Check data saver
    if (status.saveData) {
        // Fetch minimal data
        return await networkAwareDataFetch.fetch('/api/expenses?minimal=true');
    }
}
```

### 7. Use Biometric for High-Value Transactions

```javascript
async function processExpensePayment(expenseId, amount) {
    // Require biometric for high amounts
    if (amount > 500) {
        const verified = await biometricAuthentication.requireBiometricForTransaction(
            userId,
            amount
        );

        if (!verified) {
            throw new Error('Biometric verification required');
        }
    }

    // Process payment
    return await submitPayment(expenseId);
}
```

---

## 🧪 Testing

### Unit Test Examples

```javascript
// Test offline DB
describe('OfflineDB', () => {
    let db;

    beforeEach(async () => {
        db = new OfflineDB();
        await db.init();
    });

    it('should add expense', async () => {
        const id = await db.addExpense({ amount: 50 });
        expect(id).toBeDefined();
    });

    it('should get pending expenses', async () => {
        await db.addExpense({ amount: 50 });
        const pending = await db.getPendingExpenses();
        expect(pending.length).toBeGreaterThan(0);
    });

    afterEach(() => {
        db.close();
    });
});
```

### Integration Test Examples

```javascript
// Test full sync flow
describe('Background Sync', () => {
    it('should sync pending expenses when online', async () => {
        // Create offline expense
        const id = await offlineDB.addExpense({ amount: 50 });

        // Trigger sync
        await backgroundSyncManager.syncPendingOperations();

        // Verify synced
        const expense = await offlineDB.getAllExpenses();
        expect(expense[0].synced).toBe(true);
    });

    it('should handle sync conflicts', async () => {
        const conflict = await conflictResolutionEngine.detectConflict(
            localVersion,
            serverVersion
        );

        await conflictResolutionEngine.resolveConflict(
            conflict.id,
            'smartMerge'
        );

        expect(conflict.resolved).toBe(true);
    });
});
```

---

## 🚀 Deployment

### Pre-Deployment Checklist

- [ ] All modules included in HTML
- [ ] Service worker registered in index.html
- [ ] Manifest.json is valid and points to correct icons
- [ ] HTTPS enabled (required for camera, geolocation, WebAuthn)
- [ ] API endpoints configured correctly
- [ ] OCR service configured (if using receipt text extraction)
- [ ] Background sync API registered with service worker
- [ ] Push notifications service configured
- [ ] Analytics configured
- [ ] Error tracking configured

### Service Worker Configuration

```javascript
// Add to service worker registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('Service worker registered');

        // Background sync
        if ('sync' in reg) {
            reg.sync.register('offline-sync');
        }

        // Push notifications
        if ('pushManager' in reg) {
            reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: 'YOUR_PUSH_KEY'
            });
        }
    });
}
```

### Environment Variables

```env
# .env
VITE_API_BASE_URL=https://api.expenseflow.com
VITE_OCR_SERVICE_URL=https://ocr.expenseflow.com
VITE_VAPID_PUBLIC_KEY=your_push_key_here
VITE_ENABLE_BIOMETRIC=true
VITE_ENABLE_CAMERA=true
VITE_ENABLE_GEOLOCATION=true
VITE_ENABLE_QR_SCANNER=true
VITE_OFFLINE_SYNC_INTERVAL=30000
VITE_CONFLICT_AUTO_RESOLVE_THRESHOLD=0.8
```

---

## 📊 Monitoring & Analytics

### Track PWA Metrics

```javascript
// Track feature usage
function trackFeatureUsage(feature, action) {
    gtag('event', feature, {
        'event_category': 'pwa_feature',
        'event_label': action,
        'timestamp': new Date().toISOString()
    });
}

// Track sync metrics
backgroundSyncManager.on('syncComplete', (data) => {
    trackFeatureUsage('sync', 'complete');
    gtag('event', 'sync_metrics', {
        'synced_items': data.synced,
        'failed_items': data.failed,
        'sync_time': data.duration
    });
});

// Track offline usage
window.addEventListener('offline', () => {
    trackFeatureUsage('network', 'offline');
});

window.addEventListener('online', () => {
    trackFeatureUsage('network', 'online');
});
```

---

## 🐛 Troubleshooting

### Common Issues

**Camera Not Working:**
- Check HTTPS is enabled
- Verify camera permissions granted
- Ensure `browserInfo.mediaDevices.getUserMedia` is available

**Geolocation Failing:**
- Check location permission granted
- Ensure HTTPS enabled
- Try `enableHighAccuracy: false` if timeout occurs

**Conflict Resolution Not Working:**
- Verify `conflictResolutionEngine.init()` called
- Check conflict is properly detected
- Ensure resolution strategy is registered

**Sync Not Happening:**
- Check network connectivity
- Verify API endpoints configured
- Check service worker is installed
- Look for errors in console

### Debug Mode

```javascript
// Enable debug logging
localStorage.setItem('DEBUG_PWA', 'true');

// Monitor all operations
[offlineDB, backgroundSyncManager, conflictResolutionEngine].forEach(manager => {
    if (manager.on) {
        manager.on('*', (event, data) => {
            if (localStorage.getItem('DEBUG_PWA')) {
                console.log(`[${event}]`, data);
            }
        });
    }
});
```

---

## 📞 Support

For issues, questions, or contributions:
- GitHub Issues: https://github.com/ExpenseFlow/ExpenseFlow/issues
- Documentation: https://docs.expenseflow.app
- Email: support@expenseflow.app

---

**Document Version:** 1.0.0  
**Last Updated:** March 3, 2026  
**Status:** ✅ Production Ready
