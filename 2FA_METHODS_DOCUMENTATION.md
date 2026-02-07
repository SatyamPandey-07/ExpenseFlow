# Two-Factor Authentication (2FA) Methods Documentation

## Overview

ExpenseFlow now supports **four (4) comprehensive two-factor authentication methods** to secure user accounts:

1. **TOTP (Time-based One-Time Password)** - Google Authenticator, Authy
2. **Email Verification Codes**
3. **SMS Voice Codes** (optional)
4. **Backup Codes** (for account recovery)

---

## 1. TOTP (Time-based One-Time Password)

### Description
Uses authenticator applications like Google Authenticator, Microsoft Authenticator, or Authy to generate time-based codes. These codes refresh every 30 seconds and don't require internet for verification.

### Files
- **Backend Service**: `services/twoFactorAuthService.js`
  - `generateTOTPSecret(userId, userEmail)` - Generate QR code and secret key
  - `verifyAndEnableTOTP(userId, totpCode)` - Enable TOTP after verification
  - `verifyTOTPCode(userId, totpCode)` - Verify code during login

- **API Routes**: `routes/twoFactorAuth.js`
  - `POST /2fa/setup/initiate` - Generate TOTP secret and QR code
  - `POST /2fa/setup/verify` - Verify TOTP code and enable 2FA
  - `POST /2fa/verify` - Verify TOTP during login

- **Frontend**: 
  - `2fa-setup.html` - Setup wizard UI
  - `2fa-setup.js` - TOTP setup logic
  - `2fa-manage.js` - 2FA management dashboard

### Setup Flow
```
1. User selects "Authenticator App (TOTP)" method
2. System generates QR code and manual entry key
3. User scans QR code with authenticator app
4. User enters 6-digit code from app to verify
5. Backup codes are generated (10 codes)
6. Setup complete
```

### Advantages
- ✅ Most secure - doesn't rely on SMS/email
- ✅ Works offline
- ✅ No SMS costs
- ✅ Industry standard

### Disadvantages
- ⚠ Requires authenticator app installation
- ⚠ Can be lost if device is replaced

---

## 2. Email Verification Codes

### Description
Users receive 6-digit verification codes via email that expire after 10 minutes. Codes are one-time use only.

### Files
- **Backend Service**: `services/twoFactorAuthService.js`
  - `setupEmailMethod(userId, recoveryEmail)` - Setup email verification
  - `verifyAndEnableEmail(userId, verificationCode)` - Enable email 2FA
  - `send2FACodeEmail(userId, email)` - Send code during login
  - `verify2FACodeEmail(userId, code)` - Verify email code
  - `verifyEmailCode(userId, code)` - Verify during login

- **API Routes**: `routes/twoFactorAuth.js`
  - `POST /2fa/email/setup` - Send verification code to email
  - `POST /2fa/email/verify` - Verify email and enable 2FA
  - `POST /2fa/email/verify-login` - Verify email code during login
  - `POST /2fa/send-code-email` - Send code during login

- **Frontend**:
  - `2fa-setup.html` - Email setup wizard UI
  - `2fa-setup.js` - Email setup and verification logic

### Setup Flow
```
1. User selects "Email Verification" method
2. User enters recovery email address
3. System sends 6-digit code to email
4. User enters code to verify email
5. Email 2FA enabled with backup codes
6. Setup complete
```

### Verification Flow (Login)
```
1. User enters username/password
2. System prompts for 2FA code
3. System sends code to registered email
4. User enters code
5. Login successful
```

### Advantages
- ✅ No phone number needed
- ✅ Easy recovery method
- ✅ Works with any email
- ✅ Good fallback option

### Disadvantages
- ⚠ Requires email access
- ⚠ Codes expire after 10 minutes
- ⚠ Depends on email service reliability

### Configuration
```javascript
// Email code expires in 10 minutes
expiresAt: new Date(Date.now() + 10 * 60 * 1000)

// Max 5 failed attempts before temporary lock
if (failedAttempts >= 5) {
  lockTemporarily(15); // 15 minute lockout
}
```

---

## 3. SMS Verification Codes

### Description
Users receive 6-digit verification codes via SMS text message to their phone. Codes expire after 10 minutes and are one-time use.

