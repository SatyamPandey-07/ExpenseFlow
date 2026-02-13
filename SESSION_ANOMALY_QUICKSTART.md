# Session Anomaly Detection - Quick Start Guide

**Issue #562: Session Hijacking Detection**

## 🚀 Quick Start (5 Minutes)

### 1. Basic Usage (Already Working!)

The session anomaly detection is **automatically enabled** on all authenticated routes using the `auth` middleware:

```javascript
const { auth } = require('./middleware/auth');

// Session anomaly detection is automatic!
router.get('/api/transactions', auth, getTransactions);
router.post('/api/profile/update', auth, updateProfile);
```

**That's it!** Your routes are now protected against session hijacking.

### 2. High-Security Endpoints (Recommended for Sensitive Operations)

For sensitive operations like financial transactions or account changes, use strict mode:

```javascript
const { auth, strictSessionAnomaly } = require('./middleware/auth');

// Zero-tolerance for anomalies
router.post('/api/transfer/funds', auth, strictSessionAnomaly, transferFunds);
router.delete('/api/account', auth, strictSessionAnomaly, deleteAccount);
router.put('/api/password', auth, strictSessionAnomaly, changePassword);
```

### 3. Monitor Anomalies (Optional)

Add anomaly statistics endpoint to your security routes:

```javascript
const { getAnomalyStats } = require('./middleware/sessionAnomalyDetection');

// GET /api/security/anomaly-stats
router.get('/security/anomaly-stats', auth, getAnomalyStats);
```

## 📊 What Gets Detected?

| Anomaly Type | Description | Risk Score |
|--------------|-------------|------------|
| **IP Drift** | IP address changed during session | 40 points |
| **UA Drift** | Browser/client changed during session | 35 points |
| **Impossible Travel** | Location changed too quickly | 25 points |
| **Rapid Switching** | Too many concurrent sessions | 20 points |

## 🎯 Actions Taken

Based on the risk score, the system will:

| Risk Score | Action | What Happens |
|------------|--------|--------------|
| 0-24 | ✅ **ALLOW** | Normal operation |
| 25-49 | ⚠️ **WARN** | Log warning, allow access |
| 50-74 | 🔐 **REQUIRE 2FA** | Request 2FA code |
| 75+ | 🚫 **FORCE REAUTH** | Revoke session, require login |

## 💻 Client-Side Handling

### Handle Forced Re-Authentication

```javascript
async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${getToken()}`
    }
  });
  
  if (response.status === 401) {
    const data = await response.json();
    
    if (data.code === 'SESSION_ANOMALY_DETECTED') {
      // Session was revoked due to security anomaly
      alert('Security alert: Unusual activity detected. Please login again.');
      redirectToLogin();
      return;
    }
  }
  
  return response.json();
}
```

### Handle 2FA Requirements

```javascript
async function apiRequest(url, options = {}) {
  let response = await fetch(url, options);
  
  if (response.status === 403) {
    const data = await response.json();
    
    if (data.code === 'SESSION_ANOMALY_2FA_REQUIRED') {
      // Anomaly detected - need 2FA
      const totpToken = await show2FAPrompt();
      
      // Retry with 2FA token
      response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'X-TOTP-Token': totpToken
        }
      });
    }
  }
  
  return response.json();
}
```

## ⚙️ Configuration (Optional)

Default configuration works for most applications. To customize, edit `services/sessionAnomalyDetectionService.js`:

### Mobile-Friendly (Allow IP Changes)

```javascript
static config = {
  allowIPChange: true,  // ⬅️ Change this
  strictUserAgentMatching: false,
  // ... rest of config
};
```

### More Strict (Lower Thresholds)

```javascript
static config = {
  // ... other settings
  riskScoreThresholds: {
    low: 15,      // ⬅️ Lower thresholds
    medium: 30,
    high: 50,
    critical: 70
  }
};
```

## 🧪 Testing

### Test IP Drift (Manual)

```bash
# 1. Login and save token
TOKEN=$(curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  | jq -r '.token')

