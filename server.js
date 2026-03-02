const express = require('express');
// Global error handlers for unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Optionally, perform cleanup or alerting here
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
  // Optionally, perform cleanup or alerting here
});
const http = require('http');
const crypto = require('crypto');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const socketAuth = require('./middleware/socketAuth');
const CronJobs = require('./services/cronJobs');
const { generalLimiter } = require('./middleware/rateLimiter');
const { sanitizeInput, sanitizationMiddleware, validateDataTypes } = require('./middleware/sanitizer');
const securityMonitor = require('./services/securityMonitor');
const apiGateway = require('./middleware/apiGateway');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const expenseRoutes = require('./routes/expenses');
const syncRoutes = require('./routes/sync');
const splitsRoutes = require('./routes/splits');
const groupsRoutes = require('./routes/groups');
const backupRoutes = require('./routes/backups');
const backupService = require('./services/backupService');
const twoFactorAuthRoutes = require('./routes/twoFactorAuth');
const encryptionRoutes = require('./routes/encryption');
const automatedForecastingRoutes = require('./routes/automatedForecasting');
const auditComplianceRoutes = require('./routes/auditCompliance');
const apiGatewayRoutes = require('./routes/apiGateway');
const realtimeCollaborationRoutes = require('./routes/realtimeCollaboration');
const adaptiveRiskEngineRoutes = require('./routes/adaptiveRiskEngine');
const attackGraphRoutes = require('./routes/attackGraph'); // Issue #848: Cross-Account Attack Graph Detection
const incidentPlaybookRoutes = require('./routes/incidentPlaybooks'); // Issue #851: Autonomous Incident Response Playbooks
const incidentAutomationRoutes = require('./routes/incidentAutomation'); // Issue #919: Incident Response Automation Engine
const sessionTrustScoringRoutes = require('./routes/sessionTrustScoring'); // Issue #852: Continuous Session Trust Re-Scoring
const sessionRecoveryRoutes = require('./routes/sessionRecovery'); // Issue #881: Session Hijacking Prevention & Recovery
const sessionHijackingMiddleware = require('./middleware/sessionHijackingDetection'); // Issue #881
const mlAnomalyRoutes = require('./routes/mlAnomaly'); // Issue #878: Behavioral ML Anomaly Detection
const crossSessionCorrelationRoutes = require('./routes/crossSessionCorrelation'); // Issue #879: Cross-Session Threat Correlation
const realtimeCollaborationService = require('./services/realtimeCollaborationService');
const attackGraphIntegrationService = require('./services/attackGraphIntegrationService'); // Issue #848
const mlAnomalyDetectionService = require('./services/mlAnomalyDetectionService'); // Issue #878
const threatIntelIntegrationService = require('./services/threatIntelIntegrationService'); // Issue #877
const crossSessionThreatCorrelationService = require('./services/crossSessionThreatCorrelationService'); // Issue #879
const containmentActionSystem = require('./services/containmentActionSystem'); // Issue #879
const trustedRelationshipsManager = require('./services/trustedRelationshipsManager'); // Issue #879
const { transportSecuritySuite } = require('./middleware/transportSecurity');
const cron = require('node-cron');

// Distributed real-time sync dependencies
const Redis = require('ioredis');
const redisPub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const redisSub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Redis pub/sub channel for distributed sync
const SYNC_CHANNEL = 'expenseflow:sync';
const COLLAB_CHANNEL = 'expenseflow:collab';
const SERVER_INSTANCE_ID = process.env.SERVER_INSTANCE_ID || crypto.randomUUID();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// Security middleware
// Transport Security (HTTPS, HSTS, Security Headers)
// Issue #827: End-to-End Encryption for Sensitive Data
app.use(transportSecuritySuite({
  enforceHTTPS: process.env.NODE_ENV === 'production',
  enforceHSTS: process.env.NODE_ENV === 'production',
  securityHeaders: true,
  enforceTLS: process.env.NODE_ENV === 'production',
  validateCipher: process.env.NODE_ENV === 'production'
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "https://res.cloudinary.com"],
      connectSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://api.exchangerate-api.com", "https://api.frankfurter.app", "https://res.cloudinary.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      process.env.FRONTEND_URL
    ].filter(Boolean);

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
app.use(generalLimiter);

// Comprehensive input sanitization and validation middleware
// Issue #461: Missing Input Validation on User Data
app.use(sanitizationMiddleware);
app.use(validateDataTypes);

// Security monitoring
app.use(securityMonitor.blockSuspiciousIPs());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static('public'));
app.use(express.static('.'));

// Security logging middleware
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (data) {
    // Log failed requests
    if (res.statusCode >= 400) {
      securityMonitor.logSecurityEvent(req, 'suspicious_activity', {
        statusCode: res.statusCode,
        response: typeof data === 'string' ? data.substring(0, 200) : 'Non-string response'
      });
    }
    originalSend.call(this, data);
  };
  next();
});

