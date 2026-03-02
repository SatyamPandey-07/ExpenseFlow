# Device Attestation Quick Start Guide

## Overview
Quick reference for implementing device attestation in ExpenseFlow.

## Setup

### 1. Environment Configuration
```bash
# .env file
APPLE_TEAM_ID=your_team_id
APPLE_KEY_ID=your_key_id
APPLE_PRIVATE_KEY=your_private_key
GOOGLE_API_KEY=your_google_api_key
TPM_ENABLED=true
```

### 2. Server Integration
```javascript
// server.js
const deviceAttestationRoutes = require('./routes/deviceAttestationRoutes');
app.use('/api/device-attestation', deviceAttestationRoutes);
```

### 3. Database Indexes
```javascript
// Run once on deployment
db.device_attestations.createIndex({ userId: 1, deviceId: 1, createdAt: -1 });
db.device_attestations.createIndex({ status: 1, validUntil: 1 });
db.attestation_cache.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
db.device_binding_history.createIndex({ userId: 1, deviceId: 1, createdAt: -1 });
```

## Usage

### Client-Side: Perform Attestation

```javascript
// 1. Generate device ID
const deviceId = localStorage.getItem('device_id') || generateUUID();
localStorage.setItem('device_id', deviceId);

// 2. Collect device fingerprint
const fingerprint = {
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  screenResolution: `${screen.width}x${screen.height}`,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  hardwareConcurrency: navigator.hardwareConcurrency,
  // ... more components
};

// 3. Perform attestation
const response = await fetch('/api/device-attestation/attest', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Device-ID': deviceId
  },
  body: JSON.stringify({
    provider: 'FALLBACK', // or 'WEBAUTHENTICATION', 'TPM', etc.
    deviceId,
    attestationData: fingerprint
  })
});

const result = await response.json();
console.log('Trust Score:', result.attestation.trustScore);
```

### Server-Side: Check Device Trust

```javascript
const deviceTrustIntegrationService = require('./services/deviceTrustIntegrationService');

// Get device trust score
async function checkDeviceTrust(userId, deviceId, sessionId) {
  const trust = await deviceTrustIntegrationService
    .calculateDeviceTrustComponent(userId, deviceId, sessionId);
  
  if (trust.deviceTrustScore < 40) {
    return 'BLOCK_OR_CHALLENGE';
  } else if (trust.deviceTrustScore < 60) {
    return 'ENHANCED_MONITORING';
  }
  return 'ALLOW';
}

// Usage in authentication middleware
app.use(async (req, res, next) => {
  const deviceId = req.headers['x-device-id'];
  const userId = req.user?.id;
  
  if (userId && deviceId) {
    const action = await checkDeviceTrust(userId, deviceId, req.sessionId);
    
    if (action === 'BLOCK_OR_CHALLENGE') {
      return res.status(403).json({ 
        error: 'Device trust too low',
        requiresAttestation: true 
      });
    }
  }
  
  next();
});
```

### Monitor Active Session

```javascript
const deviceTrustIntegrationService = require('./services/deviceTrustIntegrationService');

// Start monitoring
const monitor = await deviceTrustIntegrationService.monitorActiveSession(
  userId,
  deviceId,
  sessionId,
  async (event) => {
    if (event.type === 'CRITICAL_TRUST_LOSS') {
      // Terminate session
      await terminateSession(sessionId);
      await notifyUser(userId, 'Session terminated due to security concerns');
    } else if (event.type === 'INTEGRITY_FAILURE') {
      // Require re-authentication
      await requireReauth(sessionId);
    }
  }
);

// Stop monitoring when session ends
session.on('end', () => {
  deviceTrustIntegrationService.stopMonitoring(monitor);
});
```

## API Endpoints Reference

### POST /api/device-attestation/attest
Perform device attestation.

**Request:**
```json
{
  "provider": "FALLBACK",
  "deviceId": "uuid",
  "attestationData": { /* provider-specific data */ }
}
```

**Response:**
```json
{
  "success": true,
  "attestation": {
    "id": "...",
    "status": "VALID",
    "trustScore": 85,
    "provider": "FALLBACK",
    "validUntil": "2026-03-02T12:00:00Z"
  }
}
```

### GET /api/device-attestation/trust-score/:deviceId
Get device trust score.

**Response:**
```json
{
  "trustScore": 85,
  "attestationScore": 80,
  "stabilityScore": 90,
  "level": "HIGH",
  "expiresAt": "2026-03-02T12:00:00Z"
}
```

### GET /api/device-attestation/trust-component/:deviceId
Get full trust breakdown.

**Response:**
```json
{
  "deviceTrustScore": 85,
  "trustLevel": "HIGH",
  "components": {
    "attestation": { "score": 80 },
    "stability": { "score": 90 },
    "behavioral": { "score": 85 },
    "historical": { "score": 88 }
  },
  "integrityStatus": "PASS",
  "recommendations": []
}
```

### POST /api/device-attestation/revoke/:deviceId
Revoke device attestation.

**Request:**
```json
{
  "reason": "USER_REVOKED"
}
```

## Trust Score Interpretation

