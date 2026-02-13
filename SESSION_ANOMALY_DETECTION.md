# Session Anomaly Detection Implementation

**Issue #562: Detect session hijacking via IP/UA drift and force re-authentication**

## Overview

This implementation provides comprehensive session anomaly detection to identify and prevent session hijacking attempts. The system monitors active user sessions for suspicious changes in:

- **IP Address (IP Drift)**: Detects when a session's IP address changes unexpectedly
- **User Agent (UA Drift)**: Identifies changes in browser/client information
- **Impossible Travel**: Flags geographically improbable location changes
- **Rapid Session Switching**: Detects suspicious patterns of multiple concurrent sessions

## Architecture

### Components

1. **SessionAnomalyDetectionService** (`services/sessionAnomalyDetectionService.js`)
   - Core anomaly detection logic
   - Risk scoring and classification
   - Security event logging
   - Session revocation

2. **Session Anomaly Middleware** (`middleware/sessionAnomalyDetection.js`)
   - Request-level anomaly checking
   - Automatic enforcement of security policies
   - Multiple enforcement modes (standard, strict)

3. **Enhanced Authentication Middleware** (`middleware/auth.js`)
   - Integrated session validation with anomaly detection
   - Automatic session revocation for critical threats
   - Seamless integration with existing auth flow

4. **Security Event Model** (`models/SecurityEvent.js`)
   - Updated with new event types for session anomalies
   - Comprehensive audit trail

## How It Works

### Detection Flow

```
1. User makes authenticated request
2. Auth middleware validates JWT and session
3. Session anomaly check is performed:
   - Compare current IP with session IP
   - Compare current UA with session UA
   - Check for impossible travel patterns
   - Check for rapid session switching
4. Calculate risk score based on findings
5. Determine action based on risk level:
   - ALLOW: Normal operation (risk < 25)
   - WARN: Log warning, allow access (risk 25-49)
   - REQUIRE_2FA: Request 2FA verification (risk 50-74)
   - FORCE_REAUTH: Revoke session, require login (risk ≥ 75)
```

### Risk Scoring

The system assigns risk points for each anomaly type:

| Anomaly Type | Risk Points |
|--------------|-------------|
| IP Drift (strict) | 40 |
| IP Drift (flexible) | 15 |
| User Agent Drift | 35 |
| Impossible Travel | 25 |
| Rapid Session Switching | 20 |

**Risk Thresholds:**
- **Low**: 25-49 (Warning only)
- **Medium**: 50-74 (Require 2FA)
- **High**: 75-89 (Force re-authentication)
- **Critical**: 90+ (Force re-authentication)

## Usage

### Basic Integration (Automatic)

The session anomaly detection is automatically integrated into the standard `auth` middleware:

```javascript
const { auth } = require('./middleware/auth');

// Session anomaly detection is automatically applied
router.get('/api/transactions', auth, getTransactions);
```

### Manual Integration (Custom Control)

For more control over anomaly detection behavior:

```javascript
const { auth, checkSessionAnomaly } = require('./middleware/auth');

// Apply anomaly detection as a separate middleware
router.get('/api/transactions', auth, checkSessionAnomaly, getTransactions);
```

### Strict Mode (High-Security Endpoints)

For sensitive endpoints that require zero-tolerance for anomalies:

```javascript
const { auth, strictSessionAnomaly } = require('./middleware/auth');

// Strict mode: any anomaly results in session revocation
router.post('/api/account/delete', auth, strictSessionAnomaly, deleteAccount);
router.post('/api/transfer/funds', auth, strictSessionAnomaly, transferFunds);
```

### Custom Risk Handling

```javascript
const { auth } = require('./middleware/auth');

router.get('/api/data', auth, (req, res) => {
  // Access anomaly information
  if (req.sessionAnomaly && req.sessionAnomaly.hasAnomaly) {
    console.log('Anomaly detected:', req.sessionAnomaly);
    console.log('Risk score:', req.sessionAnomaly.riskScore);
    console.log('Anomaly types:', req.sessionAnomaly.anomalyType);
  }
  
  // Continue with normal processing
  res.json({ data: 'your data' });
});
```