// Make io available to the  routes
app.set('io', io);

// Make io globally available for notifications
global.io = io;

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    // Initialize cron jobs after DB connection (includes backup scheduling)
    // Issue #462: Automated Backup System for Financial Data
    CronJobs.init();
    console.log('✓ Cron jobs initialized (includes backup scheduling)');
    
    // Initialize attack graph detection system
    // Issue #848: Cross-Account Attack Graph Detection
    attackGraphIntegrationService.initialize();
    console.log('✓ Attack graph detection initialized');
    
    // Initialize ML anomaly detection system
    // Issue #878: Behavioral ML Anomaly Detection
    mlAnomalyDetectionService.initialize()
      .then(() => {
        console.log('✓ ML anomaly detection initialized');
      })
      .catch(err => {
        console.error('ML anomaly detection initialization error:', err);
        console.log('⚠ ML system will train on first use');
      });

    // Initialize threat intelligence integration
    // Issue #877: Real-Time Threat Intelligence Integration
    threatIntelIntegrationService.initialize();
    console.log('✓ Threat intelligence integration initialized');
    
    // Initialize cross-session threat correlation system
    // Issue #879: Cross-Session Threat Correlation
    crossSessionThreatCorrelationService.initialize()
      .then(() => {
        console.log('✓ Cross-session threat correlation initialized');
      })
      .catch(err => {
        console.error('Cross-session correlation initialization error:', err);
      });
    
    // Initialize containment action system
    containmentActionSystem.initialize()
      .then(() => {
        console.log('✓ Containment action system initialized');
      })
      .catch(err => {
        console.error('Containment action system initialization error:', err);
      });
    
    // Initialize trusted relationships manager
    trustedRelationshipsManager.initialize()
      .then(() => {
        console.log('✓ Trusted relationships manager initialized');
      })
      .catch(err => {
        console.error('Trusted relationships manager initialization error:', err);
      });
    
    // Initialize session hijacking detection system
    // Issue #881: Session Hijacking Prevention & Recovery
    console.log('✓ Session hijacking detection initialized');
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Socket.IO authentication
io.use(socketAuth);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User ${socket.user.name} connected`);

  // Join user-specific room
  socket.join(`user_${socket.userId}`);

  // Handle sync requests
  socket.on('sync_request', async (data) => {
    try {
      // Process sync queue for this user
      const SyncQueue = require('./models/SyncQueue');
      const pendingSync = await SyncQueue.find({
        user: socket.userId,
        processed: false
      }).sort({ createdAt: 1 });

      socket.emit('sync_data', pendingSync);
    } catch (error) {
      socket.emit('sync_error', { error: error.message });
    }
  });

  // Listen for client expense changes and broadcast to Redis
  socket.on('expense_created', (expense) => {
    io.emit('expense_created', expense);
    redisPub.publish(SYNC_CHANNEL, JSON.stringify({ type: 'expense_created', expense }));
  });

  socket.on('expense_updated', (expense) => {
    io.emit('expense_updated', expense);
    redisPub.publish(SYNC_CHANNEL, JSON.stringify({ type: 'expense_updated', expense }));
  });

  socket.on('expense_deleted', (data) => {
    io.emit('expense_deleted', data);
    redisPub.publish(SYNC_CHANNEL, JSON.stringify({ type: 'expense_deleted', data }));
  });

  socket.on('collab:join', async (payload = {}) => {
    try {
      const { documentId } = payload;
      if (!documentId) {
        socket.emit('collab:error', { error: 'documentId is required' });
        return;
      }

      const snapshot = await realtimeCollaborationService.getDocument(documentId, socket.userId);
      socket.join(`collab_doc_${documentId}`);
      socket.emit('collab:snapshot', {
        documentId,
        snapshot
      });

      await realtimeCollaborationService.markPresence(documentId, socket.userId, true);

      io.to(`collab_doc_${documentId}`).emit('collab:presence', {
        documentId,
        userId: socket.userId,
        status: 'online',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      socket.emit('collab:error', { error: error.message });
    }
  });

  socket.on('collab:operations', async (payload = {}) => {
    try {
      const { documentId, operations = [], deviceId } = payload;
      if (!documentId) {
        socket.emit('collab:error', { error: 'documentId is required' });
        return;
      }

      const result = await realtimeCollaborationService.applyOperations(
        documentId,
        socket.userId,
        deviceId,
        Array.isArray(operations) ? operations : []
      );

      socket.emit('collab:ack', {
        documentId,
        version: result.version,
        appliedResults: result.appliedResults
      });

      const eventPayload = {
        serverInstanceId: SERVER_INSTANCE_ID,
        sourceSocketId: socket.id,
        sourceUserId: socket.userId,
        documentId,
        version: result.version,
        operations: result.serverOperations,
        text: result.text,
        registers: result.registers,
        cells: result.cells,
        timestamp: new Date().toISOString()
      };

      socket.to(`collab_doc_${documentId}`).emit('collab:operations', eventPayload);
      redisPub.publish(COLLAB_CHANNEL, JSON.stringify(eventPayload));
    } catch (error) {
      socket.emit('collab:error', { error: error.message });
    }
  });

  socket.on('collab:leave', async (payload = {}) => {
    try {
      const { documentId } = payload;
      if (!documentId) {
        return;
      }

      socket.leave(`collab_doc_${documentId}`);
      await realtimeCollaborationService.markPresence(documentId, socket.userId, false);
      io.to(`collab_doc_${documentId}`).emit('collab:presence', {
        documentId,
        userId: socket.userId,
        status: 'offline',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      socket.emit('collab:error', { error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`User ${socket.user.name} disconnected`);
  });
});

// Listen for Redis sync events and broadcast to local clients
redisSub.subscribe(SYNC_CHANNEL, (err) => {
  if (err) console.error('Redis subscribe error:', err);
});

redisSub.subscribe(COLLAB_CHANNEL, (err) => {
  if (err) console.error('Redis collab subscribe error:', err);
});

redisSub.on('message', (channel, message) => {
  try {
    const payload = JSON.parse(message);

    if (channel === COLLAB_CHANNEL) {
      if (payload.serverInstanceId === SERVER_INSTANCE_ID) {
        return;
      }
      if (payload.documentId) {
        io.to(`collab_doc_${payload.documentId}`).emit('collab:operations', payload);
      }
      return;
    }

    if (channel !== SYNC_CHANNEL) {
      return;
    }

    if (payload.type === 'expense_created') {
      io.emit('expense_created', payload.expense);
    } else if (payload.type === 'expense_updated') {
      io.emit('expense_updated', payload.expense);
    } else if (payload.type === 'expense_deleted') {
      io.emit('expense_deleted', payload.data);
    }
  } catch (e) {
    console.error('Redis sync event error:', e);
  }
});

app.use('/api/correlation', crossSessionCorrelationRoutes); // Issue #879: Cross-Session Threat Correlation
app.use('/api/session-recovery', sessionRecoveryRoutes); // Issue #881: Session Hijacking Prevention & Recovery
// Routes
app.use('/api', apiGateway.middleware());
app.use('/api/auth', require('./middleware/rateLimiter').authLimiter, authRoutes);
app.use('/api/expenses', require('./middleware/rateLimiter').expenseLimiter, expenseRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/receipts', require('./middleware/rateLimiter').uploadLimiter, require('./routes/receipts'));
app.use('/api/budgets', require('./routes/budgets'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/currency', require('./routes/currency'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/splits', require('./routes/splits'));
app.use('/api/workspaces', require('./routes/workspaces'));
app.use('/api/tax', require('./routes/tax'));
app.use('/api/backups', backupRoutes); // Issue #462: Backup Management API
app.use('/api/ml-anomaly', mlAnomalyRoutes); // Issue #878: Behavioral ML Anomaly Detection
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/2fa', require('./middleware/auth'), twoFactorAuthRoutes); // Issue #503: 2FA Management
app.use('/api/encryption', encryptionRoutes); // Issue #827: End-to-End Encryption
app.use('/api/forecasting-ai', automatedForecastingRoutes); // Issue #828: Automated Financial Forecasting & AI Insights
app.use('/api/audit-compliance', auditComplianceRoutes); // Issue #829: Audit Trail & Forensic Investigation Platform
app.use('/api/gateway', apiGatewayRoutes);
app.use('/api/realtime-collab', realtimeCollaborationRoutes);
app.use('/api/risk-engine', adaptiveRiskEngineRoutes);
app.use('/api/attack-graph', attackGraphRoutes); // Issue #848: Cross-Account Attack Graph Detection
app.use('/api/incident-playbooks', incidentPlaybookRoutes); // Issue #851: Autonomous Incident Response Playbooks
app.use('/api/incident-automation', incidentAutomationRoutes); // Issue #919: Incident Response Automation Engine
app.use('/api/session-trust', sessionTrustScoringRoutes); // Issue #852: Continuous Session Trust Re-Scoring
// Apply session hijacking detection middleware to protected routes
// Issue #881: Session Hijacking Prevention & Recovery
sessionHijackingMiddleware.applyToRoutes(app, [
  '/api/expenses',
  '/api/budgets',
  '/api/goals',
  '/api/analytics',
  '/api/reports',
  '/api/accounts',
  '/api/settings',
  '/api/tax',
  '/api/encryption',
  '/api/backups'
]);

// Serve recovery page
app.get('/auth/recovery', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'session-recovery.html'));
});

// 
// Express error handler middleware (must be after all routes)
app.use((err, req, res, next) => {
  console.error('Express route error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

// Root route to serve the UI
app.get('/', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Security features enabled: Rate limiting, Input sanitization, Security headers');
});