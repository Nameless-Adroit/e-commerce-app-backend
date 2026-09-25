import '../utils/logger.util.js';
import assert from 'assert';
import { testConnection, query } from '../config/database.config.js';
import * as phoneUtil from '../utils/phone.util.js';
import * as pinUtil from '../utils/pin.util.js';
import * as tokenUtil from '../utils/token.util.js';
import * as sessionService from '../services/session.service.js';
import * as securityService from '../services/security.service.js';
import * as authService from '../services/auth.service.js';
import { ROLES } from '../config/constants.js';

let passedTests = 0;
let failedTests = 0;

function report(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function reportAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('🔒 RUNNING AUTHENTICATION & SECURITY TEST SUITE');
  console.log('======================================================\n');

  // ---------------------------------------------------------------------------
  // SECTION 1: Phone Normalization & Validation Unit Tests
  // ---------------------------------------------------------------------------
  console.log('▶ TEST SUITE 1: Phone Utilities (Tanzanian Format & Operators)');
  
  report('Normalizes 0754123456 to +255754123456 (Vodacom)', () => {
    const res = phoneUtil.normalizeTanzanianPhone('0754123456');
    assert.strictEqual(res, '+255754123456');
    assert.strictEqual(phoneUtil.getTanzanianOperator(res), 'Vodacom');
    assert.strictEqual(phoneUtil.isValidTanzanianPhone(res), true);
  });

  report('Normalizes 255655123456 to +255655123456 (Tigo)', () => {
    const res = phoneUtil.normalizeTanzanianPhone('255655123456');
    assert.strictEqual(res, '+255655123456');
    assert.strictEqual(phoneUtil.getTanzanianOperator(res), 'Tigo');
    assert.strictEqual(phoneUtil.isValidTanzanianPhone(res), true);
  });

  report('Normalizes +255 784 123 456 with spaces to +255784123456 (Airtel)', () => {
    const res = phoneUtil.normalizeTanzanianPhone('+255 784 123 456');
    assert.strictEqual(res, '+255784123456');
    assert.strictEqual(phoneUtil.getTanzanianOperator(res), 'Airtel');
    assert.strictEqual(phoneUtil.isValidTanzanianPhone(res), true);
  });

  report('Normalizes Halotel prefix 0622123456', () => {
    const res = phoneUtil.normalizeTanzanianPhone('0622123456');
    assert.strictEqual(res, '+255622123456');
    assert.strictEqual(phoneUtil.getTanzanianOperator(res), 'Halotel');
    assert.strictEqual(phoneUtil.isValidTanzanianPhone(res), true);
  });

  report('Rejects invalid phone numbers', () => {
    assert.strictEqual(phoneUtil.normalizeTanzanianPhone('0812345678'), null);
    assert.strictEqual(phoneUtil.normalizeTanzanianPhone('12345'), null);
    assert.strictEqual(phoneUtil.normalizeTanzanianPhone('abcdefghij'), null);
  });

  // ---------------------------------------------------------------------------
  // SECTION 2: PIN Hashing & Validation Unit Tests
  // ---------------------------------------------------------------------------
  console.log('\n▶ TEST SUITE 2: PIN Security Utilities (Hashing & Verification)');

  report('Validates exactly 6-digit numeric PINs', () => {
    assert.strictEqual(pinUtil.isValidPin('123456'), true);
    assert.strictEqual(pinUtil.isValidPin('987654'), true);
    assert.strictEqual(pinUtil.isValidPin('1234'), false); // 4 digits rejected (now 6 required)
    assert.strictEqual(pinUtil.isValidPin('123'), false); // Too short
    assert.strictEqual(pinUtil.isValidPin('1234567'), false); // Too long
    assert.strictEqual(pinUtil.isValidPin('12345a'), false); // Non-numeric
  });

  await reportAsync('Hashes and verifies 6-digit PIN with bcrypt constant-time comparison', async () => {
    const pin = '123456';
    const hash = await pinUtil.hashPin(pin);
    assert.ok(hash.startsWith('$2'), 'Hash should be a valid bcrypt hash');
    const valid = await pinUtil.verifyPin(pin, hash);
    assert.strictEqual(valid, true, 'Valid PIN must match');
    const invalid = await pinUtil.verifyPin('999999', hash);
    assert.strictEqual(invalid, false, 'Invalid PIN must fail');
  });

  // ---------------------------------------------------------------------------
  // SECTION 3: Token Architecture (Access & Opaque Refresh Tokens)
  // ---------------------------------------------------------------------------
  console.log('\n▶ TEST SUITE 3: Dual-Token Architecture');

  report('Issues short-lived access token with minimal claims', () => {
    const payload = {
      id: 999,
      username: 'test_seller',
      role: 'seller',
      business_id: 1,
      shop_id: 1,
      session_id: 'SES-TEST-001'
    };
    const token = tokenUtil.generateAccessToken(payload);
    assert.ok(typeof token === 'string' && token.split('.').length === 3);

    const decoded = tokenUtil.verifyAccessToken(token);
    assert.strictEqual(decoded.id, payload.id);
    assert.strictEqual(decoded.role, payload.role);
    assert.strictEqual(decoded.session_id, payload.session_id);
    assert.ok(decoded.exp > decoded.iat, 'Token must have expiration');
  });

  report('Generates crypto-random opaque refresh token and SHA-256 hash', () => {
    const rawToken = tokenUtil.generateOpaqueRefreshToken();
    assert.strictEqual(rawToken.length, 96, 'Raw token should be 48 bytes hex (96 chars)');
    const hash = tokenUtil.hashRefreshToken(rawToken);
    assert.strictEqual(hash.length, 64, 'SHA-256 hash is 64 hex characters');
    const hashAgain = tokenUtil.hashRefreshToken(rawToken);
    assert.strictEqual(hash, hashAgain, 'Hash must be deterministic');
  });

  // ---------------------------------------------------------------------------
  // SECTION 4: Database Integration & Session Token Family Lifecycle
  // ---------------------------------------------------------------------------
  console.log('\n▶ TEST SUITE 4: Database Integration & Session Token Family Lifecycle');

  const isConnected = await testConnection();
  if (!isConnected) {
    console.log('  ⚠️ Database server not reachable locally; skipping database integration tests.');
    printSummary();
    return;
  }

  // Setup test user with phone and PIN
  const testPhone = '+255712999888';
  const testPin = '654321';
  const testPinHash = await pinUtil.hashPin(testPin);

  await query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', ['test_security_user']);
  await query('DELETE FROM security_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)', ['test_security_user']);
  await query('DELETE FROM users WHERE username = ?', ['test_security_user']);

  const insertResult = await query(`
    INSERT INTO users (
      username, email, phone_number, pin_hash, role, full_name, is_active
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?
    )
  `, ['test_security_user', 'sec@test.local', testPhone, testPinHash, 'seller', 'Test Security User', true]);
  
  const testUserId = insertResult.insertId;

  await reportAsync('Creates new session with hashed refresh token', async () => {
    const { session, rawRefreshToken } = await sessionService.createSession({
      userId: testUserId,
      deviceInfo: { userAgent: 'SecurityTestRunner/1.0', ipAddress: '127.0.0.1', deviceType: 'desktop' }
    });

    assert.ok(session.id);
    assert.strictEqual(session.user_id, testUserId);
    assert.ok(rawRefreshToken);

    const activeSessions = await sessionService.getUserActiveSessions(testUserId);
    assert.strictEqual(activeSessions.length, 1);
    assert.strictEqual(activeSessions[0].id, session.id);
  });

  await reportAsync('Rotates session token and updates token family hash', async () => {
    // 1. Create a session
    const { session, rawRefreshToken: token1 } = await sessionService.createSession({
      userId: testUserId,
      deviceInfo: { userAgent: 'SecurityTestRunner/1.0', ipAddress: '127.0.0.1', deviceType: 'mobile' }
    });

    // 2. Rotate with token1
    const rotationResult = await sessionService.rotateSessionToken({
      rawRefreshToken: token1,
      ipAddress: '127.0.0.1',
      userAgent: 'SecurityTestRunner/1.0'
    });

    assert.ok(rotationResult, 'Rotation should succeed');
    assert.ok(rotationResult.newRawRefreshToken);
    assert.notStrictEqual(rotationResult.newRawRefreshToken, token1, 'New token must differ from old');
    assert.strictEqual(rotationResult.session.id, session.id);

    // 3. TOKEN REUSE DETECTION TEST: Attempting to reuse old token1 MUST trigger security alarm & revoke family
    let reuseError = null;
    try {
      await sessionService.rotateSessionToken({
        rawRefreshToken: token1,
        ipAddress: '192.168.1.100', // Attacker IP
        userAgent: 'MaliciousClient/1.0'
      });
    } catch (err) {
      reuseError = err;
    }

    assert.ok(reuseError, 'Token reuse must throw an error');
    assert.ok(reuseError.message.includes('reuse') || reuseError.message.includes('revoked'), 'Should report token reuse');

    // Verify session was revoked in database
    const checkSession = await sessionService.findSessionById(session.id);
    assert.strictEqual(checkSession.is_revoked, 1, 'Session must be revoked after token reuse detection');
  });

  // ---------------------------------------------------------------------------
  // SECTION 5: Brute-Force Protection & Account Lockout
  // ---------------------------------------------------------------------------
  console.log('\n▶ TEST SUITE 5: Brute-Force Rate Limiting & Account Lockout');

  await reportAsync('Locks account after 5 consecutive failed attempts', async () => {
    // Clear failed attempts first
    await securityService.resetFailedAttempts(testUserId);

    // Simulate 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const lockRes = await securityService.recordFailedAttempt({
        userId: testUserId,
        identifier: testPhone,
        reason: 'INVALID_PIN',
        ipAddress: '127.0.0.1'
      });
      assert.strictEqual(lockRes.locked, false, `Attempt ${i} should not lock account yet`);
    }

    // 5th failed attempt should trigger lockout
    const fifthAttempt = await securityService.recordFailedAttempt({
      userId: testUserId,
      identifier: testPhone,
      reason: 'INVALID_PIN',
      ipAddress: '127.0.0.1'
    });
    assert.strictEqual(fifthAttempt.locked, true, '5th failed attempt must trigger lockout');
    assert.ok(fifthAttempt.lockoutMinutes > 0, 'Lockout duration must be positive');

    // Check account lockout status
    const lockoutStatus = await securityService.checkAccountLockout(testUserId);
    assert.strictEqual(lockoutStatus.locked, true, 'Account should be locked');

    // Verify authentication is blocked while locked
    let authError = null;
    try {
      await authService.authenticateUser({
        phoneNumber: testPhone,
        pin: testPin,
        ipAddress: '127.0.0.1',
        userAgent: 'SecurityTestRunner/1.0'
      });
    } catch (err) {
      authError = err;
    }
    assert.ok(authError, 'Authentication must fail when account is locked');
    assert.ok(
      authError.message.includes('CANNOT EXECUTE NOW TRY LATER') ||
      authError.statusCode === 429 ||
      authError.statusCode === 423
    );

    // Reset lockout
    await securityService.resetFailedAttempts(testUserId);
    const resetStatus = await securityService.checkAccountLockout(testUserId);
    assert.strictEqual(resetStatus.locked, false, 'Account should be unlocked after reset');
  });

  // ---------------------------------------------------------------------------
  // SECTION 6: Full Authentication Workflows
  // ---------------------------------------------------------------------------
  console.log('\n▶ TEST SUITE 6: Full Authentication Workflows (Phone+PIN & Super Admin)');

  await reportAsync('Authenticates staff via Phone Number and PIN', async () => {
    const authResult = await authService.authenticateUser({
      phoneNumber: testPhone,
      pin: testPin,
      ipAddress: '127.0.0.1',
      userAgent: 'StaffMobileApp/2.0'
    });

    assert.ok(authResult.accessToken, 'Must return accessToken');
    assert.ok(authResult.rawRefreshToken, 'Must return rawRefreshToken for cookie');
    assert.strictEqual(authResult.user.id, testUserId);
    assert.strictEqual(authResult.user.phone_number, testPhone);
  });

  await reportAsync('Authenticates Super Admin via Phone Number and 6-digit PIN', async () => {
    const saAuth = await authService.authenticateUser({
      phoneNumber: '+255700000001',
      pin: '123456',
      ipAddress: '127.0.0.1',
      userAgent: 'AdminPortal/2.0'
    });

    assert.ok(saAuth.accessToken);
    assert.strictEqual(saAuth.user.role, ROLES.SUPER_ADMIN);
    assert.strictEqual(saAuth.user.pin_hash, undefined);
  });

  await reportAsync('Revokes all sessions on logout-all', async () => {
    // Create 2 sessions
    await sessionService.createSession({ userId: testUserId, deviceInfo: { userAgent: 'Dev1', ipAddress: '127.0.0.1' } });
    await sessionService.createSession({ userId: testUserId, deviceInfo: { userAgent: 'Dev2', ipAddress: '127.0.0.1' } });

    const activeBefore = await sessionService.getUserActiveSessions(testUserId);
    assert.ok(activeBefore.length >= 2, 'Should have multiple active sessions');

    // Revoke all
    await sessionService.revokeAllUserSessions(testUserId);

    const activeAfter = await sessionService.getUserActiveSessions(testUserId);
    assert.strictEqual(activeAfter.length, 0, 'All sessions should be revoked');
  });

  // Cleanup test artifacts
  await query('DELETE FROM sessions WHERE user_id = ?', [testUserId]);
  await query('DELETE FROM security_logs WHERE user_id = ?', [testUserId]);
  await query('DELETE FROM users WHERE id = ?', [testUserId]);

  printSummary();
}

function printSummary() {
  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================\n');
  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