### Files
- **Backend Service**: `services/twoFactorAuthService.js`
  - `sendSMSCode(userId, phoneNumber)` - Send SMS code for setup
  - `verifyAndEnableSMS(userId, phoneNumber, code)` - Enable SMS 2FA
  - `verifySMSCode(userId, code)` - Verify SMS code
  - `_sendSMSViaProvider(phoneNumber, message)` - Send via SMS provider

- **API Routes**: `routes/twoFactorAuth.js`
  - `POST /2fa/sms/send-code` - Send SMS code for setup
  - `POST /2fa/sms/verify` - Verify SMS code and enable 2FA
  - `POST /2fa/sms/verify-login` - Verify SMS code during login

- **Frontend**:
  - `2fa-setup.html` - SMS setup wizard UI
  - `2fa-setup.js` - SMS setup and verification logic

### Setup Flow
```
1. User selects "SMS Text Message" method
2. User enters phone number (with country code)
3. System sends 6-digit code via SMS
4. User enters code to verify phone
5. SMS 2FA enabled with backup codes
6. Setup complete
```

### Verification Flow (Login)
```
1. User enters username/password
2. System prompts for 2FA code
3. System sends code via SMS
4. User enters code
5. Login successful
```

### SMS Provider Integration

**Current Status**: Placeholder implementation with logging

**To Integrate Twilio**:
```javascript
// In _sendSMSViaProvider method
const twilio = require('twilio');
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

await client.messages.create({
  body: message,
  from: process.env.TWILIO_PHONE_NUMBER,
  to: phoneNumber
});
```

**Environment Variables Required**:
```
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

**Alternative Providers**:
- AWS SNS (Simple Notification Service)
- Firebase Cloud Messaging
- Nexmo/Vonage
- Bandwidth
- Amazon Pinpoint

### Advantages
- ✅ Easy to use - most people have phones
- ✅ Works without app installation
- ✅ Familiar for most users
- ✅ Fast delivery typically

### Disadvantages
- ⚠ Requires phone number
- ⚠ SMS costs
- ⚠ Vulnerable to SIM swap attacks
- ⚠ Requires carrier/SMS provider reliability

### Security Considerations
- Phone numbers are masked in logs: `***-***-1234`
- Codes are one-time use only
- Account locks after 5 failed attempts for 15 minutes
- Codes expire after 10 minutes

---

## 4. Backup Codes

### Description
Emergency codes for account recovery when primary 2FA method is unavailable. Each code is one-time use, 8-character hexadecimal format.

### Files
- **Backend Service**: `services/twoFactorAuthService.js`
  - `generateBackupCodes(count)` - Generate new backup codes
  - `verifyBackupCode(userId, backupCode)` - Verify backup code
  - `regenerateBackupCodes(userId)` - Create new set of codes
  - `verifyBackupCodeWithOneTimeUse(userId, backupCode)` - Verify with enforcement

- **API Routes**: `routes/twoFactorAuth.js`
  - `POST /2fa/backup-codes/regenerate` - Generate new codes
  - `POST /2fa/backup-codes/download` - Download backup codes
  - `POST /2fa/verify` - Can verify with backup code

- **Database Model**: `models/TwoFactorAuth.js`
  - `backupCodes` array (codes, used status, usage timestamp)

- **Frontend**:
  - `2fa-setup.html` - Display backup codes during setup
  - `2fa-manage.js` - Backup codes management

### Backup Codes Format
```
Type: Hexadecimal string
Length: 8 characters
Sample: A1B2C3D4, E5F6G7H8, etc.
Count: 10 codes per generation
```

### Usage Flow
```
1. During 2FA setup, 10 backup codes are generated
2. User must save codes in secure location
3. User can download/print codes
4. Codes can be used as backup during login:
   - If primary 2FA method fails
   - If device is lost/replaced
5. Each code can only be used once
6. When 3 or fewer codes remain, alert user to regenerate
```

### Backup Code Management
```javascript
// Generate new codes (users can regenerate anytime)
POST /api/2fa/backup-codes/regenerate

// Download codes in text file
POST /api/2fa/backup-codes/download
  Response: Text file with unused codes

// Check remaining codes
GET /api/2fa/status
  Response: backupCodesRemaining: number