## Configuration

### Service Configuration

Edit `services/sessionAnomalyDetectionService.js`:

```javascript
static config = {
  // Allow minor User-Agent changes (browser updates)
  strictUserAgentMatching: false,
  
  // Allow IP changes (useful for mobile users)
  allowIPChange: false,
  
  // Geographic distance threshold (kilometers)
  maxGeoDistanceThreshold: 500,
  
  // Impossible travel time threshold (minutes)
  impossibleTravelThreshold: 60,
  
  // Risk score thresholds
  riskScoreThresholds: {
    low: 25,
    medium: 50,
    high: 75,
    critical: 90
  }
};
```

### Common Configuration Scenarios

#### Mobile-Friendly (Allow IP Changes)
```javascript
allowIPChange: true,  // Reduces IP drift risk to 15 points
```

#### Strict Security (No Tolerance)
```javascript
strictUserAgentMatching: true,
allowIPChange: false,
riskScoreThresholds: {
  low: 15,
  medium: 30,
  high: 50,
  critical: 70
}
```

## API Endpoints

### Get Session Anomaly Statistics

```javascript
const { getAnomalyStats } = require('./middleware/sessionAnomalyDetection');

router.get('/api/security/anomaly-stats', auth, getAnomalyStats);
router.get('/api/security/anomaly-stats/:userId', auth, getAnomalyStats);
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
      "USER_AGENT_DRIFT": 1,
      "RAPID_SESSION_SWITCHING": 1
    },
    "recentEvents": [
      {
        "timestamp": "2026-02-06T10:30:00Z",
        "severity": "high",
        "anomalyTypes": "IP_DRIFT, USER_AGENT_DRIFT",
        "riskScore": 75
      }
    ],
    "averageRiskScore": 62.5
  }
}
```

## Security Events

Session anomalies generate the following security events:

- `SESSION_ANOMALY_DETECTED`: General anomaly detection event
- `FORCED_REAUTH`: Session was revoked due to anomaly
- `IP_DRIFT_DETECTED`: IP address change detected
- `USER_AGENT_DRIFT_DETECTED`: User agent change detected
- `IMPOSSIBLE_TRAVEL_DETECTED`: Impossible travel pattern detected
- `RAPID_SESSION_SWITCHING_DETECTED`: Suspicious session switching detected

All events are logged to:
1. `SecurityEvent` collection (for security monitoring)
2. `AuditLog` collection (for compliance/audit)

## Client-Side Integration

### Handling Session Anomaly Responses

```javascript
// Handle session revocation
fetch('/api/transactions', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
.then(response => {
  if (response.status === 401) {
    return response.json().then(data => {
      if (data.code === 'SESSION_ANOMALY_DETECTED' || 
          data.code === 'SESSION_ANOMALY_REAUTH_REQUIRED') {
        // Session was revoked due to anomaly
        alert('Security alert: Unusual activity detected. Please login again.');
        redirectToLogin();
      }
    });
  }
  return response.json();
});
```

### Handling 2FA Requirements

```javascript
.then(response => {
  if (response.status === 403) {
    return response.json().then(data => {
      if (data.code === 'SESSION_ANOMALY_2FA_REQUIRED') {
        // Anomaly detected, 2FA verification required
        const totpToken = prompt('Enter your 2FA code:');
        
        // Retry request with 2FA token
        return fetch('/api/transactions', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-TOTP-Token': totpToken
          }
        });
      }
    });
  }
  return response.json();
});
```

## Monitoring & Alerts

### Real-Time Monitoring

Session anomalies are logged in real-time. Integrate with your monitoring system:

```javascript
// Example: Send alerts for critical anomalies
SecurityEvent.watch().on('change', async (change) => {
  if (change.operationType === 'insert' && 
      change.fullDocument.eventType === 'SESSION_ANOMALY_DETECTED' &&
      change.fullDocument.severity === 'critical') {
    
    await sendSecurityAlert({
      userId: change.fullDocument.userId,
      anomaly: change.fullDocument.details,
      riskScore: change.fullDocument.riskScore
    });
  }
});
```