# 2. Try to access from different IP (will be blocked)
curl -X GET http://localhost:5000/api/transactions \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Forwarded-For: 10.0.0.1" \
  -v
# Expected: 401 Unauthorized with SESSION_ANOMALY_DETECTED
```

### Test User Agent Drift (Manual)

```bash
# 1. Login with Chrome
TOKEN=$(curl -X POST http://localhost:5000/api/auth/login \
  -H "User-Agent: Mozilla/5.0 Chrome/120.0" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  | jq -r '.token')

# 2. Try to access with curl (different UA, will be blocked)
curl -X GET http://localhost:5000/api/transactions \
  -H "Authorization: Bearer $TOKEN" \
  -v
# Expected: 401 Unauthorized with SESSION_ANOMALY_DETECTED
```

### Run Automated Tests

```bash
npm test -- sessionAnomalyDetection.test.js
```

## 📈 Monitoring

### View Anomaly Statistics

```bash
# Get your anomaly stats (last 30 days)
curl -X GET http://localhost:5000/api/security/anomaly-stats \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "success": true,
  "userId": "user123",
  "period": "30 days",
  "statistics": {
    "totalAnomalies": 5,
    "anomalyTypes": {
      "IP_DRIFT": 3,
      "USER_AGENT_DRIFT": 2
    },
    "averageRiskScore": 62.5,
    "recentEvents": [...]
  }
}
```

### Database Queries

```javascript
// Find recent anomalies
const anomalies = await SecurityEvent.find({
  eventType: 'SESSION_ANOMALY_DETECTED',
  createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
}).sort({ createdAt: -1 });

// Count by type
const counts = await SecurityEvent.aggregate([
  { $match: { eventType: 'SESSION_ANOMALY_DETECTED' } },
  { $group: { _id: '$details.anomalyTypes', count: { $sum: 1 } } }
]);
```

## 🔐 Best Practices

### ✅ DO:

1. **Use strict mode for sensitive operations**
   ```javascript
   router.post('/api/transfer', auth, strictSessionAnomaly, handler);
   ```

2. **Monitor anomaly trends**
   - Set up alerts for high anomaly rates
   - Review false positives weekly

3. **Inform users**
   - Show clear messages when sessions are revoked
   - Provide security dashboard for users

4. **Adjust for your users**
   - Mobile-heavy? Enable `allowIPChange: true`
   - Desktop-only? Keep strict settings

### ❌ DON'T:

1. **Don't disable on all routes**
   - Keep protection enabled globally

2. **Don't ignore false positives**
   - Adjust thresholds if needed
   - Consider user patterns

3. **Don't skip client-side handling**
   - Always handle 401/403 responses
   - Provide good UX for re-auth

## 🐛 Troubleshooting

### Too Many False Positives?

**Problem:** Mobile users getting blocked frequently  
**Solution:** Enable IP change allowance
```javascript
allowIPChange: true
```

**Problem:** Browser updates triggering alerts  
**Solution:** Non-strict UA matching (default)
```javascript
strictUserAgentMatching: false
```

### Not Detecting Anomalies?

**Problem:** Anomalies not being detected  
**Solution:** Check if session validation is working
```javascript
// In your route, check:
console.log('Session ID:', req.sessionId);
console.log('Anomaly Check:', req.sessionAnomaly);
```

### Performance Issues?

**Problem:** Slow response times  
**Solution:** Ensure indexes are created
```bash
# Check indexes
db.sessions.getIndexes()
db.securityevents.getIndexes()
```

## 📚 Learn More

- **Full Documentation**: See `SESSION_ANOMALY_DETECTION.md`
- **Code Examples**: See `routes/exampleSessionAnomalyRoutes.js`
- **Test Suite**: See `tests/sessionAnomalyDetection.test.js`

## 🎉 You're Done!

Your application now has enterprise-grade session hijacking protection!

### Next Steps:

1. ✅ Session anomaly detection is already working
2. 🔐 Add strict mode to sensitive endpoints
3. 📊 Set up monitoring dashboard
4. 🧪 Run tests to verify
5. 🚀 Deploy with confidence!

---

**Questions?** Open an issue or check the full documentation.
