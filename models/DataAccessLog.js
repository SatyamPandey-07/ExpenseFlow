const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Data Access Logging Model
 * Tracks who accessed what data and when for compliance and audit purposes
 * Issue #920: Compliance & Audit Logging Framework
 */

const dataAccessLogSchema = new mongoose.Schema({
  sequenceNumber: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true
  },
  accessType: {
    type: String,
    required: true,
    enum: [
      'read',
      'write',
      'update',
      'delete',
      'export',
      'download',
      'print',
      'share',
      'decrypt',
      'search',
      'bulk_access',
      'api_access'
    ],
    index: true
  },
  resourceType: {
    type: String,
    required: true,
    enum: [
      'expense',
      'budget',
      'user_profile',
      'workspace',
      'report',
      'invoice',
      'receipt',
      'bank_connection',
      'api_key',
      'encryption_key',
      'audit_log',
      'personal_data',
      'financial_data',
      'health_data',
      'sensitive_document'
    ],
    index: true
  },
  resourceId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    index: true
  },
  resourceOwner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  dataClassification: {
    type: String,
    enum: ['public', 'internal', 'confidential', 'restricted', 'pii', 'phi', 'pci'],
    default: 'internal',
    index: true
  },
  accessReason: {
    type: String,
    enum: [
      'routine_operation',
      'user_request',
      'support_ticket',
      'compliance_audit',
      'security_investigation',
      'legal_requirement',
      'data_subject_request',
      'administrative_task',
      'automated_process'
    ]
  },
  accessAuthorization: {
    authorized: {
      type: Boolean,
      required: true,
      default: false
    },
    method: {
      type: String,
      enum: ['role_based', 'permission_based', 'consent_based', 'legal_basis', 'emergency_access']
    },
    consentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserConsent'
    },
    permissionLevel: String
  },
  accessDetails: {
    fieldsAccessed: [String],
    recordCount: {
      type: Number,
      default: 1
    },
    dataVolume: {
      bytes: Number,
      formattedSize: String
    },
    queryParameters: mongoose.Schema.Types.Mixed,
    filters: mongoose.Schema.Types.Mixed,
    searchTerms: [String]
  },
  metadata: {
    ipAddress: {
      type: String,
      required: true
    },
    userAgent: String,
    sessionId: String,
    requestId: String,
    apiEndpoint: String,
    httpMethod: String,
    geolocation: {
      country: String,
      region: String,
      city: String,
      coordinates: {
        latitude: Number,
        longitude: Number
      }
    },
    deviceInfo: {
      type: String,
      os: String,
      browser: String,
      deviceId: String
    },
    duration: {
      type: Number,  // milliseconds
      description: String
    }
  },
  riskAssessment: {
    riskScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'low'
    },
    riskFactors: [String],
    anomalyDetected: {
      type: Boolean,
      default: false
    },
    anomalyReasons: [String]
  },
  complianceRelevance: {
    regulations: [{
      type: String,
      enum: ['GDPR', 'CCPA', 'HIPAA', 'SOC2', 'PCI_DSS', 'SOX', 'ISO27001', 'PIPEDA', 'LGPD']
    }],
    dataSubjectRights: [{
      type: String,
      enum: ['right_to_access', 'right_to_rectification', 'right_to_erasure', 'right_to_portability', 'right_to_object']
    }],
    retentionPolicy: String,
    legalHold: {
      type: Boolean,
      default: false
    }
  },
  status: {
    type: String,
    enum: ['success', 'failure', 'blocked', 'throttled', 'unauthorized'],
    required: true,
    default: 'success',
    index: true
  },
  errorDetails: {
    code: String,
    message: String,
    stackTrace: String
  },
  // Immutability and integrity
  accessHash: {
    type: String,
    required: true
  },
  digitalSignature: {
    type: String,
    required: true
  },
  previousHash: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Indexes for performance
dataAccessLogSchema.index({ sequenceNumber: 1 });
dataAccessLogSchema.index({ userId: 1, createdAt: -1 });
dataAccessLogSchema.index({ workspaceId: 1, createdAt: -1 });
dataAccessLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
dataAccessLogSchema.index({ resourceOwner: 1, createdAt: -1 });
dataAccessLogSchema.index({ accessType: 1, createdAt: -1 });
dataAccessLogSchema.index({ dataClassification: 1, createdAt: -1 });
dataAccessLogSchema.index({ 'accessAuthorization.authorized': 1, status: 1 });
dataAccessLogSchema.index({ 'riskAssessment.riskLevel': 1, createdAt: -1 });
dataAccessLogSchema.index({ 'riskAssessment.anomalyDetected': 1 }, { sparse: true });
dataAccessLogSchema.index({ 'complianceRelevance.regulations': 1 });
dataAccessLogSchema.index({ status: 1, createdAt: -1 });
dataAccessLogSchema.index({ 'metadata.ipAddress': 1, createdAt: -1 });