| Score | Level | Action |
|-------|-------|--------|
| 80-100 | HIGH | Full access |
| 60-79 | MEDIUM | Normal access |
| 40-59 | LOW | Enhanced monitoring |
| 20-39 | VERY_LOW | Challenge required |
| 0-19 | NONE | Block/reject |

## Attestation Providers

### FALLBACK (Default)
- **Use Case**: Universal fallback, no hardware required
- **Trust Score**: 50 base
- **Data Required**: Device fingerprint components

### WEBAUTHENTICATION
- **Use Case**: Browser-based, hardware security keys
- **Trust Score**: 90 base
- **Data Required**: WebAuthn credentials

### TPM
- **Use Case**: Windows devices with TPM 2.0
- **Trust Score**: 100 base
- **Data Required**: AIK certificate, PCR values

### SAFETYNET (Android)
- **Use Case**: Android devices
- **Trust Score**: 95 base
- **Data Required**: SafetyNet JWS token

### DEVICECHECK (iOS)
- **Use Case**: iOS devices
- **Trust Score**: 95 base
- **Data Required**: DeviceCheck token

## Common Patterns

### Pattern 1: Login with Device Attestation
```javascript
async function loginWithDeviceAttestation(username, password, deviceId) {
  // 1. Authenticate user
  const user = await authenticateUser(username, password);
  
  // 2. Check existing device attestation
  const attestation = await fetch(`/api/device-attestation/verify/${deviceId}`);
  const attestResult = await attestation.json();
  
  // 3. If no valid attestation, require it
  if (!attestResult.valid) {
    return {
      success: false,
      requiresAttestation: true,
      deviceId
    };
  }
  
  // 4. Check trust score
  const trust = await fetch(`/api/device-attestation/trust-score/${deviceId}`);
  const trustResult = await trust.json();
  
  if (trustResult.trustScore < 60) {
    return {
      success: false,
      requiresMFA: true,
      reason: 'LOW_DEVICE_TRUST'
    };
  }
  
  // 5. Create session
  return { success: true, sessionId: '...' };
}
```

### Pattern 2: Periodic Re-Attestation
```javascript
// Check if attestation needs renewal
setInterval(async () => {
  const response = await fetch(`/api/device-attestation/verify/${deviceId}`);
  const result = await response.json();
  
  if (result.renewalRequired) {
    // Perform background re-attestation
    await performAttestation('FALLBACK');
  }
}, 3600000); // Check hourly
```

### Pattern 3: Risk-Based Access Control
```javascript
async function checkAccessPermission(userId, deviceId, action) {
  const trust = await fetch(`/api/device-attestation/trust-component/${deviceId}`);
  const trustData = await trust.json();
  
  const riskLevels = {
    'VIEW_BALANCE': 40,
    'TRANSFER_FUNDS': 70,
    'CHANGE_SETTINGS': 60,
    'DELETE_ACCOUNT': 80
  };
  
  const requiredScore = riskLevels[action] || 60;
  
  if (trustData.deviceTrustScore < requiredScore) {
    return {
      allowed: false,
      reason: 'INSUFFICIENT_DEVICE_TRUST',
      currentScore: trustData.deviceTrustScore,
      requiredScore
    };
  }
  
  return { allowed: true };
}
```

## Troubleshooting

### Issue: Low Trust Score
**Cause**: Device failing security checks or has suspicious binding changes
**Solution**: 
1. Check integrity: `GET /api/device-attestation/integrity-check`
2. Review anomalies: `GET /api/device-attestation/anomalies/:deviceId`
3. View history: `GET /api/device-attestation/history/:deviceId`

### Issue: Attestation Fails
**Cause**: Provider-specific validation failure
**Solution**: 
1. Try fallback provider
2. Check provider-specific configuration
3. Review logs for specific error

### Issue: Cache Not Working
**Cause**: TTL expired or cache invalidated
**Solution**:
1. Check cache stats: `GET /api/device-attestation/cache-stats`
2. Verify TTL configuration
3. Check for manual invalidation events

## Best Practices

1. **Always Use Device ID Header**: Include `X-Device-ID` in all requests
2. **Implement Fallback**: Use FALLBACK provider when hardware unavailable
3. **Monitor Active Sessions**: Enable continuous trust monitoring
4. **Cache Aggressively**: Leverage cache for performance
5. **Handle Failures Gracefully**: Provide clear user feedback
6. **Log Everything**: Record all attestation events for forensics
7. **Regular Re-Attestation**: Don't rely on stale attestations
8. **Progressive Enhancement**: Start with low requirements, increase as trust builds

## Security Checklist

- [ ] Device ID persisted securely on client
- [ ] HTTPS enforced for all attestation endpoints
- [ ] Rate limiting enabled on attestation APIs
- [ ] Environment variables configured
- [ ] Database indexes created
- [ ] Cache TTLs configured appropriately
- [ ] Monitoring alerts set up for low trust sessions
- [ ] User notifications configured
- [ ] Forensic logging enabled
- [ ] Regular attestation renewal scheduled

## Support

For issues or questions:
- Review full documentation: `ISSUE_893_IMPLEMENTATION_SUMMARY.md`
- Check model definitions in `models/`
- Review service implementations in `services/`
- Examine example UI: `device-verification.html`

---

**Quick Start Complete!** You're ready to integrate device attestation. 🚀
