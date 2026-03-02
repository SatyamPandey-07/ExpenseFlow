const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');

const ImmutableAuditLog = (() => {
  try {
    return require('../models/ImmutableAuditLog');
  } catch (error) {
    return null;
  }
})();

/**
 * Key Management Service (KMS)
 * Issue #827 + #918: Enterprise Encryption Management and Key Rotation
 */

const KeyAccessPolicySchema = new mongoose.Schema({
  allowAll: { type: Boolean, default: true },
  allowedRoles: [{ type: String }],
  allowedUserIds: [{ type: String }],
  allowedServiceAccounts: [{ type: String }],
  allowedOperations: [{ type: String, enum: ['encrypt', 'decrypt', 'derive', 'rotate', 'backup', 'revoke', 'read'] }],
  requireReason: { type: Boolean, default: false }
}, { _id: false });

const EncryptionKeySchema = new mongoose.Schema({
  keyId: { type: String, required: true, unique: true },
  version: { type: Number, required: true, default: 1 },
  algorithm: { type: String, required: true, default: 'aes-256-gcm' },
  encryptedKey: { type: String, required: true },
  keyType: { type: String, enum: ['master', 'tenant', 'user', 'data', 'field', 'derived'], required: true },
  purpose: { type: String, required: true },
  tenantId: { type: String, default: null },
  userId: { type: String, default: null },
  parentKeyId: { type: String, default: null },
  status: {
    type: String,
    enum: ['active', 'rotating', 'deprecated', 'revoked'],
    default: 'active'
  },
  createdAt: { type: Date, default: Date.now },
  rotatedAt: { type: Date },
  expiresAt: { type: Date },
  metadata: {
    rotationPeriodDays: { type: Number, default: 90 },
    lastUsed: { type: Date },
    usageCount: { type: Number, default: 0 },
    revocationReason: { type: String },
    derivationContext: { type: String }
  },
  accessPolicy: { type: KeyAccessPolicySchema, default: () => ({ allowAll: true, allowedOperations: ['encrypt', 'decrypt', 'derive', 'rotate', 'backup', 'revoke', 'read'] }) },
  compliance: {
    pciDss: { type: Boolean, default: true },
    gdpr: { type: Boolean, default: true },
    hipaa: { type: Boolean, default: false }
  }
}, { timestamps: true });

EncryptionKeySchema.index({ keyId: 1, version: -1 });
EncryptionKeySchema.index({ status: 1, purpose: 1, tenantId: 1, userId: 1 });
EncryptionKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const KeyAuditSchema = new mongoose.Schema({
  eventType: { type: String, required: true },
  keyId: { type: String, index: true },
  purpose: { type: String, index: true },
  actor: {
    userId: { type: String },
    role: { type: String },
    serviceAccount: { type: String },
    ipAddress: { type: String }
  },
  operation: { type: String },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  details: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

KeyAuditSchema.index({ createdAt: -1, purpose: 1 });

const EncryptionKey = mongoose.models.EncryptionKey || mongoose.model('EncryptionKey', EncryptionKeySchema);
const KeyAuditLog = mongoose.models.KeyAuditLog || mongoose.model('KeyAuditLog', KeyAuditSchema);

class LocalKekProvider {
  constructor(service) {
    this.service = service;
    this.providerName = 'local-file';
  }

  async getMasterKEK() {
    const kekPath = process.env.KEK_PATH || path.join(__dirname, '../.keys/master.kek');
    let kekPassword = process.env.KEK_PASSWORD;

    if (!kekPassword) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('KEK_PASSWORD must be configured in production');
      }
      kekPassword = crypto.randomBytes(32).toString('base64');
      process.env.KEK_PASSWORD = kekPassword;
      console.warn('⚠ KEK_PASSWORD not set, using ephemeral development password');
    }

    if (kekPassword.length < 24) {
      throw new Error('KEK_PASSWORD must be at least 24 characters');
    }

    try {
      const encryptedKEK = await fs.readFile(kekPath, 'utf8');
      return await this.service.decryptKEK(encryptedKEK, kekPassword);
    } catch (error) {
      const kek = crypto.randomBytes(this.service.keyLength);
      const encryptedKEK = await this.service.encryptKEK(kek, kekPassword);

      const dir = path.dirname(kekPath);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.writeFile(kekPath, encryptedKEK, { mode: 0o600 });
      return kek;
    }
  }

  getStatus() {
    return { provider: this.providerName, healthy: true, mode: 'software' };
  }
}

