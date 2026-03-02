# Credential Compromise Detection - Quick Start Guide

**Integration time:** 15-30 minutes  
**Difficulty:** Intermediate  
**Prerequisites:** ExpenseFlow authentication system, MongoDB, Express.js

---

## Table of Contents

1. [Quick Setup](#quick-setup)
2. [Basic Integration](#basic-integration)
3. [Common Use Cases](#common-use-cases)
4. [API Reference](#api-reference)
5. [Troubleshooting](#troubleshooting)

---

## Quick Setup

### Step 1: Environment Configuration

Add to your `.env` file:

```env
# Have I Been Pwned API Key (get from https://haveibeenpwned.com/API/Key)
HIBP_API_KEY=your-api-key-here

# Optional: Cache TTL (seconds)
CREDENTIAL_CACHE_TTL=86400

# Optional: Attack detection thresholds
SPRAY_DETECTION_THRESHOLD=5
STUFFING_DETECTION_THRESHOLD=10
```

### Step 2: Register Routes

In your main `server.js` or `app.js`:

```javascript
const credentialCompromiseRoutes = require('./routes/credentialCompromiseRoutes');

// Register routes
app.use('/api/credential-compromise', credentialCompromiseRoutes);
```

### Step 3: Verify Setup

Test the health endpoint:

```bash
curl http://localhost:3000/api/credential-compromise/health
```

Expected response:
```json
{
  "success": true,
  "service": "Credential Compromise Detection",
  "status": "operational",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## Basic Integration

### Use Case 1: Check Email During Registration

```javascript
const credentialCompromiseService = require('./services/credentialCompromiseService');

async function registerUser(email, password) {
  // Check if email is compromised
  const emailCheck = await credentialCompromiseService.checkCompromise(
    email,
    'EMAIL'
  );

  // Warn user if compromised
  if (emailCheck.compromised) {
    console.warn(`Email ${email} appears in ${emailCheck.totalBreaches} breaches`);
    
    // Option 1: Block registration
    if (emailCheck.riskLevel === 'CRITICAL') {
      return {
        success: false,
        error: 'This email has been compromised in critical breaches. Please use a different email.'
      };
    }
    
    // Option 2: Allow with warning
    // ... continue registration with warning
  }

  // Check password
  const passwordCheck = await credentialCompromiseService.checkPasswordHash(password);

  if (passwordCheck.compromised) {
    return {
      success: false,
      error: 'This password has been compromised. Please choose a different password.'
    };
  }

  // Proceed with registration
  const user = await createUser(email, password);
  return { success: true, user };
}
```

### Use Case 2: Detect Attacks During Login

```javascript
const attackPatternDetectionService = require('./services/attackPatternDetectionService');
const compromiseCorrelationService = require('./services/compromiseCorrelationService');

async function handleLogin(req, res) {
  const { email, password } = req.body;
  const sourceIP = req.ip;
  const userAgent = req.get('user-agent');

  // 1. Process login for attack detection
  const attackResult = await attackPatternDetectionService.processLoginAttempt({
    email,
    success: false, // Will update after authentication
    sourceIP,
    userAgent,
    timestamp: new Date()
  });

  // 2. Block if high-confidence attack detected
  if (attackResult.detected && attackResult.shouldBlock) {
    return res.status(403).json({
      error: 'Login blocked due to detected attack pattern',
      attackType: attackResult.attackType
    });
  }

  // 3. Authenticate user
  const user = await authenticateUser(email, password);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // 4. Correlate successful login with compromises
  const correlation = await compromiseCorrelationService.correlateLoginAttempt({
    userId: user._id,
    email,
    success: true,
    sourceIP,
    userAgent
  });

  // 5. Apply risk-based actions
  if (correlation.correlated && correlation.correlationScore >= 0.8) {
    return res.status(403).json({
      error: 'Login blocked: compromised credential detected in active attack',
      recommendations: correlation.recommendations
    });
  }

  if (correlation.riskBoost >= 30) {
    // Require MFA for suspicious logins
    return res.json({
      mfaRequired: true,
      reason: 'Additional verification required',
      sessionToken: generateTemporaryToken(user._id)
    });
  }

  // 6. Normal login flow
  const sessionToken = generateSessionToken(user._id);
  res.json({ success: true, token: sessionToken });
}
```

### Use Case 3: Password Strength Check

```javascript
async function changePassword(userId, newPassword) {
  // Check if password is compromised
  const result = await credentialCompromiseService.checkPasswordHash(newPassword);

  if (result.compromised) {
    return {
      success: false,
      error: `This password appears in ${result.totalBreachCount.toLocaleString()} data breaches`,
      severity: result.severity
    };
  }

  // Update password
  await updateUserPassword(userId, newPassword);

  // Mark user's compromises as resolved
  await credentialCompromiseService.recordUserAction(
    null, // Will auto-find user compromises
    userId,
    'PASSWORD_CHANGED'
  );

  return { success: true };
}
```

---

## Common Use Cases

### 1. User Dashboard Integration

Show user their compromise status:

```javascript
async function getUserSecurityDashboard(userId) {
  const compromises = await credentialCompromiseService.getUserCompromises(
    userId,
    { status: 'ACTIVE' }
  );

  return {
    totalCompromises: compromises.count,
    criticalCount: compromises.compromises.filter(c => c.riskLevel === 'CRITICAL').length,
    highCount: compromises.compromises.filter(c => c.riskLevel === 'HIGH').length,
    recentBreaches: compromises.compromises.slice(0, 5),
    securityScore: calculateSecurityScore(compromises)
  };
}
```

### 2. Automated Email Notifications

Send breach notifications:

```javascript
async function notifyUsersOfBreaches() {
  const recentCompromises = await CredentialCompromise.find({
    createdAt: { $gte: new Date(Date.now() - 86400000) }, // Last 24 hours
    status: 'ACTIVE',
    'affectedUsers.notified': false
  });

  for (const compromise of recentCompromises) {
    for (const affectedUser of compromise.affectedUsers) {
      if (!affectedUser.notified) {
        await sendBreachNotificationEmail(
          affectedUser.userId,
          compromise
        );

        await credentialCompromiseService.markUserNotified(
          compromise._id,
          affectedUser.userId
        );
      }
    }
  }
}
```

### 3. Admin Security Dashboard

Monitor attacks in real-time:

```javascript
async function getAdminSecurityDashboard() {
  const stats = await attackPatternDetectionService.getAttackStatistics(
    86400000 // Last 24 hours
  );

  const activeAttacks = await CredentialAttackPattern.find({
    status: 'IN_PROGRESS'
  }).sort({ severity: -1, createdAt: -1 });

  const recentCompromises = await CredentialCompromise.find({
    createdAt: { $gte: new Date(Date.now() - 86400000) }
  }).sort({ riskScore: -1 }).limit(20);

  return {
    attackStats: stats,
    activeAttacks,
    recentCompromises,
    summary: {
      totalAttacks: stats.stats.reduce((sum, s) => sum + s.count, 0),
      criticalAttacks: activeAttacks.filter(a => a.severity === 'CRITICAL').length,
      affectedUsers: activeAttacks.reduce((sum, a) => sum + a.targetedUsers.length, 0)
    }
  };
}
```

### 4. Scheduled Monitoring Job

Run periodic checks:

```javascript
const cron = require('node-cron');

// Check for compromised credentials daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('[CRON] Starting daily credential compromise check');

  // Get all active user emails
  const users = await User.find({ status: 'active' }).select('_id email');

  let checkedCount = 0;
  let compromisedCount = 0;

  for (const user of users) {
    const result = await credentialCompromiseService.checkCompromise(
      user.email,
      'EMAIL',
      { userId: user._id, useCache: true }
    );

    checkedCount++;

    if (result.compromised) {
      compromisedCount++;
      console.log(`[CRON] User ${user._id} has compromised credential`);
      
      // Send notification
      await sendBreachNotificationEmail(user._id, result);
    }

    // Rate limit: 10 checks per second
    if (checkedCount % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`[CRON] Daily check complete: ${checkedCount} checked, ${compromisedCount} compromised`);
});
```

### 5. Real-Time WebSocket Notifications

Push breach alerts to connected clients:

```javascript
const io = require('socket.io')(server);

// Listen for new compromises
async function setupBreachNotifications() {
  const CredentialCompromise = require('./models/CredentialCompromise');

  // Use MongoDB Change Streams
  const changeStream = CredentialCompromise.watch();

  changeStream.on('change', (change) => {
    if (change.operationType === 'insert') {
      const compromise = change.fullDocument;

      // Notify affected users via WebSocket
      compromise.affectedUsers.forEach(affectedUser => {
        io.to(affectedUser.userId.toString()).emit('breach-alert', {
          type: 'CREDENTIAL_COMPROMISED',
          severity: compromise.riskLevel,
          breachCount: compromise.breachSources.length,
          message: 'We detected that your credentials may have been compromised'
        });
      });
    }
  });
}
```

---

## API Reference

### Check Credential

```http
POST /api/credential-compromise/check
Content-Type: application/json

{
  "identifier": "user@example.com",
  "identifierType": "EMAIL",
  "userId": "optional-user-id",
  "providers": ["HIBP", "INTERNAL", "HONEYPOT"]
}
```

**Response:**
```json
{
  "success": true,
  "compromised": true,
  "identifier": "hashed-identifier",
  "identifierType": "EMAIL",
  "totalBreaches": 3,
  "breaches": [
    {
      "provider": "HIBP",
      "breachName": "Adobe",
      "breachDate": "2013-10-04T00:00:00.000Z",
      "severity": "HIGH",
      "dataClasses": ["Email addresses", "Passwords", "Usernames"]
    }
  ],
  "riskScore": 75,
  "riskLevel": "HIGH",
  "checkedAt": "2025-01-01T00:00:00.000Z"
}
```

### Check Password Hash

```http
POST /api/credential-compromise/check-password
Content-Type: application/json

{
  "password": "plaintextPassword",
  "providers": ["HIBP", "INTERNAL"]
}
```

**Response:**
```json
{
  "success": true,
  "compromised": true,
  "totalBreachCount": 12456,
  "providers": [
    {
      "name": "HIBP",
      "breachCount": 12456,
      "severity": "CRITICAL"
    }
  ],
  "severity": "CRITICAL",
  "checkedAt": "2025-01-01T00:00:00.000Z"
}
```

### Get User Compromises

```http
GET /api/credential-compromise/user/{userId}?status=ACTIVE&minRiskScore=60
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "compromises": [
    {
      "compromiseId": "compromise-id",
      "compromiseType": "EXTERNAL_BREACH",
      "riskScore": 85,
      "riskLevel": "CRITICAL",
      "status": "ACTIVE",
      "breachCount": 3,
      "breaches": [...],
      "userStatus": {
        "notified": false,
        "actionTaken": "NONE"
      },
      "discoveredAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

### Process Login for Attack Detection

```http
POST /api/credential-compromise/process-login
Content-Type: application/json

{
  "email": "user@example.com",
  "success": false,
  "sourceIP": "1.2.3.4",
  "userAgent": "Mozilla/5.0...",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

**Response:**
```json
{
  "success": true,
  "detected": true,
  "attackId": "PASSWORD_SPRAY-1234567890-abc123",
  "attackType": "PASSWORD_SPRAY",
  "severity": "HIGH",
  "shouldBlock": true,
  "recommendations": [
    {
      "action": "BLOCK_IP",
      "target": ["1.2.3.4"],
      "duration": "24h",
      "priority": "IMMEDIATE"
    }
  ]
}
```

### Correlate Login Attempt

```http
POST /api/credential-compromise/correlate-login
Content-Type: application/json

{
  "userId": "user-id",
  "email": "user@example.com",
  "success": true,
  "sourceIP": "1.2.3.4",
  "userAgent": "Mozilla/5.0...",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

**Response:**
```json
{
  "success": true,
  "correlated": true,
  "correlationScore": 0.75,
  "riskBoost": 35,
  "compromise": {
    "compromiseId": "compromise-id",
    "riskScore": 85,
    "breachCount": 3
  },
  "attackPatterns": [
    {
      "attackId": "CREDENTIAL_STUFFING-1234567890-xyz789",
      "attackType": "CREDENTIAL_STUFFING",
      "severity": "HIGH"
    }
  ],
  "recommendations": [
    {
      "action": "REQUIRE_MFA",
      "priority": "HIGH",
      "reason": "Moderate correlation detected"
    }
  ]
}
```

---

## Troubleshooting

### Issue: HIBP Rate Limit Errors

**Symptoms:**
```
Error: Rate limit exceeded
Code: RATE_LIMIT
```

**Solutions:**
1. Get an API key from https://haveibeenpwned.com/API/Key
2. Add to `.env`: `HIBP_API_KEY=your-key`
3. Increase cache TTL to reduce API calls
4. Use internal provider for high-volume checks

### Issue: Slow Password Checks

**Symptoms:**
- Password checks taking >2 seconds

**Solutions:**
1. Enable caching: `useCache: true` (default)
2. Check cache hit rate:
   ```javascript
   const stats = await CredentialIntelCache.getStatistics();
   console.log('Hit rate:', stats.hitRate);
   ```
3. Increase cache TTL for password hashes
4. Use internal provider for known compromises

### Issue: High Memory Usage

**Symptoms:**
- Memory usage increasing over time
- Node.js heap out of memory

**Solutions:**
1. Clear old cache entries:
   ```javascript
   await CredentialIntelCache.deleteMany({
     expiresAt: { $lt: new Date() }
   });
   ```

2. Reduce attack pattern buffer:
   ```javascript
   // In attackPatternDetectionService.js
   // Reduce buffer retention from 10 minutes to 5 minutes
   const cutoff = Date.now() - 300000; // 5 minutes
   ```

3. Use Redis for attempt buffering instead of in-memory

### Issue: False Positives

**Symptoms:**
- Legitimate logins flagged as attacks
- Users unable to log in

**Solutions:**
1. Adjust detection thresholds in `.env`:
   ```env
   SPRAY_DETECTION_THRESHOLD=10  # Increase from 5
   STUFFING_DETECTION_THRESHOLD=20  # Increase from 10
   ```

2. Whitelist trusted IPs:
   ```javascript
   const trustedIPs = ['1.2.3.4', '5.6.7.8'];
   if (trustedIPs.includes(sourceIP)) {
     return { detected: false };
   }
   ```

3. Review detection confidence:
   ```javascript
   // Only block high-confidence attacks
   if (attackResult.detected && attackResult.detectionConfidence >= 90) {
     // Block login
   }
   ```

### Issue: Missing Compromises

**Symptoms:**
- Known breaches not being detected
- Low breach counts

**Solutions:**
1. Verify HIBP API key is working
2. Check provider selection:
   ```javascript
   // Use all providers
   const result = await credentialCompromiseService.checkCompromise(
     email,
     'EMAIL',
     { providers: ['HIBP', 'INTERNAL', 'HONEYPOT'] }
   );
   ```

3. Clear stale cache:
   ```javascript
   await CredentialIntelCache.updateMany(
     { stale: true },
     { $set: { stale: false } }
   );
   ```

### Issue: Database Performance

**Symptoms:**
- Slow queries
- High CPU usage

**Solutions:**
1. Verify indexes are created:
   ```javascript
   await CredentialCompromise.collection.getIndexes();
   ```

2. Create missing indexes:
   ```javascript
   await CredentialCompromise.collection.createIndex({ identifier: 1, status: 1 });
   ```

3. Add query hints:
   ```javascript
   .find({ identifier: hash })
   .hint({ identifier: 1, status: 1 })
   ```

---

## Best Practices

### 1. Cache Management

```javascript
// Check cache statistics regularly
async function monitorCache() {
  const total = await CredentialIntelCache.countDocuments();
  const expired = await CredentialIntelCache.countDocuments({
    expiresAt: { $lt: new Date() }
  });
  const stale = await CredentialIntelCache.countDocuments({ stale: true });

  console.log('Cache stats:', { total, expired, stale });

  // Clean up expired entries
  if (expired > 1000) {
    await CredentialIntelCache.deleteMany({
      expiresAt: { $lt: new Date() }
    });
  }
}
```

### 2. Error Handling

```javascript
async function safeCompromiseCheck(email) {
  try {
    const result = await credentialCompromiseService.checkCompromise(email, 'EMAIL');
    return result;
  } catch (error) {
    console.error('Compromise check failed:', error);
    
    // Fail open (allow login) instead of fail closed
    return {
      success: false,
      error: error.message,
      compromised: null // Unknown
    };
  }
}
```

### 3. Rate Limiting

```javascript
// Implement application-level rate limiting
const rateLimit = require('express-rate-limit');

const compromiseCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: 'Too many requests, please try again later'
});

app.use('/api/credential-compromise', compromiseCheckLimiter);
```

### 4. Monitoring

```javascript
// Log important events
async function logSecurityEvent(event, data) {
  await SecurityLog.create({
    event,
    data,
    timestamp: new Date()
  });

  // Alert on critical events
  if (event === 'CRITICAL_COMPROMISE' || event === 'MASS_ATTACK') {
    await sendSecurityAlert(event, data);
  }
}
```

---

## Next Steps

1. **Test Integration**: Use provided examples to test in dev environment
2. **Configure Monitoring**: Set up logging and alerting
3. **User Communication**: Prepare breach notification templates
4. **Security Review**: Review attack thresholds for your use case
5. **Load Testing**: Ensure system handles expected traffic

For detailed documentation, see [ISSUE_894_IMPLEMENTATION_SUMMARY.md](ISSUE_894_IMPLEMENTATION_SUMMARY.md)

---

## Support

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section above
2. Review implementation summary for detailed information
3. Check service logs for error details
4. Test individual providers to isolate issues

