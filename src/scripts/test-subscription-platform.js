/**
 * Automated Test Suite: Subscription Calculations, Renewal Arithmetic, Warning Thresholds & Notification Abstraction
 */
import '../utils/logger.util.js';
import assert from 'assert';
import { 
  calculateDaysRemaining, 
  getExpiryWarningLevel, 
  calculateRenewalDates 
} from '../services/subscription.service.js';
import * as notificationService from '../services/notification.service.js';

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

async function runSuite() {
  console.log('\n======================================================');
  console.log('💳 RUNNING SUBSCRIPTION & PLATFORM LOGIC TEST SUITE');
  console.log('======================================================\n');

  // ---------------------------------------------------------------------------
  // TEST SUITE 1: Dynamic Days Remaining Calculations
  // ---------------------------------------------------------------------------
  console.log('▶ TEST SUITE 1: Dynamic Days Remaining Calculation');

  report('Calculates future days remaining accurately (+15 days)', () => {
    const futureDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const days = calculateDaysRemaining(futureDate);
    assert.strictEqual(days, 15);
  });

  report('Calculates past date as negative / expired (-3 days)', () => {
    const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const days = calculateDaysRemaining(pastDate);
    assert.ok(days <= 0);
  });

  report('Handles null or missing end date cleanly as 0 days', () => {
    assert.strictEqual(calculateDaysRemaining(null), 0);
    assert.strictEqual(calculateDaysRemaining(undefined), 0);
  });

  // ---------------------------------------------------------------------------
  // TEST SUITE 2: Expiry Warning System Thresholds
  // ---------------------------------------------------------------------------
  console.log('\n▶ TEST SUITE 2: Expiry Warning Thresholds');

  report('35 days remaining -> "none"', () => {
    assert.strictEqual(getExpiryWarningLevel(35, 'active'), 'none');
  });

  report('25 days remaining -> "subtle"', () => {
    assert.strictEqual(getExpiryWarningLevel(25, 'active'), 'subtle');
  });

  report('6 days remaining -> "warning"', () => {
    assert.strictEqual(getExpiryWarningLevel(6, 'active'), 'warning');
  });

  report('2 days remaining -> "strong_warning"', () => {
    assert.strictEqual(getExpiryWarningLevel(2, 'active'), 'strong_warning');
  });

  report('1 day remaining -> "urgent"', () => {
    assert.strictEqual(getExpiryWarningLevel(1, 'active'), 'urgent');
  });

  report('0 or negative days remaining -> "expired"', () => {
    assert.strictEqual(getExpiryWarningLevel(0, 'active'), 'expired');
    assert.strictEqual(getExpiryWarningLevel(-5, 'active'), 'expired');
  });

  report('Inactive/cancelled status overrides to "expired"', () => {
    assert.strictEqual(getExpiryWarningLevel(20, 'cancelled'), 'expired');
    assert.strictEqual(getExpiryWarningLevel(20, 'declined'), 'expired');
  });

  // ---------------------------------------------------------------------------
  // TEST SUITE 3: Renewal Date Arithmetic (Preserving Active Time)
  // ---------------------------------------------------------------------------
  console.log('\n▶ TEST SUITE 3: Renewal Date Arithmetic');

  report('Preserves remaining active days when renewing active subscription', () => {
    // Current end date is 10 days in the future
    const activeFutureEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const { periodStart, periodEnd } = calculateRenewalDates({
      currentEndDate: activeFutureEnd,
      billingCycle: 'monthly',
      cycles: 1
    });

    // Start must match existing end date
    assert.strictEqual(periodStart.getTime(), activeFutureEnd.getTime());
    // End must be after start
    assert.ok(periodEnd.getTime() > periodStart.getTime());

    // Difference must be approximately 1 month (28 to 31 days)
    const diffDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    assert.ok(diffDays >= 28 && diffDays <= 31, `Expected ~30 days, got ${diffDays}`);
  });

  report('Starts from today if existing subscription is expired', () => {
    const expiredPastEnd = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const beforeCall = Date.now();
    const { periodStart, periodEnd } = calculateRenewalDates({
      currentEndDate: expiredPastEnd,
      billingCycle: 'monthly',
      cycles: 1
    });
    const afterCall = Date.now();

    assert.ok(periodStart.getTime() >= beforeCall && periodStart.getTime() <= afterCall);
    assert.ok(periodEnd.getTime() > periodStart.getTime());
  });

  report('Handles multi-cycle and yearly renewals accurately', () => {
    const now = new Date();
    const { periodStart, periodEnd } = calculateRenewalDates({
      currentEndDate: now,
      billingCycle: 'yearly',
      cycles: 2
    });

    assert.strictEqual(periodEnd.getFullYear(), periodStart.getFullYear() + 2);
  });

  report('Handles daily subscription renewals (+1 day per cycle)', () => {
    const now = new Date();
    const { periodStart, periodEnd } = calculateRenewalDates({
      currentEndDate: now,
      billingCycle: 'daily',
      cycles: 3
    });

    const diffDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays, 3);
  });

  report('Handles weekly subscription renewals (+7 days per cycle)', () => {
    const now = new Date();
    const { periodStart, periodEnd } = calculateRenewalDates({
      currentEndDate: now,
      billingCycle: 'weekly',
      cycles: 2
    });

    const diffDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays, 14);
  });

  // ---------------------------------------------------------------------------
  // TEST SUITE 4: Notification Service Safe Dispatch
  // ---------------------------------------------------------------------------
  console.log('\n▶ TEST SUITE 4: Notification Abstraction & Safe Dispatch');

  await reportAsync('Dispatches registration approval notification without error', async () => {
    const res = await notificationService.notifyBusinessApproved({
      toPhone: '+255754123456',
      businessName: 'Apex Tech Retail',
      ownerName: 'Juma Mkwawa'
    });
    assert.strictEqual(res.success, true);
    assert.ok(res.messageId.startsWith('MOCK_SMS_'));
  });

  await reportAsync('Dispatches registration declined notification without error', async () => {
    const res = await notificationService.notifyBusinessDeclined({
      toPhone: '+255754123456',
      businessName: 'Apex Tech Retail',
      reason: 'Manual bank deposit could not be verified'
    });
    assert.strictEqual(res.success, true);
  });

  await reportAsync('Handles missing phone number safely without throwing', async () => {
    const res = await notificationService.sendNotification({
      toPhone: '',
      message: 'Test message'
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'NO_PHONE');
  });

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