class MockHsmProvider {
  constructor(service) {
    this.service = service;
    this.providerName = process.env.HSM_PROVIDER || 'mock-hsm';
  }

  async getMasterKEK() {
    const hsmMaster = process.env.HSM_MASTER_KEY;
    if (!hsmMaster) {
      throw new Error('HSM_MASTER_KEY is required when HSM is enabled');
    }

    const normalized = Buffer.from(hsmMaster, 'base64');
    if (normalized.length < this.service.keyLength) {
      throw new Error('HSM_MASTER_KEY must decode to at least 32 bytes');
    }

    return normalized.subarray(0, this.service.keyLength);
  }

  getStatus() {
    return {
      provider: this.providerName,
      healthy: true,
      mode: 'hsm-compatible'
    };
  }
}

class KeyManagementService {
  constructor() {
    this.defaultAlgorithm = process.env.KEY_DEFAULT_ALGORITHM || 'aes-256-gcm';
    this.keyLength = 32;
    this.ivLength = 16;
    this.authTagLength = 16;
    this.saltLength = 32;
    this.pbkdf2Iterations = parseInt(process.env.KEY_DERIVATION_ITERATIONS || '210000', 10);

    this.supportedAlgorithms = {
      'aes-256-gcm': { keyLength: 32, ivLength: 12, authTagLength: 16 },
      'aes-192-gcm': { keyLength: 24, ivLength: 12, authTagLength: 16 },
      'chacha20-poly1305': { keyLength: 32, ivLength: 12, authTagLength: 16 }
    };

    this.keyCache = new Map();
    this.purposeKeyIndex = new Map();
    this.cacheTimeout = 3600000;

    this.masterKEK = null;
    this.kekProvider = process.env.HSM_ENABLED === 'true' ? new MockHsmProvider(this) : new LocalKekProvider(this);

    this.initializePromise = this.initialize();
  }

  async initialize() {
    try {
      this.masterKEK = await this.kekProvider.getMasterKEK();
      const rotationCheckHours = parseInt(process.env.KEY_ROTATION_CHECK_INTERVAL || '24', 10);
      setInterval(() => this.checkKeyRotation(), rotationCheckHours * 60 * 60 * 1000);
      await this.logKeyEvent('kms.initialized', { provider: this.kekProvider.getStatus() });
      console.log('✓ Key Management Service initialized');
    } catch (error) {
      console.error('Failed to initialize KMS:', error);
      throw error;
    }
  }

  async ensureInitialized() {
    await this.initializePromise;
  }

  getAlgorithmSpec(algorithm = this.defaultAlgorithm) {
    const spec = this.supportedAlgorithms[algorithm];
    if (!spec) {
      throw new Error(`Unsupported encryption algorithm: ${algorithm}`);
    }
    return spec;
  }

  async encryptKEK(kek, password) {
    const salt = crypto.randomBytes(this.saltLength);
    const key = crypto.pbkdf2Sync(password, salt, this.pbkdf2Iterations, this.keyLength, 'sha256');
    const iv = crypto.randomBytes(this.ivLength);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(kek), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([salt, iv, authTag, encrypted]).toString('base64');
  }

