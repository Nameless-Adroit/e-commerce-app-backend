/**
 * Notification Service Abstraction
 * Handles SMS and administrative notifications behind a clean, provider-agnostic interface.
 * Implements mock/development logging and ensures delivery failures NEVER roll back business transactions.
 */
import { recordAuditEvent } from './audit.service.js';

/**
 * Base Notification Driver Interface
 */
class MockSmsDriver {
  async sendSms({ toPhone, message }) {
    console.log('\n======================================================');
    console.log(`📱 [SMS DISPATCH MOCK] To: ${toPhone}`);
    console.log(`💬 Message:\n"${message}"`);
    console.log('======================================================\n');
    return {
      success: true,
      messageId: `MOCK_SMS_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      status: 'delivered'
    };
  }
}

// Default driver is MockSmsDriver; can be replaced in production with Twilio / Beem / NextSMS provider
const currentDriver = new MockSmsDriver();

/**
 * Sends a generic notification safely
 */
export async function sendNotification({ toPhone, message, type = 'GENERIC', metadata = {} }) {
  if (!toPhone) {
    console.warn('⚠️ Notification skipped: No recipient phone number provided.');
    return { success: false, reason: 'NO_PHONE' };
  }

  try {
    const result = await currentDriver.sendSms({ toPhone, message });
    return { success: true, ...result };
  } catch (err) {
    // CRITICAL: SMS delivery failure must never crash or rollback the primary database transaction
    console.error(`❌ Notification delivery failure for ${toPhone} [${type}]:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Notifies Business Owner that their registration has been approved and activated
 */
export async function notifyBusinessApproved({ toPhone, businessName, ownerName }) {
  const message = `Hello ${ownerName || 'Business Owner'}, your business registration for "${businessName}" has been approved! Your account is now active. You can now log in to the JM Solution POS mobile application to begin operations.`;

  return sendNotification({
    toPhone,
    message,
    type: 'BUSINESS_REGISTRATION_APPROVED',
    metadata: { businessName, ownerName }
  });
}

/**
 * Notifies Business Owner that their registration was declined
 */
export async function notifyBusinessDeclined({ toPhone, businessName, reason }) {
  const message = `Notice: Your registration for "${businessName}" could not be approved. Reason: ${reason || 'Incomplete registration details or unconfirmed payment'}. Please contact our Technical Team for assistance.`;

  return sendNotification({
    toPhone,
    message,
    type: 'BUSINESS_REGISTRATION_DECLINED',
    metadata: { businessName, reason }
  });
}

/**
 * Notifies Business Owner of manual payment receipt and subscription renewal
 */
export async function notifyPaymentRecorded({ toPhone, businessName, amount, periodEnd, planName }) {
  const formattedEnd = new Date(periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const message = `Payment Confirmed: TSh ${Number(amount).toLocaleString()} received for "${businessName}". Your ${planName} subscription is active until ${formattedEnd}. Thank you for using JM Solution POS!`;

  return sendNotification({
    toPhone,
    message,
    type: 'PAYMENT_RECORDED',
    metadata: { businessName, amount, periodEnd, planName }
  });
}

/**
 * Notifies Business Owner of upcoming subscription expiry
 */
export async function notifySubscriptionExpiring({ toPhone, businessName, daysRemaining, periodEnd }) {
  const formattedEnd = new Date(periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const message = `Subscription Alert: Your "${businessName}" POS subscription expires in ${daysRemaining} day(s) on ${formattedEnd}. Please contact the Technical Team to renew without interruption.`;

  return sendNotification({
    toPhone,
    message,
    type: 'SUBSCRIPTION_EXPIRING',
    metadata: { businessName, daysRemaining, periodEnd }
  });
}

export default {
  sendNotification,
  notifyBusinessApproved,
  notifyBusinessDeclined,
  notifyPaymentRecorded,
  notifySubscriptionExpiring
};
