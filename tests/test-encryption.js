/**
 * Encryption System Test Suite
 * Issue #827: End-to-End Encryption for Sensitive Data
 * 
 * Comprehensive tests to verify encryption implementation
 * Run this script after setting up the encryption system
 * 
 * Usage: node tests/test-encryption.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const kms = require('../services/keyManagementService');
const encryptionService = require('../services/encryptionService');
const SecureUserProfile = require('../models/SecureUserProfile');

// Test configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/expenseflow_test';

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function error(message) {
  log(`✗ ${message}`, 'red');
}

function info(message) {
  log(`ℹ ${message}`, 'blue');
}

function warn(message) {
  log(`⚠ ${message}`, 'yellow');
}

function section(title) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(` ${title}`, 'cyan');
  log('='.repeat(60), 'cyan');
}

// Test results tracking
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: []
};

function assert(condition, testName) {
  results.total++;
  if (condition) {
    success(testName);
    results.passed++;
    return true;
  } else {
    error(testName);
    results.failed++;
    results.errors.push(testName);
    return false;
  }
}

async function runTests() {
  try {
    section('Encryption System Test Suite');
    info(`Starting tests at ${new Date().toISOString()}`);
    
    // Connect to database
    section('Database Connection');
    await mongoose.connect(MONGODB_URI);
    success('Connected to MongoDB');
    
    // Test 1: Basic Encryption/Decryption
    section('Test 1: Basic Encryption & Decryption');
    const testData = 'sensitive-test-data-123';
    const encrypted = await encryptionService.encrypt(testData, 'userData');
    assert(encrypted && typeof encrypted === 'string', 'Data encrypted successfully');
    assert(encrypted !== testData, 'Encrypted data is different from plaintext');
    
    const decrypted = await encryptionService.decrypt(encrypted);
    assert(decrypted === testData, 'Decrypted data matches original');
    
    // Test 2: Field-Level Encryption
    section('Test 2: Field-Level Encryption');
    const userData = {
      name: 'John Doe',
      email: 'john@example.com',
      ssn: '123-45-6789',
      salary: 75000
    };
    
    const encryptedFields = await encryptionService.encryptFields(
      userData,
      ['ssn', 'salary'],
      'userData'
    );
    
    assert(encryptedFields.name === 'John Doe', 'Non-encrypted field unchanged');
    assert(encryptedFields.ssn !== '123-45-6789', 'SSN field encrypted');
    assert(encryptedFields._encrypted, 'Encryption metadata present');
    
    const decryptedFields = await encryptionService.decryptFields(
      encryptedFields,
      ['ssn', 'salary']
    );
    
    assert(decryptedFields.ssn === '123-45-6789', 'SSN decrypted correctly');
    assert(decryptedFields.salary === 75000, 'Salary decrypted correctly');
    
    // Test 3: File Encryption
    section('Test 3: File Encryption');
    const fileContent = Buffer.from('Test file content for encryption');
    const encryptedFile = await encryptionService.encryptFile(fileContent, 'documents', {
      filename: 'test.txt',
      mimeType: 'text/plain'
    });
    
    assert(encryptedFile.ciphertext, 'File encrypted successfully');
    assert(encryptedFile.metadata.originalSize === fileContent.length, 'File metadata correct');
    
    const decryptedFile = await encryptionService.decryptFile(encryptedFile);
    assert(decryptedFile.toString() === fileContent.toString(), 'File decrypted correctly');
    
    // Test 4: Data Masking
    section('Test 4: Data Masking');
    const maskedCard = encryptionService.mask('4532123456789012', 'card');
    assert(maskedCard.endsWith('9012'), 'Card number masked correctly');
    assert(maskedCard.startsWith('*'), 'Card number shows asterisks');
    
    const maskedSSN = encryptionService.mask('123456789', 'ssn');
    assert(maskedSSN === '***-**-6789', 'SSN masked correctly');
    
    const maskedEmail = encryptionService.mask('user@example.com', 'email');
    assert(maskedEmail.includes('@example.com'), 'Email domain preserved');
    assert(maskedEmail.startsWith('u'), 'Email first character preserved');
    
    // Test 5: Key Management
    section('Test 5: Key Management');
    
    // Generate new key
    const keyResult = await kms.generateDataEncryptionKey('test-purpose');
    assert(keyResult.keyId, 'Key generated successfully');
    assert(keyResult.key, 'Key contains encryption key');
    assert(keyResult.version === 1, 'Key version is 1');
    
    // Retrieve key
    const retrievedKey = await kms.getEncryptionKey('test-purpose');
    assert(retrievedKey.keyId, 'Key retrieved successfully');
    
    // Check key health
    const health = await kms.getKeyHealthMetrics();
    assert(health.active > 0, 'Active keys exist');
    assert(health.healthStatus, 'Health status available');

    // Validate algorithm governance and strength verification
    const algoStatus = kms.getAlgorithmStatus();
    assert(Array.isArray(algoStatus.supportedAlgorithms), 'Supported algorithms available');

    const strength = kms.verifyEncryptionStrength();
    assert(['strong', 'moderate', 'weak'].includes(strength.status), 'Encryption strength status returned');

    // Validate hierarchical derivation
    const derived = await kms.deriveScopedKey({
      purpose: 'test-purpose',
      tenantId: 'tenant-918',
      userId: 'user-918',
      context: 'invoice-field'
    });
    assert(derived.parentKeyId, 'Derived key contains parent key reference');
    assert(Buffer.isBuffer(derived.key), 'Derived key material is returned as Buffer');

    // Validate key rotation + decrypt auto-migration
    const oldEncrypted = await encryptionService.encrypt('rotate-me', 'test-purpose');
    const rotation = await kms.rotateKey('test-purpose');
    assert(rotation.newKeyId, 'Key rotated with new key id');

    const migratedDecrypt = await encryptionService.decryptAndReEncryptIfNeeded(oldEncrypted, 'test-purpose');
    assert(migratedDecrypt.data === 'rotate-me', 'Decrypt after rotation still returns original data');
    assert(migratedDecrypt.reEncrypted === true, 'Old ciphertext auto-migrated to active key');

    // Validate audit trail generation
    const auditEvents = await kms.listAuditTrail({ purpose: 'test-purpose' }, 20);
    assert(auditEvents.length > 0, 'KMS audit trail entries exist');
    
    // Test 6: Mongoose Schema Integration
    section('Test 6: Mongoose Schema with Auto-Encryption');
    
    // Create test user profile
    const testUserId = new mongoose.Types.ObjectId();
    const profile = new SecureUserProfile({
      userId: testUserId,
      username: 'testuser',
      email: 'test@example.com',
      phoneNumber: '+1234567890',
      ssn: '987-65-4321',
      dateOfBirth: new Date('1990-01-01'),
      financialInfo: {
        bankAccountNumber: '1234567890',
        routingNumber: '987654321',
        salary: 80000
      }
    });
    
    await profile.save();
    success('Profile saved with auto-encryption');
    
    // Verify encryption in database
    const rawProfile = await mongoose.connection.db
      .collection('secureuserprofiles')
      .findOne({ userId: testUserId });
    
    assert(rawProfile.ssn !== '987-65-4321', 'SSN encrypted in database');
    assert(rawProfile._encrypted, 'Encryption metadata stored');
    
    // Retrieve through Mongoose (should auto-decrypt)
    const retrievedProfile = await SecureUserProfile.findOne({ userId: testUserId });
    assert(retrievedProfile.ssn === '987-65-4321', 'SSN auto-decrypted on retrieval');
    
    // Test masked profile
    const maskedProfile = retrievedProfile.getMaskedProfile();
    assert(maskedProfile.ssn.includes('*'), 'SSN masked in profile');
    assert(!maskedProfile.ssn.includes('987-65-4321'), 'Original SSN not in masked profile');
    
    // Test compliance check
    const compliance = await retrievedProfile.checkCompliance();
    assert(compliance.pciDss, 'PCI DSS compliance check passed');
    assert(compliance.gdpr, 'GDPR compliance check passed');
    
    // Clean up test data
    await SecureUserProfile.deleteOne({ userId: testUserId });
    success('Test profile cleaned up');
    
    // Test 7: Batch Operations
    section('Test 7: Batch Encryption Operations');
    const items = ['data1', 'data2', 'data3', 'data4', 'data5'];
    const batchEncrypted = await encryptionService.batchEncrypt(items, 'userData');
    
    assert(batchEncrypted.length === 5, 'All items encrypted in batch');
    assert(batchEncrypted.every(r => r.success), 'All batch encryptions successful');
    
    const encryptedItems = batchEncrypted.map(r => r.data);
    const batchDecrypted = await encryptionService.batchDecrypt(encryptedItems);
    
    assert(batchDecrypted.length === 5, 'All items decrypted in batch');
    assert(batchDecrypted.every(r => r.success), 'All batch decryptions successful');
    
    // Test 8: Encryption Validation
    section('Test 8: Encryption Validation');
    const validEncrypted = await encryptionService.encrypt('test', 'userData');
    assert(encryptionService.isEncrypted(validEncrypted), 'Valid encrypted data detected');
    assert(!encryptionService.isEncrypted('plain-text'), 'Plain text not detected as encrypted');
    
    const summary = encryptionService.getEncryptionSummary(validEncrypted);
    assert(summary.algorithm === 'aes-256-gcm', 'Correct algorithm in summary');
    assert(summary.compliant.pciDss, 'PCI DSS compliant');
    assert(summary.compliant.gdpr, 'GDPR compliant');
    
    // Test 9: Compliance Attestation
    section('Test 9: Compliance Attestation');
    const attestation = encryptionService.getComplianceAttestation();
    assert(attestation.standards.pciDss.compliant, 'PCI DSS attestation present');
    assert(attestation.standards.gdpr.compliant, 'GDPR attestation present');
    assert(attestation.standards.nist.compliant, 'NIST attestation present');
    assert(attestation.implementation.algorithm === 'aes-256-gcm', 'Correct algorithm documented');
    
    // Test 10: Error Handling
    section('Test 10: Error Handling');
    try {
      await encryptionService.decrypt('invalid-encrypted-data');
      error('Should have thrown error for invalid encrypted data');
      results.failed++;
      results.errors.push('Error handling: invalid encrypted data');
    } catch (err) {
      success('Correctly threw error for invalid encrypted data');
      results.passed++;
    }
    results.total++;
    
    // Final Results
    section('Test Results Summary');
    info(`Total Tests: ${results.total}`);
    success(`Passed: ${results.passed}`);
    if (results.failed > 0) {
      error(`Failed: ${results.failed}`);
      log('\nFailed Tests:', 'yellow');
      results.errors.forEach(err => warn(`  - ${err}`));
    }
    
    const successRate = ((results.passed / results.total) * 100).toFixed(2);
    log(`\nSuccess Rate: ${successRate}%`, successRate >= 95 ? 'green' : 'red');
    
    if (successRate >= 95) {
      section('✅ ENCRYPTION SYSTEM: READY FOR PRODUCTION');
    } else {
      section('⚠️  ENCRYPTION SYSTEM: NEEDS ATTENTION');
    }
    
    // Cleanup
    await mongoose.connection.close();
    success('Database connection closed');
    
    // Exit with appropriate code
    process.exit(results.failed > 0 ? 1 : 0);
    
  } catch (err) {
    error(`Test suite failed with error: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  runTests();
}

module.exports = { runTests };