  async decryptKEK(encryptedData, password) {
    const buffer = Buffer.from(encryptedData, 'base64');

    const salt = buffer.slice(0, this.saltLength);
    const iv = buffer.slice(this.saltLength, this.saltLength + this.ivLength);
    const authTag = buffer.slice(this.saltLength + this.ivLength, this.saltLength + this.ivLength + this.authTagLength);
    const encrypted = buffer.slice(this.saltLength + this.ivLength + this.authTagLength);

    const key = crypto.pbkdf2Sync(password, salt, this.pbkdf2Iterations, this.keyLength, 'sha256');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  async encryptWithKEK(dek) {
    await this.ensureInitialized();

    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKEK, iv);

    const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  async decryptWithKEK(encryptedDEK) {
    await this.ensureInitialized();

    const buffer = Buffer.from(encryptedDEK, 'base64');

    const iv = buffer.slice(0, this.ivLength);
    const authTag = buffer.slice(this.ivLength, this.ivLength + this.authTagLength);
    const encrypted = buffer.slice(this.ivLength + this.authTagLength);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKEK, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  getActor(actor = {}) {
    return {
      userId: actor.userId ? String(actor.userId) : null,
      role: actor.role || null,
      serviceAccount: actor.serviceAccount || null,
      ipAddress: actor.ipAddress || null
    };
  }

  async logKeyEvent(eventType, details = {}) {
    try {
      const actor = this.getActor(details.actor || {});

      await KeyAuditLog.create({
        eventType,
        keyId: details.keyId,
        purpose: details.purpose,
        actor,
        operation: details.operation,
        status: details.status || 'success',
        details
      });

      if (ImmutableAuditLog && details.actor?.auditUserId) {
        await ImmutableAuditLog.create({
          userId: details.actor.auditUserId,
          action: eventType,
          entityType: 'encryption_key',
          entityId: details.keyId,
          metadata: {
            ipAddress: actor.ipAddress,
            apiEndpoint: details.apiEndpoint,
            requestId: details.requestId
          },
          complianceFlags: [
            {
              standard: 'PCI_DSS',
              requirement: '3.5, 3.6 key-management operations logged',
              status: 'compliant',
              details: 'Encryption key operation logged via KMS audit trail'
            },
            {
              standard: 'ISO27001',
              requirement: 'A.10 cryptographic key lifecycle controls',
              status: 'compliant',
              details: 'Key lifecycle operation captured'
            }
          ],
          riskLevel: details.status === 'failed' ? 'high' : 'low'
        });
      }
    } catch (error) {
      console.error('Failed to write key audit event:', error.message);
    }
  }

  getPurposeCacheKey(purpose, tenantId = null, userId = null) {
    return `${purpose}::${tenantId || 'global'}::${userId || 'global'}`;
  }

  buildScopeQuery(purpose, tenantId = null, userId = null) {
    const conditions = [{ purpose }];

    if (tenantId) {
      conditions.push({ tenantId: String(tenantId) });
    } else {
      conditions.push({ tenantId: null });
    }

    if (userId) {
      conditions.push({ userId: String(userId) });
    } else {
      conditions.push({ userId: null });
    }

    return { $and: conditions };
  }

  validateAccess(keyDoc, operation, actor = {}) {
    const policy = keyDoc.accessPolicy || { allowAll: true };

    if (policy.requireReason && !actor.reason) {
      throw new Error(`Key access denied: reason is required for ${operation}`);
    }

    if (policy.allowedOperations?.length && !policy.allowedOperations.includes(operation)) {
      throw new Error(`Key access denied: operation ${operation} is not allowed`);
    }

    if (policy.allowAll) {
      return true;
    }

    const userId = actor.userId ? String(actor.userId) : null;
    const role = actor.role || null;
    const serviceAccount = actor.serviceAccount || null;

    const userAllowed = policy.allowedUserIds?.length ? policy.allowedUserIds.includes(userId) : false;
    const roleAllowed = policy.allowedRoles?.length ? policy.allowedRoles.includes(role) : false;
    const serviceAllowed = policy.allowedServiceAccounts?.length ? policy.allowedServiceAccounts.includes(serviceAccount) : false;

    if (!userAllowed && !roleAllowed && !serviceAllowed) {
      throw new Error(`Key access denied for operation ${operation}`);
    }

    return true;
  }

  generateKeyId(purpose, tenantId = null, userId = null) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const scope = [tenantId || 'global', userId || 'global'].join('-');
    return `${purpose}-${scope}-${timestamp}-${random}`;
  }

  async generateDataEncryptionKey(purpose, keyType = 'data', options = {}) {
    await this.ensureInitialized();

    const algorithm = options.algorithm || this.defaultAlgorithm;
    const algorithmSpec = this.getAlgorithmSpec(algorithm);
    const keyLength = algorithmSpec.keyLength;

    const dek = crypto.randomBytes(keyLength);
    const tenantId = options.tenantId ? String(options.tenantId) : null;
    const userId = options.userId ? String(options.userId) : null;
    const keyId = this.generateKeyId(purpose, tenantId, userId);

    const encryptedDEK = await this.encryptWithKEK(dek);

    const rotationPeriod = options.rotationPeriodDays || parseInt(process.env.KEY_ROTATION_PERIOD_DAYS || '90', 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + rotationPeriod);

    const encryptionKey = new EncryptionKey({
      keyId,
      version: options.version || 1,
      algorithm,
      encryptedKey: encryptedDEK,
      keyType,
      purpose,
      tenantId,
      userId,
      parentKeyId: options.parentKeyId || null,
      status: 'active',
      expiresAt,
      metadata: {
        rotationPeriodDays: rotationPeriod,
        lastUsed: new Date(),
        usageCount: 0,
        derivationContext: options.derivationContext || null
      },
      accessPolicy: options.accessPolicy || {
        allowAll: true,
        allowedOperations: ['encrypt', 'decrypt', 'derive', 'rotate', 'backup', 'revoke', 'read']
      },
      compliance: options.compliance || {
        pciDss: true,
        gdpr: true,
        hipaa: false
      }
    });

    await encryptionKey.save();

    this.keyCache.set(keyId, {
      key: dek,
      timestamp: Date.now(),
      version: encryptionKey.version
    });
    this.purposeKeyIndex.set(this.getPurposeCacheKey(purpose, tenantId, userId), keyId);

    await this.logKeyEvent('key.generated', {
      actor: options.actor,
      keyId,
      purpose,
      operation: 'generate',
      algorithm,
      tenantId,
      userId,
      keyType
    });

    return { keyId, key: dek, version: encryptionKey.version, algorithm, purpose, tenantId, userId };
  }

  async updateKeyUsage(keyId) {
    await EncryptionKey.updateOne(
      { keyId },
      {
        $set: { 'metadata.lastUsed': new Date() },
        $inc: { 'metadata.usageCount': 1 }
      }
    );
  }

  async getEncryptionKey(purpose, options = {}) {
    await this.ensureInitialized();

    const tenantId = options.tenantId ? String(options.tenantId) : null;
    const userId = options.userId ? String(options.userId) : null;
    const operation = options.operation || 'encrypt';
    const actor = options.actor || {};

    const purposeCacheKey = this.getPurposeCacheKey(purpose, tenantId, userId);
    const indexedKeyId = this.purposeKeyIndex.get(purposeCacheKey);

    if (indexedKeyId) {
      const cached = this.keyCache.get(indexedKeyId);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        await this.updateKeyUsage(indexedKeyId);
        return { keyId: indexedKeyId, key: cached.key, version: cached.version };
      }
    }

    const query = {
      ...this.buildScopeQuery(purpose, tenantId, userId),
      status: 'active',
      $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }]
    };

    let encryptionKey = await EncryptionKey.findOne(query).sort({ version: -1 });

    if (!encryptionKey && userId) {
      encryptionKey = await EncryptionKey.findOne({
        ...this.buildScopeQuery(purpose, tenantId, null),
        status: 'active',
        $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }]
      }).sort({ version: -1 });
    }

    if (!encryptionKey) {
      return await this.generateDataEncryptionKey(purpose, 'data', { ...options, tenantId, userId });
    }

    this.validateAccess(encryptionKey, operation, actor);

    const dek = await this.decryptWithKEK(encryptionKey.encryptedKey);

    this.keyCache.set(encryptionKey.keyId, {
      key: dek,
      timestamp: Date.now(),
      version: encryptionKey.version
    });
    this.purposeKeyIndex.set(purposeCacheKey, encryptionKey.keyId);

    await this.updateKeyUsage(encryptionKey.keyId);

    await this.logKeyEvent('key.accessed', {
      actor,
      keyId: encryptionKey.keyId,
      purpose,
      operation,
      status: 'success'
    });

    return { keyId: encryptionKey.keyId, key: dek, version: encryptionKey.version, algorithm: encryptionKey.algorithm };
  }

  async getKeyById(keyId, version = null, options = {}) {
    await this.ensureInitialized();

    const cached = this.keyCache.get(keyId);
    if (cached && (version === null || cached.version === version)) {
      return { keyId, key: cached.key, version: cached.version };
    }

    const query = { keyId };
    if (version !== null) {
      query.version = version;
    }

    const encryptionKey = await EncryptionKey.findOne(query).sort({ version: -1 });

    if (!encryptionKey) {
      throw new Error(`Encryption key not found: ${keyId}${version ? ` (v${version})` : ''}`);
    }

    this.validateAccess(encryptionKey, options.operation || 'read', options.actor || {});

    const dek = await this.decryptWithKEK(encryptionKey.encryptedKey);

    this.keyCache.set(keyId, {
      key: dek,
      timestamp: Date.now(),
      version: encryptionKey.version
    });

    await this.logKeyEvent('key.retrieved', {
      actor: options.actor,
      keyId,
      purpose: encryptionKey.purpose,
      operation: options.operation || 'read'
    });

    return {
      keyId,
      key: dek,
      version: encryptionKey.version,
      algorithm: encryptionKey.algorithm,
      purpose: encryptionKey.purpose,
      tenantId: encryptionKey.tenantId,
      userId: encryptionKey.userId
    };
  }

  async deriveScopedKey({ purpose, tenantId = null, userId = null, context = 'default', actor = {} }) {
    const root = await this.getEncryptionKey(purpose, {
      tenantId,
      userId,
      operation: 'derive',
      actor
    });

    const salt = Buffer.from(`${tenantId || 'global'}:${userId || 'global'}`, 'utf8');
    const info = Buffer.from(`${purpose}:${context}:v${root.version}`, 'utf8');

    const derived = crypto.hkdfSync('sha256', root.key, salt, info, this.keyLength);

    await this.logKeyEvent('key.derived', {
      actor,
      keyId: root.keyId,
      purpose,
      operation: 'derive',
      details: { context, tenantId, userId, version: root.version }
    });

    return {
      keyId: `${root.keyId}:derived:${crypto.createHash('sha256').update(info).digest('hex').slice(0, 12)}`,
      key: Buffer.from(derived),
      version: root.version,
      parentKeyId: root.keyId,
      context
    };
  }

  async rotateKey(purpose, options = {}) {
    await this.ensureInitialized();

    const tenantId = options.tenantId ? String(options.tenantId) : null;
    const userId = options.userId ? String(options.userId) : null;

    const currentKey = await EncryptionKey.findOne({
      ...this.buildScopeQuery(purpose, tenantId, userId),
      status: 'active'
    }).sort({ version: -1 });

    if (!currentKey) {
      throw new Error(`No active key found for purpose: ${purpose}`);
    }

    this.validateAccess(currentKey, 'rotate', options.actor || {});

    currentKey.status = 'rotating';
    currentKey.rotatedAt = new Date();
    await currentKey.save();

    const newVersion = currentKey.version + 1;

    const newKey = await this.generateDataEncryptionKey(purpose, currentKey.keyType, {
      actor: options.actor,
      tenantId,
      userId,
      version: newVersion,
      rotationPeriodDays: currentKey.metadata.rotationPeriodDays,
      algorithm: currentKey.algorithm,
      parentKeyId: currentKey.parentKeyId,
      accessPolicy: currentKey.accessPolicy,
      compliance: currentKey.compliance,
      derivationContext: currentKey.metadata.derivationContext
    });

    const migrationResult = {
      attempted: false,
      migratedRecords: 0,
      failedRecords: 0
    };

    if (typeof options.reencryptCallback === 'function') {
      migrationResult.attempted = true;
      try {
        const migrationResponse = await options.reencryptCallback({
          purpose,
          tenantId,
          userId,
          oldKeyId: currentKey.keyId,
          oldVersion: currentKey.version,
          newKeyId: newKey.keyId,
          newVersion,
          actor: options.actor || {}
        });

        migrationResult.migratedRecords = migrationResponse?.migratedRecords || 0;
        migrationResult.failedRecords = migrationResponse?.failedRecords || 0;
      } catch (error) {
        migrationResult.failedRecords += 1;
        await this.logKeyEvent('key.rotation.migration_failed', {
          actor: options.actor,
          keyId: currentKey.keyId,
          purpose,
          operation: 'rotate',
          status: 'failed',
          error: error.message
        });
      }
    }

    const graceDays = parseInt(process.env.DEPRECATED_KEY_GRACE_PERIOD_DAYS || '30', 10);
    setTimeout(async () => {
      try {
        await EncryptionKey.updateOne({ keyId: currentKey.keyId }, { $set: { status: 'deprecated' } });
        this.keyCache.delete(currentKey.keyId);
      } catch (error) {
        console.error(`Failed to deprecate key ${currentKey.keyId}:`, error.message);
      }
    }, graceDays * 24 * 60 * 60 * 1000);

    await this.logKeyEvent('key.rotated', {
      actor: options.actor,
      keyId: newKey.keyId,
      purpose,
      operation: 'rotate',
      details: {
        oldKeyId: currentKey.keyId,
        oldVersion: currentKey.version,
        newVersion,
        migrationResult,
        graceDays
      }
    });

    return {
      oldKeyId: currentKey.keyId,
      newKeyId: newKey.keyId,
      version: newVersion,
      migrationResult
    };
  }

  async checkKeyRotation() {
    await this.ensureInitialized();

    const withinDays = parseInt(process.env.KEY_EXPIRY_ALERT_DAYS || '7', 10);
    const rotateBefore = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

    const keysToRotate = await EncryptionKey.find({
      status: 'active',
      expiresAt: { $lt: rotateBefore }
    });

    let rotated = 0;
    for (const key of keysToRotate) {
      try {
        await this.rotateKey(key.purpose, {
          tenantId: key.tenantId,
          userId: key.userId,
          actor: { serviceAccount: 'kms-rotation-scheduler', role: 'system', reason: 'scheduled_rotation' }
        });
        rotated += 1;
      } catch (error) {
        await this.logKeyEvent('key.rotation.failed', {
          keyId: key.keyId,
          purpose: key.purpose,
          operation: 'rotate',
          status: 'failed',
          error: error.message,
          actor: { serviceAccount: 'kms-rotation-scheduler', role: 'system' }
        });
      }
    }

    await this.logKeyEvent('key.rotation.check_complete', {
      operation: 'rotate',
      details: { candidates: keysToRotate.length, rotated }
    });

    return { candidates: keysToRotate.length, rotated };
  }

  async revokeKey(keyId, reason, options = {}) {
    const key = await EncryptionKey.findOne({ keyId });

    if (!key) {
      throw new Error(`Key not found: ${keyId}`);
    }

    this.validateAccess(key, 'revoke', options.actor || {});

    key.status = 'revoked';
    key.metadata.revocationReason = reason;
    await key.save();

    this.keyCache.delete(keyId);

    await this.logKeyEvent('key.revoked', {
      actor: options.actor,
      keyId,
      purpose: key.purpose,
      operation: 'revoke',
      details: { reason }
    });

    return { keyId, status: 'revoked', reason };
  }

  async listKeys(filter = {}) {
    const keys = await EncryptionKey.find(filter)
      .select('-encryptedKey')
      .sort({ createdAt: -1 })
      .lean();

    return keys;
  }

  async listAuditTrail(filter = {}, limit = 100) {
    const query = {};
    if (filter.keyId) query.keyId = filter.keyId;
    if (filter.purpose) query.purpose = filter.purpose;
    if (filter.eventType) query.eventType = filter.eventType;

    return await KeyAuditLog.find(query).sort({ createdAt: -1 }).limit(Math.min(limit, 1000)).lean();
  }

  async exportKeyBackup(password, options = {}) {
    const keys = await EncryptionKey.find({ status: { $in: ['active', 'rotating', 'deprecated'] } }).lean();

    const backup = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      provider: this.kekProvider.getStatus(),
      keyCount: keys.length,
      keys: keys.map(k => ({
        keyId: k.keyId,
        version: k.version,
        algorithm: k.algorithm,
        encryptedKey: k.encryptedKey,
        keyType: k.keyType,
        purpose: k.purpose,
        tenantId: k.tenantId,
        userId: k.userId,
        parentKeyId: k.parentKeyId,
        status: k.status,
        metadata: k.metadata,
        accessPolicy: k.accessPolicy,
        compliance: k.compliance,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt
      }))
    };

    const backupJson = JSON.stringify(backup);
    const checksum = crypto.createHash('sha256').update(backupJson).digest('hex');

    const payload = JSON.stringify({ backup, checksum });

    const salt = crypto.randomBytes(this.saltLength);
    const key = crypto.pbkdf2Sync(password, salt, this.pbkdf2Iterations, this.keyLength, 'sha256');
    const iv = crypto.randomBytes(this.ivLength);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(payload, 'utf8')), cipher.final()]);
    const authTag = cipher.getAuthTag();

    await this.logKeyEvent('key.backup.exported', {
      actor: options.actor,
      operation: 'backup',
      details: { keyCount: keys.length, checksum }
    });

    return Buffer.concat([salt, iv, authTag, encrypted]).toString('base64');
  }

  async importKeyBackup(encryptedBackup, password, options = {}) {
    const buffer = Buffer.from(encryptedBackup, 'base64');

    const salt = buffer.slice(0, this.saltLength);
    const iv = buffer.slice(this.saltLength, this.saltLength + this.ivLength);
    const authTag = buffer.slice(this.saltLength + this.ivLength, this.saltLength + this.ivLength + this.authTagLength);
    const encrypted = buffer.slice(this.saltLength + this.ivLength + this.authTagLength);

    const key = crypto.pbkdf2Sync(password, salt, this.pbkdf2Iterations, this.keyLength, 'sha256');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString('utf8'));

    const calculated = crypto.createHash('sha256').update(JSON.stringify(parsed.backup)).digest('hex');
    if (calculated !== parsed.checksum) {
      throw new Error('Backup integrity verification failed: checksum mismatch');
    }

    let imported = 0;
    let skipped = 0;

    for (const keyData of parsed.backup.keys) {
      const existing = await EncryptionKey.findOne({ keyId: keyData.keyId });
      if (!existing) {
        await EncryptionKey.create(keyData);
        imported += 1;
      } else {
        skipped += 1;
      }
    }

    await this.logKeyEvent('key.backup.imported', {
      actor: options.actor,
      operation: 'backup',
      details: { imported, skipped, checksum: parsed.checksum }
    });

    return { imported, skipped, total: parsed.backup.keys.length, checksum: parsed.checksum };
  }

  async setActiveAlgorithm(algorithm, options = {}) {
    this.getAlgorithmSpec(algorithm);
    this.defaultAlgorithm = algorithm;

    await this.logKeyEvent('key.algorithm.updated', {
      actor: options.actor,
      operation: 'rotate',
      details: { algorithm }
    });

    return {
      activeAlgorithm: this.defaultAlgorithm,
      supportedAlgorithms: Object.keys(this.supportedAlgorithms)
    };
  }

  getAlgorithmStatus() {
    return {
      activeAlgorithm: this.defaultAlgorithm,
      supportedAlgorithms: Object.keys(this.supportedAlgorithms),
      specs: this.supportedAlgorithms
    };
  }

  verifyEncryptionStrength() {
    const findings = [];

    if (!this.supportedAlgorithms[this.defaultAlgorithm]) {
      findings.push({ level: 'critical', message: 'Default algorithm is unsupported' });
    }

    if (this.keyLength < 32) {
      findings.push({ level: 'critical', message: 'Key length below 256 bits for default KEK handling' });
    }

    if (this.pbkdf2Iterations < 150000) {
      findings.push({ level: 'warning', message: 'PBKDF2 iteration count is lower than enterprise baseline' });
    }

    const providerStatus = this.kekProvider.getStatus();
    if (!providerStatus.healthy) {
      findings.push({ level: 'critical', message: 'KEK provider health check failed' });
    }

    return {
      status: findings.some(f => f.level === 'critical') ? 'weak' : findings.length ? 'moderate' : 'strong',
      keyLengthBits: this.keyLength * 8,
      pbkdf2Iterations: this.pbkdf2Iterations,
      activeAlgorithm: this.defaultAlgorithm,
      supportedAlgorithms: Object.keys(this.supportedAlgorithms),
      kekProvider: providerStatus,
      findings,
      verifiedAt: new Date().toISOString()
    };
  }

  async getKeyHealthMetrics() {
    const totalKeys = await EncryptionKey.countDocuments();
    const activeKeys = await EncryptionKey.countDocuments({ status: 'active' });
    const expiringSoon = await EncryptionKey.countDocuments({
      status: 'active',
      expiresAt: { $lt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
    });
    const deprecated = await EncryptionKey.countDocuments({ status: 'deprecated' });
    const revoked = await EncryptionKey.countDocuments({ status: 'revoked' });

    const keysByPurpose = await EncryptionKey.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$purpose', count: { $sum: 1 } } }
    ]);

    const recentAuditEvents = await KeyAuditLog.find().sort({ createdAt: -1 }).limit(5).lean();

    return {
      total: totalKeys,
      active: activeKeys,
      expiringSoon,
      deprecated,
      revoked,
      cacheSize: this.keyCache.size,
      byPurpose: keysByPurpose,
      healthStatus: expiringSoon > 0 ? 'warning' : 'healthy',
      algorithmStatus: this.getAlgorithmStatus(),
      strength: this.verifyEncryptionStrength(),
      recentAuditEvents
    };
  }
}

module.exports = new KeyManagementService();