```

### Used Codes Tracking
```javascript
backupCode: {
  code: "A1B2C3D4",
  used: true,
  usedAt: "2024-02-06T10:30:00Z",
  createdAt: "2024-01-01T12:00:00Z"
}
```

### Advantages
- ✅ Essential account recovery option
- ✅ Works when phone/email unavailable
- ✅ One-time use prevents misuse
- ✅ Can be regenerated anytime

### Disadvantages
- ⚠ Must be stored securely
- ⚠ Limited quantity (10 codes)
- ⚠ One-time use only
- ⚠ Loss of all codes = account lockout

### Security Best Practices
Users should:
1. Store codes offline (printed paper, physical safe)
2. Not share codes with anyone
3. Regenerate if codes were exposed
4. Keep copy in secure location separate from device
5. Download/print before losing device access

---

## Data Model

### TwoFactorAuth Schema
```javascript
{
  userId: ObjectId,                    // User reference
  enabled: Boolean,                    // 2FA active status
  method: String,                      // 'totp' | 'sms' | 'email' | 'backup-codes'
  
  // TOTP Fields
  totpSecret: String,                  // Base32 encoded secret
  totpQrCode: String,                  // QR code image data
  totpVerifiedAt: Date,                // When TOTP was verified
  
  // SMS Fields
  phoneNumber: String,                 // Masked in logs
  phoneVerified: Boolean,
  phoneVerificationCode: String,
  phoneVerificationExpires: Date,
  
  // Email Fields
  recoveryEmail: String,
  recoveryEmailVerified: Boolean,
  recoveryEmailVerificationCode: String,
  recoveryEmailVerificationExpires: Date,
  
  // Backup Codes
  backupCodes: [{
    code: String,                      // 8-character hex
    used: Boolean,
    usedAt: Date,
    createdAt: Date
  }],
  
  // Setup/Enrollment
  setupSecret: String,                 // Temporary during setup
  setupSecretExpires: Date,
  setupAttempts: Number,
  enrolledAt: Date,
  enrollmentCompletedAt: Date,
  
  // Activity & Security
  lastUsedAt: Date,
  lastUsedIp: String,
  failedAttempts: Number,
  lockedUntil: Date,
  
  // Settings
  requireForSensitiveActions: Boolean, // Force 2FA for sensitive ops
  rememberDeviceForDays: Number        // Device trust duration
}
```

---

## API Endpoints Summary

### TOTP Endpoints
```
POST   /api/2fa/setup/initiate          Generate TOTP secret & QR code
POST   /api/2fa/setup/verify            Verify TOTP & enable 2FA
POST   /api/2fa/verify                  Verify TOTP during login
```

### Email Endpoints
```
POST   /api/2fa/email/setup             Send verification code to email
POST   /api/2fa/email/verify            Enable email 2FA
POST   /api/2fa/email/verify-login      Verify code during login
POST   /api/2fa/send-code-email         Send code during login
```

### SMS Endpoints
```
POST   /api/2fa/sms/send-code           Send SMS code for setup
POST   /api/2fa/sms/verify              Enable SMS 2FA
POST   /api/2fa/sms/verify-login        Verify SMS code during login
```

### Management Endpoints
```
GET    /api/2fa/status                  Get 2FA status
POST   /api/2fa/disable                 Disable 2FA (with password)
POST   /api/2fa/method/switch           Switch between methods
POST   /api/2fa/backup-codes/regenerate Generate new backup codes
POST   /api/2fa/backup-codes/download   Download backup codes
GET    /api/2fa/trusted-devices         List trusted devices
POST   /api/2fa/trusted-devices         Add trusted device
DELETE /api/2fa/trusted-devices/:id     Remove trusted device
GET    /api/2fa/audit-log               2FA activity log
```

---

## Security Features

### Rate Limiting
- TOTP/SMS/Email verification: 5 attempts per 5 minutes
- Setup initiation: Controlled via `twoFactorLimiter` middleware

### Account Lockout
- 5 failed verification attempts → 15-minute temporary lock
- Lock prevents further attempts until timer expires
- Logs all lockout events for audit

### Code Expiration
- TOTP codes: 30-second window (within-window verification)
- Email codes: 10 minutes
- SMS codes: 10 minutes
- Expired codes cannot be used

### Force 2FA for Sensitive Actions
- Can require 2FA for: money transfers, settings changes, etc.
- Configurable per user account
- Tracked in audit logs

### Trusted Device Management
- Users can mark devices as trusted (30-day window)
- Each device gets unique fingerprint
- Trust renewal on each use
- Users can manually revoke device trust

### Audit Logging
All 2FA events logged with:
- Action type (setup, verify, switch, regenerate)
- Timestamp
- IP address
- User agent
- Result (success/failure)

---

## Recommended Setup Order

### For Users
1. Enable TOTP first (most secure)
2. Save backup codes immediately
3. Optional: Add email as secondary backup
4. Optional: Add SMS as tertiary backup

### For Organizations
1. Require TOTP for all users
2. Enforce backup code backup
3. Monitor 2FA adoption rates
4. Optional: Mandate email for recovery

---

## Troubleshooting

### TOTP Issues
**Problem**: QR code won't scan
- **Solution**: Manual entry using base32 key

**Problem**: Code always invalid
- **Solution**: Check device time sync, allow 30-second window

### Email Issues
**Problem**: Code not received
- **Solution**: Check spam folder, resend, verify email address

**Problem**: Code expired
- **Solution**: Codes valid for 10 minutes, request new one

### SMS Issues
**Problem**: SMS not received
- **Solution**: Verify phone number with country code, check carrier

**Problem**: Can't send SMS
- **Solution**: Verify Twilio/SMS provider configuration

### General Issues
**Problem**: Can't access account (lost all 2FA methods)
- **Contact**: Support team with identity verification
- **Recovery**: Admin can reset 2FA or send recovery code
- **Prevention**: Always save backup codes!

---

## Future Enhancements

Planned improvements:
- [ ] WebAuthn/FIDO2 support (hardware keys)
- [ ] Push notifications for mobile
- [ ] Biometric verification (Face ID, Touch ID)
- [ ] Recovery email functionality
- [ ] 2FA recovery questions
- [ ] Geolocation-based trust
- [ ] Step-up authentication for sensitive actions
- [ ] Multiple backup email addresses

---

## Configuration

### Environment Variables
```bash
# SMS Provider (if using SMS)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Email Configuration
SENDGRID_API_KEY=  # or your email provider
EMAIL_FROM=noreply@expenseflow.com