// Pre-save middleware for sequence and hash chain
dataAccessLogSchema.pre('save', async function(next) {
  if (this.isNew) {
    // Get last sequence number
    const lastLog = await this.constructor.findOne().sort({ sequenceNumber: -1 });
    this.sequenceNumber = lastLog ? lastLog.sequenceNumber + 1 : 1;
    this.previousHash = lastLog ? lastLog.accessHash : '0000000000000000000000000000000000000000000000000000000000000000';
    
    // Calculate current hash
    const dataToHash = JSON.stringify({
      sequenceNumber: this.sequenceNumber,
      previousHash: this.previousHash,
      userId: this.userId,
      workspaceId: this.workspaceId,
      accessType: this.accessType,
      resourceType: this.resourceType,
      resourceId: this.resourceId,
      dataClassification: this.dataClassification,
      timestamp: this.createdAt || new Date(),
      metadata: {
        ipAddress: this.metadata.ipAddress,
        sessionId: this.metadata.sessionId
      }
    });
    
    this.accessHash = crypto
      .createHash('sha256')
      .update(dataToHash)
      .digest('hex');
    
    // Create digital signature
    const signatureKey = process.env.DATA_ACCESS_SIGNATURE_KEY || process.env.AUDIT_SIGNATURE_KEY || 'default-key';
    this.digitalSignature = crypto
      .createHmac('sha256', signatureKey)
      .update(this.accessHash)
      .digest('hex');
  }
  next();
});

// Method to verify log integrity
dataAccessLogSchema.methods.verifyIntegrity = function() {
  const dataToHash = JSON.stringify({
    sequenceNumber: this.sequenceNumber,
    previousHash: this.previousHash,
    userId: this.userId,
    workspaceId: this.workspaceId,
    accessType: this.accessType,
    resourceType: this.resourceType,
    resourceId: this.resourceId,
    dataClassification: this.dataClassification,
    timestamp: this.createdAt,
    metadata: {
      ipAddress: this.metadata.ipAddress,
      sessionId: this.metadata.sessionId
    }
  });
  
  const expectedHash = crypto
    .createHash('sha256')
    .update(dataToHash)
    .digest('hex');
  
  const signatureKey = process.env.DATA_ACCESS_SIGNATURE_KEY || process.env.AUDIT_SIGNATURE_KEY || 'default-key';
  const expectedSignature = crypto
    .createHmac('sha256', signatureKey)
    .update(expectedHash)
    .digest('hex');
  
  return this.accessHash === expectedHash && this.digitalSignature === expectedSignature;
};

// Static method to log data access
dataAccessLogSchema.statics.logAccess = async function(data) {
  return this.create({
    userId: data.userId,
    workspaceId: data.workspaceId,
    accessType: data.accessType,
    resourceType: data.resourceType,
    resourceId: data.resourceId,
    resourceOwner: data.resourceOwner,
    dataClassification: data.dataClassification || 'internal',
    accessReason: data.accessReason || 'routine_operation',
    accessAuthorization: data.accessAuthorization || { authorized: true, method: 'role_based' },
    accessDetails: data.accessDetails || {},
    metadata: data.metadata,
    riskAssessment: data.riskAssessment || { riskScore: 0, riskLevel: 'low' },
    complianceRelevance: data.complianceRelevance || {},
    status: data.status || 'success',
    errorDetails: data.errorDetails
  });
};

// Static method to get access history for a resource
dataAccessLogSchema.statics.getResourceAccessHistory = async function(resourceType, resourceId, options = {}) {
  const query = { resourceType, resourceId };
  const limit = options.limit || 100;
  
  return this.find(query)
    .populate('userId', 'name email')
    .populate('resourceOwner', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// Static method to get user's access history
dataAccessLogSchema.statics.getUserAccessHistory = async function(userId, options = {}) {
  const query = { userId };
  if (options.resourceType) query.resourceType = options.resourceType;
  if (options.startDate || options.endDate) {
    query.createdAt = {};
    if (options.startDate) query.createdAt.$gte = new Date(options.startDate);
    if (options.endDate) query.createdAt.$lte = new Date(options.endDate);
  }
  
  const limit = options.limit || 100;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

module.exports = mongoose.model('DataAccessLog', dataAccessLogSchema);