### Dashboard Queries

Get anomaly statistics for dashboards:

```javascript
// Recent anomalies
const recentAnomalies = await SecurityEvent.find({
  eventType: 'SESSION_ANOMALY_DETECTED',
  createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
})
.sort({ createdAt: -1 })
.populate('userId', 'email name');

// Anomaly trends
const trends = await SecurityEvent.aggregate([
  {
    $match: {
      eventType: 'SESSION_ANOMALY_DETECTED',
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    }
  },
  {
    $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      count: { $sum: 1 },
      avgRiskScore: { $avg: '$riskScore' }
    }
  },
  { $sort: { _id: 1 } }
]);
```

## Testing

### Manual Testing

1. **Test IP Drift Detection:**
   ```bash
   # Login normally
   curl -X POST http://localhost:5000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password"}'
   
   # Make request with different IP (use a proxy or VPN)
   curl -X GET http://localhost:5000/api/transactions \
     -H "Authorization: Bearer <token>" \
     --proxy http://different-proxy:8080
   ```

2. **Test User Agent Drift:**
   ```bash
   # Login with one user agent
   curl -X POST http://localhost:5000/api/auth/login \
     -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)" \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password"}'
   
   # Make request with different user agent
   curl -X GET http://localhost:5000/api/transactions \
     -H "Authorization: Bearer <token>" \
     -H "User-Agent: curl/7.68.0"
   ```

### Automated Testing

```javascript
describe('Session Anomaly Detection', () => {
  it('should detect IP drift', async () => {
    // Login from IP 1
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '192.168.1.1')
      .send({ email: 'user@test.com', password: 'password' });
    
    const token = loginRes.body.token;
    
    // Request from IP 2
    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.0.0.1');
    
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_ANOMALY_DETECTED');
  });
});
```

## Performance Considerations

- **Caching**: Session data is cached during authentication
- **Database Queries**: Optimized with indexes on session lookups
- **Async Processing**: Security event logging is non-blocking
- **Fail-Open vs Fail-Closed**: Default middleware fails open; use strict mode for fail-closed behavior

## Security Best Practices

1. **Enable for All Authenticated Routes**: Apply anomaly detection globally
2. **Use Strict Mode for Sensitive Operations**: Bank transfers, account changes, etc.
3. **Monitor Trends**: Set up dashboards to track anomaly patterns
4. **Adjust Thresholds**: Fine-tune based on your user base (mobile vs desktop)
5. **User Notifications**: Alert users when sessions are revoked
6. **Rate Limiting**: Combine with rate limiting for comprehensive protection
7. **Geolocation Services**: Integrate IP geolocation for better impossible travel detection

## Troubleshooting

### False Positives

**Mobile Users:**
- Set `allowIPChange: true` for mobile-friendly behavior
- Mobile networks frequently change IPs

**Browser Updates:**
- Set `strictUserAgentMatching: false` (default)
- Allows minor version changes

**VPN Users:**
- Consider whitelisting known VPN IP ranges
- Or adjust risk thresholds

### Performance Issues

**High Database Load:**
- Ensure indexes are created on Session collection
- Consider Redis caching for session lookups

**Slow Anomaly Checks:**
- Disable impossible travel checks if not using geolocation
- Use connection pooling for database queries

## Future Enhancements

- [ ] IP Geolocation integration for accurate impossible travel detection
- [ ] Machine learning-based anomaly detection
- [ ] Behavioral biometrics (typing patterns, mouse movements)
- [ ] Device fingerprinting integration
- [ ] Configurable per-user risk tolerance
- [ ] Automatic IP reputation checking
- [ ] Time-based access patterns

## Related Issues

- #338: Enterprise-Grade Audit Trail & TOTP Security Suite
- #504: Security Requirements (Suspicious Login Detection)
- #562: Session Anomaly Detection (this implementation)

## Support

For questions or issues, contact the security team or open an issue in the repository.