# 2FA Settings
TWO_FA_CODE_EXPIRY=600000            # 10 minutes in milliseconds
TWO_FA_LOCKOUT_TIME=900000           # 15 minutes lockout
TRUSTED_DEVICE_DURATION=30           # Days to trust device
```

### Code Examples

**Enable TOTP for User**:
```javascript
const result = await twoFactorAuthService.verifyAndEnableTOTP(userId, totpCode);
// Returns: { success: true, backupCodes: [...] }
```

**Verify During Login**:
```javascript
// TOTP
await twoFactorAuthService.verifyTOTPCode(userId, code);

// Email
await twoFactorAuthService.verifyEmailCode(userId, code);

// SMS
await twoFactorAuthService.verifySMSCode(userId, code);

// Backup Code
await twoFactorAuthService.verifyBackupCode(userId, code);
```

**Get Status**:
```javascript
const status = await twoFactorAuthService.get2FAStatus(userId);
// Returns: { enabled, method, backupCodesRemaining, ... }
```

---

## Testing Checklist

- [ ] TOTP: Generate QR, scan, verify code
- [ ] Email: Send code, verify, regenerate
- [ ] SMS: Send code (with provider), verify
- [ ] Backup codes: Generate, use, regenerate
- [ ] Session validation after 2FA
- [ ] Device trust functionality
- [ ] Audit logging of all events
- [ ] Failed attempt lockout
- [ ] Code expiration
- [ ] Recovery scenarios

---

## Authors & Contributors

**Implementation**: Issue #502 - Multiple 2FA Methods
- TOTP (Google Authenticator, Authy)
- Email Verification Codes
- SMS Verification Codes
- Backup Codes for Recovery

**Related Issues**:
- #503: 2FA Management
- #504: Security Requirements
- #505: Suspicious Login Detection
- #506: Device Trust & Fingerprinting

---

