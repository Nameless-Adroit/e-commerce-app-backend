/**
 * Subscription & Billing Service
 * Handles plan management, live dynamic days remaining calculations,
 * non-destructive period renewals, manual payment recordings, and quota limit enforcement.
 */
import { query, executeTransaction } from '../config/database.config.js';
import { recordAuditEvent } from './audit.service.js';
import { notifyPaymentRecorded } from './notification.service.js';

/**
 * Calculates live days remaining dynamically from an end date
 * @param {Date|string|null} endDate
 * @returns {number}
 */
export function calculateDaysRemaining(endDate) {
  if (!endDate) return 0;
  const target = new Date(endDate).getTime();
  const now = Date.now();
  const diffMs = target - now;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Derives subscription warning level dynamically
 * @param {number} daysRemaining
 * @param {string} status
 * @returns {'none'|'subtle'|'warning'|'strong_warning'|'urgent'|'expired'}
 */
export function getExpiryWarningLevel(daysRemaining, status) {
  if (status === 'expired' || status === 'cancelled' || status === 'declined') return 'expired';
  if (daysRemaining <= 0) return 'expired';
  if (daysRemaining <= 1) return 'urgent';
  if (daysRemaining <= 3) return 'strong_warning';
  if (daysRemaining <= 7) return 'warning';
  if (daysRemaining <= 30) return 'subtle';
  return 'none';
}

/**
 * Calculates renewal start and end dates accurately for monthly/yearly cycles
 * Preserves remaining active subscription time.
 * 
 * @param {object} params
 * @param {Date|string|null} params.currentEndDate
 * @param {'monthly'|'yearly'} params.billingCycle
 * @param {number} params.cycles
 * @returns {{ periodStart: Date, periodEnd: Date }}
 */
export function calculateRenewalDates({ currentEndDate, billingCycle = 'monthly', cycles = 1 }) {
  const numCycles = Math.max(1, parseInt(cycles, 10) || 1);
  const now = new Date();
  let baseStart = now;

  // If currently active and end date is in the future, don't destroy remaining time!
  if (currentEndDate) {
    const existingEnd = new Date(currentEndDate);
    if (existingEnd.getTime() > now.getTime()) {
      baseStart = existingEnd;
    }
  }

  const periodStart = new Date(baseStart.getTime());
  const periodEnd = new Date(baseStart.getTime());

  if (billingCycle === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + numCycles);
  } else if (billingCycle === 'weekly') {
    periodEnd.setDate(periodEnd.getDate() + (7 * numCycles));
  } else if (billingCycle === 'daily') {
    periodEnd.setDate(periodEnd.getDate() + numCycles);
  } else {
    // monthly: handle calendar month rollover accurately
    const targetMonth = periodEnd.getMonth() + numCycles;
    periodEnd.setMonth(targetMonth);
  }

  return { periodStart, periodEnd };
}

// -----------------------------------------------------------------------------
// 1. Subscription Plans Management (Platform Owner)
// -----------------------------------------------------------------------------

/**
 * Lists subscription plans
 * @param {boolean} activeOnly - If true, returns only active plans (for client choices)
 */
export async function listPlans({ activeOnly = false } = {}) {
  const whereClause = activeOnly ? 'WHERE is_active = TRUE' : '';
  const sql = `
    SELECT id, plan_code, name, price, billing_cycle, max_shops, max_sellers, is_active, created_at, updated_at
    FROM subscription_plans
    ${whereClause}
    ORDER BY price ASC
  `;
  const plans = await query(sql);
  return plans.map(p => ({
    ...p,
    price: parseFloat(p.price),
    price_tzs: parseFloat(p.price),
    duration_days: p.billing_cycle === 'daily' ? 1 : p.billing_cycle === 'weekly' ? 7 : p.billing_cycle === 'yearly' ? 365 : 30,
    max_shops: parseInt(p.max_shops, 10),
    max_sellers: p.max_sellers !== null ? parseInt(p.max_sellers, 10) : null,
    is_active: Boolean(p.is_active)
  }));
}

/**
 * Retrieves a single subscription plan by ID
 */
export async function getPlanById(planId) {
  const plans = await query(
    'SELECT * FROM subscription_plans WHERE id = ? LIMIT 1',
    [planId]
  );
  if (!plans || plans.length === 0) {
    const err = new Error('Subscription plan not found.');
    err.statusCode = 404;
    throw err;
  }
  const p = plans[0];
  return {
    ...p,
    price: parseFloat(p.price),
    max_shops: parseInt(p.max_shops, 10),
    max_sellers: p.max_sellers !== null ? parseInt(p.max_sellers, 10) : null,
    is_active: Boolean(p.is_active)
  };
}

/**
 * Creates a new subscription plan (Platform Owner)
 */
export async function createPlan({ plan_code, name, price, billing_cycle = 'monthly', max_shops = 1, max_sellers = null, currentUser }) {
  if (!plan_code || !name || price === undefined) {
    const err = new Error('Plan code, name, and price are required.');
    err.statusCode = 400;
    throw err;
  }

  const cleanCode = plan_code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const cleanPrice = parseFloat(price);
  if (isNaN(cleanPrice) || cleanPrice < 0) {
    const err = new Error('Plan price must be a valid non-negative number.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await query('SELECT id FROM subscription_plans WHERE plan_code = ? LIMIT 1', [cleanCode]);
  if (existing.length > 0) {
    const err = new Error(`A subscription plan with code '${cleanCode}' already exists.`);
    err.statusCode = 409;
    throw err;
  }

  const result = await query(`
    INSERT INTO subscription_plans 
      (plan_code, name, price, billing_cycle, max_shops, max_sellers, is_active)
    VALUES (?, ?, ?, ?, ?, ?, TRUE)
  `, [
    cleanCode,
    name.trim(),
    cleanPrice,
    ['daily', 'weekly', 'monthly', 'yearly'].includes(billing_cycle) ? billing_cycle : 'monthly',
    parseInt(max_shops, 10) || 1,
    max_sellers !== null && max_sellers !== '' ? parseInt(max_sellers, 10) : null
  ]);

  if (currentUser) {
    await recordAuditEvent({
      userId: currentUser.id,
      action: 'PLAN_CREATED',
      targetResource: 'subscription_plans',
      targetId: result.insertId,
      changes: { plan_code: cleanCode, name: name.trim(), price: cleanPrice }
    });
  }

  return getPlanById(result.insertId);
}

/**
 * Updates an existing subscription plan (Platform Owner)
 */
export async function updatePlan(planId, { name, price, billing_cycle, max_shops, max_sellers, is_active, currentUser }) {
  const plan = await getPlanById(planId);

  const fields = [];
  const params = [];
  const changes = {};

  if (name !== undefined) {
    fields.push('name = ?');
    params.push(name.trim());
    changes.name = name.trim();
  }
  if (price !== undefined) {
    const p = parseFloat(price);
    if (isNaN(p) || p < 0) {
      const err = new Error('Invalid price value.');
      err.statusCode = 400;
      throw err;
    }
    fields.push('price = ?');
    params.push(p);
    changes.price = p;
  }
  if (billing_cycle !== undefined) {
    fields.push('billing_cycle = ?');
    params.push(['daily', 'weekly', 'monthly', 'yearly'].includes(billing_cycle) ? billing_cycle : 'monthly');
    changes.billing_cycle = billing_cycle;
  }
  if (max_shops !== undefined) {
    fields.push('max_shops = ?');
    params.push(parseInt(max_shops, 10) || 1);
    changes.max_shops = max_shops;
  }
  if (max_sellers !== undefined) {
    fields.push('max_sellers = ?');
    params.push(max_sellers !== null && max_sellers !== '' ? parseInt(max_sellers, 10) : null);
    changes.max_sellers = max_sellers;
  }
  if (is_active !== undefined) {
    fields.push('is_active = ?');
    params.push(Boolean(is_active));
    changes.is_active = Boolean(is_active);
  }

  if (fields.length > 0) {
    params.push(planId);
    await query(`UPDATE subscription_plans SET ${fields.join(', ')} WHERE id = ?`, params);

    if (currentUser) {
      await recordAuditEvent({
        userId: currentUser.id,
        action: 'PLAN_UPDATED',
        targetResource: 'subscription_plans',
        targetId: planId,
        changes
      });
    }
  }

  return getPlanById(planId);
}

/**
 * Retires / deactivates a plan so it cannot be chosen by new businesses,
 * preserving historical records without breaking foreign keys.
 */
export async function retirePlan(planId, { currentUser } = {}) {
  await getPlanById(planId);
  await query('UPDATE subscription_plans SET is_active = FALSE WHERE id = ?', [planId]);

  if (currentUser) {
    await recordAuditEvent({
      userId: currentUser.id,
      action: 'PLAN_RETIRED',
      targetResource: 'subscription_plans',
      targetId: planId,
      changes: { is_active: false }
    });
  }

  return { success: true, message: 'Plan retired successfully.' };
}

// -----------------------------------------------------------------------------
// 2. Business Subscription & Live Status
// -----------------------------------------------------------------------------

/**
 * Retrieves full subscription state for a given business including dynamic days remaining
 */
export async function getBusinessSubscription(businessId) {
  const sql = `
    SELECT 
      b.id as business_id,
      b.name as business_name,
      b.business_code,
      b.status as business_status,
      b.subscription_plan_id,
      b.subscription_status,
      b.subscription_start_date,
      b.subscription_end_date,
      b.owner_user_id,
      u.full_name as owner_name,
      u.phone_number as owner_phone,
      u.email as owner_email,
      p.plan_code,
      p.name as plan_name,
      p.price as plan_price,
      p.billing_cycle,
      p.max_shops,
      p.max_sellers,
      (SELECT COUNT(*) FROM shops WHERE business_id = b.id) as shops_count,
      (SELECT COUNT(*) FROM users WHERE business_id = b.id AND role = 'seller' AND is_active = TRUE) as sellers_count
    FROM businesses b
    LEFT JOIN users u ON b.owner_user_id = u.id
    LEFT JOIN subscription_plans p ON b.subscription_plan_id = p.id
    WHERE b.id = ? LIMIT 1
  `;

  const rows = await query(sql, [businessId]);
  if (!rows || rows.length === 0) {
    const err = new Error('Business not found.');
    err.statusCode = 404;
    throw err;
  }

  const b = rows[0];
  const daysRemaining = calculateDaysRemaining(b.subscription_end_date);
  const warningLevel = getExpiryWarningLevel(daysRemaining, b.subscription_status);

  return {
    business_id: b.business_id,
    business_name: b.business_name,
    business_code: b.business_code,
    business_status: b.business_status,
    subscription_status: b.subscription_status,
    subscription_start_date: b.subscription_start_date,
    subscription_end_date: b.subscription_end_date,
    days_remaining: daysRemaining,
    warning_level: warningLevel,
    owner: {
      id: b.owner_user_id,
      name: b.owner_name,
      phone: b.owner_phone,
      email: b.owner_email
    },
    plan: b.subscription_plan_id ? {
      id: b.subscription_plan_id,
      plan_code: b.plan_code,
      name: b.plan_name,
      price: parseFloat(b.plan_price || 0),
      billing_cycle: b.billing_cycle,
      max_shops: parseInt(b.max_shops, 10) || 1,
      max_sellers: b.max_sellers !== null ? parseInt(b.max_sellers, 10) : null
    } : null,
    active_shops_count: parseInt(b.shops_count, 10) || 0,
    max_shops: b.max_shops ? parseInt(b.max_shops, 10) : 1,
    active_sellers_count: parseInt(b.sellers_count, 10) || 0,
    max_sellers: b.max_sellers !== null ? parseInt(b.max_sellers, 10) : null,
    is_expired: b.subscription_status === 'expired' || daysRemaining <= 0,
    payments: await getSubscriptionHistory(businessId),
    usage: {
      current_shops: parseInt(b.shops_count, 10) || 0,
      max_shops: b.max_shops ? parseInt(b.max_shops, 10) : 1,
      current_sellers: parseInt(b.sellers_count, 10) || 0,
      max_sellers: b.max_sellers !== null ? parseInt(b.max_sellers, 10) : null
    }
  };
}

/**
 * Retrieves payment history ledger for a business
 */
export async function getSubscriptionHistory(businessId) {
  const sql = `
    SELECT 
      sp.*,
      p.name as plan_name,
      p.plan_code,
      u.full_name as recorded_by_name
    FROM subscription_payments sp
    LEFT JOIN subscription_plans p ON sp.plan_id = p.id
    LEFT JOIN users u ON sp.recorded_by_user_id = u.id
    WHERE sp.business_id = ?
    ORDER BY sp.created_at DESC
  `;
  const payments = await query(sql, [businessId]);
  return payments.map(p => ({
    ...p,
    amount: parseFloat(p.amount),
    status: p.status || 'verified'
  }));
}

/**
 * Lists all businesses for the Super Admin Billing Section, sorted by soonest expiration
 */
export async function listBusinessesBilling() {
  const sql = `
    SELECT 
      b.id,
      b.name as business_name,
      b.business_code,
      b.status as business_status,
      b.subscription_status,
      b.subscription_start_date,
      b.subscription_end_date,
      p.name as plan_name,
      p.plan_code,
      p.price as plan_price,
      p.billing_cycle,
      u.full_name as owner_name,
      u.phone_number as owner_phone,
      (SELECT COUNT(*) FROM shops WHERE business_id = b.id) as shops_count,
      (SELECT COUNT(*) FROM users WHERE business_id = b.id AND role = 'seller' AND is_active = TRUE) as sellers_count
    FROM businesses b
    LEFT JOIN users u ON b.owner_user_id = u.id
    LEFT JOIN subscription_plans p ON b.subscription_plan_id = p.id
    ORDER BY 
      CASE WHEN b.subscription_end_date IS NULL THEN 1 ELSE 0 END,
      b.subscription_end_date ASC
  `;

  const rows = await query(sql);
  return rows.map(b => {
    const daysRemaining = calculateDaysRemaining(b.subscription_end_date);
    const warningLevel = getExpiryWarningLevel(daysRemaining, b.subscription_status);
    return {
      id: b.id,
      business_name: b.business_name,
      business_code: b.business_code,
      business_status: b.business_status,
      subscription_status: b.subscription_status,
      subscription_start_date: b.subscription_start_date,
      subscription_end_date: b.subscription_end_date,
      days_remaining: daysRemaining,
      warning_level: warningLevel,
      owner_name: b.owner_name,
      owner_phone: b.owner_phone,
      plan_name: b.plan_name || 'No Plan',
      plan_code: b.plan_code || null,
      billing_cycle: b.billing_cycle || 'monthly',
      shops_count: parseInt(b.shops_count, 10) || 0,
      sellers_count: parseInt(b.sellers_count, 10) || 0
    };
  });
}

// -----------------------------------------------------------------------------
// 3. Subscription Renewal & Manual Payment Recording
// -----------------------------------------------------------------------------

/**
 * Renews a business's subscription manually by recording a validated external payment
 * 
 * @param {object} params
 * @param {number} params.businessId
 * @param {number} params.planId
 * @param {number} params.cycles
 * @param {number} params.amountPaid
 * @param {string} params.paymentMethod ('CASH'|'BANK_TRANSFER'|'MOBILE_MONEY'|'OTHER')
 * @param {string} params.paymentReference
 * @param {string} params.notes
 * @param {object} params.currentUser (Platform Owner)
 */
export async function renewBusinessSubscription({
  businessId,
  planId,
  plan_id,
  cycles = 1,
  amountPaid,
  amount,
  paymentMethod,
  payment_method,
  paymentReference,
  payment_reference,
  notes = '',
  currentUser
}) {
  const parsedBusinessId = parseInt(businessId, 10);
  if (isNaN(parsedBusinessId)) {
    const err = new Error('Invalid business ID.');
    err.statusCode = 400;
    throw err;
  }

  // 1. Fetch current business state
  const businessRows = await query(`
    SELECT b.*, u.phone_number as owner_phone, u.full_name as owner_name
    FROM businesses b
    LEFT JOIN users u ON b.owner_user_id = u.id
    WHERE b.id = ? LIMIT 1
  `, [parsedBusinessId]);

  if (!businessRows || businessRows.length === 0) {
    const err = new Error('Business not found.');
    err.statusCode = 404;
    throw err;
  }
  const business = businessRows[0];

  // 2. Fetch target plan (fallback to current plan if not provided)
  const targetPlanId = planId || plan_id || business.subscription_plan_id;
  if (!targetPlanId) {
    const err = new Error('No subscription plan specified or found for this business.');
    err.statusCode = 400;
    throw err;
  }
  const parsedPlanId = parseInt(targetPlanId, 10);
  const plan = await getPlanById(parsedPlanId);

  // 3. Expected price calculation & validation
  const numCycles = Math.max(1, parseInt(cycles, 10) || 1);
  const expectedAmount = plan.price * numCycles;

  const rawAmount = (amountPaid !== undefined && amountPaid !== null && amountPaid !== '')
    ? amountPaid
    : (amount !== undefined && amount !== null && amount !== '')
      ? amount
      : expectedAmount;

  const recordedAmount = parseFloat(rawAmount);
  if (isNaN(recordedAmount) || recordedAmount < 0) {
    const err = new Error('Payment amount must be a valid non-negative number.');
    err.statusCode = 400;
    throw err;
  }

  // Handle amount difference transparently
  let manualAdjustmentNote = '';
  if (Math.abs(recordedAmount - expectedAmount) > 0.01) {
    manualAdjustmentNote = ` [Manual Adjustment: Expected ${expectedAmount.toLocaleString()}, Recorded ${recordedAmount.toLocaleString()}]`;
  }

  // 4. Normalize payment method enum & preserve original in notes
  const rawMethod = payment_method || paymentMethod || 'CASH';
  let normalizedPaymentMethod = 'OTHER';
  const upper = (rawMethod || '').toUpperCase();
  if (upper.includes('CASH') || upper === 'CASH') {
    normalizedPaymentMethod = 'CASH';
  } else if (upper.includes('BANK') || upper.includes('CRDB') || upper.includes('NMB') || upper.includes('TRANSFER')) {
    normalizedPaymentMethod = 'BANK_TRANSFER';
  } else if (upper.includes('MPESA') || upper.includes('M-PESA') || upper.includes('AIRTEL') || upper.includes('TIGO') || upper.includes('HALOPESA') || upper.includes('MOBILE')) {
    normalizedPaymentMethod = 'MOBILE_MONEY';
  } else if (['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER'].includes(upper)) {
    normalizedPaymentMethod = upper;
  }

  const effectiveRef = payment_reference || paymentReference || '';
  const effectiveNotes = notes || '';
  const combinedNotes = [
    rawMethod && rawMethod !== normalizedPaymentMethod ? `Channel: ${rawMethod}` : null,
    effectiveNotes.trim() ? effectiveNotes.trim() : null,
    manualAdjustmentNote.trim() ? manualAdjustmentNote.trim() : null
  ].filter(Boolean).join(' | ');

  // 5. Calculate period start and end dates (preserving remaining active days)
  const { periodStart, periodEnd } = calculateRenewalDates({
    currentEndDate: business.subscription_end_date,
    billingCycle: plan.billing_cycle,
    cycles: numCycles
  });

  const formattedStart = periodStart.toISOString().slice(0, 19).replace('T', ' ');
  const formattedEnd = periodEnd.toISOString().slice(0, 19).replace('T', ' ');

  // Keep original subscription_start_date if currently active, or update to now if new/expired
  const now = new Date();
  const wasActive = business.subscription_end_date && new Date(business.subscription_end_date).getTime() > now.getTime();
  const businessStartDate = wasActive && business.subscription_start_date 
    ? new Date(business.subscription_start_date).toISOString().slice(0, 19).replace('T', ' ')
    : now.toISOString().slice(0, 19).replace('T', ' ');

  // 6. Atomic ACID execution
  await executeTransaction(async (conn) => {
    // A. Insert payment ledger record
    await conn.query(`
      INSERT INTO subscription_payments 
        (business_id, plan_id, amount, payment_method, payment_reference, period_start, period_end, recorded_by_user_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      parsedBusinessId,
      parsedPlanId,
      recordedAmount,
      normalizedPaymentMethod,
      effectiveRef ? effectiveRef.trim() : null,
      formattedStart,
      formattedEnd,
      currentUser ? currentUser.id : 1,
      combinedNotes || null
    ]);

    // B. Update business subscription fields and activate
    await conn.query(`
      UPDATE businesses
      SET 
        subscription_plan_id = ?,
        subscription_status = 'active',
        status = 'active',
        subscription_start_date = ?,
        subscription_end_date = ?
      WHERE id = ?
    `, [
      parsedPlanId,
      businessStartDate,
      formattedEnd,
      parsedBusinessId
    ]);
  });

  // 6. Record Platform Audit Log
  if (currentUser) {
    await recordAuditEvent({
      userId: currentUser.id,
      action: 'SUBSCRIPTION_RENEWED',
      targetResource: 'businesses',
      targetId: parsedBusinessId,
      businessId: parsedBusinessId,
      changes: {
        plan_id: parsedPlanId,
        plan_code: plan.plan_code,
        amount: recordedAmount,
        cycles: numCycles,
        period_start: formattedStart,
        period_end: formattedEnd,
        payment_method: paymentMethod
      }
    });
  }

  // 7. Trigger non-blocking SMS Notification
  if (business.owner_phone) {
    notifyPaymentRecorded({
      toPhone: business.owner_phone,
      businessName: business.name,
      amount: recordedAmount,
      periodEnd: periodEnd,
      planName: plan.name
    }).catch(() => {});
  }

  return getBusinessSubscription(parsedBusinessId);
}

/**
 * Cancels a business subscription (Platform Owner)
 */
export async function cancelBusinessSubscription({ businessId, reason, currentUser }) {
  const parsedBusinessId = parseInt(businessId, 10);
  await query(`
    UPDATE businesses 
    SET subscription_status = 'cancelled', status = 'suspended'
    WHERE id = ?
  `, [parsedBusinessId]);

  if (currentUser) {
    await recordAuditEvent({
      userId: currentUser.id,
      action: 'SUBSCRIPTION_CANCELLED',
      targetResource: 'businesses',
      targetId: parsedBusinessId,
      businessId: parsedBusinessId,
      changes: { reason: reason || 'Cancelled by Platform Owner' }
    });
  }

  return getBusinessSubscription(parsedBusinessId);
}

// -----------------------------------------------------------------------------
// 4. Server-Side Quota & Limit Enforcement
// -----------------------------------------------------------------------------

/**
 * Validates that the business has not reached its maximum allowed shops
 * @param {number} businessId
 * @throws {Error} 403 Forbidden with clear upgrade instructions if quota exceeded
 */
export async function enforceShopLimit(businessId) {
  const sub = await getBusinessSubscription(businessId);
  const maxShops = sub.plan?.max_shops || 1;
  const currentShops = sub.usage.current_shops;

  if (currentShops >= maxShops) {
    const err = new Error(`Your current subscription allows up to ${maxShops} shop(s). Please contact the Technical Team to upgrade your subscription.`);
    err.statusCode = 403;
    err.code = 'LIMIT_SHOPS_EXCEEDED';
    throw err;
  }
}

/**
 * Validates that the business has not reached its maximum allowed sellers
 * @param {number} businessId
 * @throws {Error} 403 Forbidden with clear upgrade instructions if quota exceeded
 */
export async function enforceSellerLimit(businessId) {
  const sub = await getBusinessSubscription(businessId);
  const maxSellers = sub.plan?.max_sellers ?? sub.max_sellers; // null means unlimited

  if (maxSellers !== null && maxSellers !== undefined) {
    const currentSellers = sub.usage?.current_sellers ?? sub.active_sellers_count ?? 0;
    if (currentSellers >= maxSellers) {
      const planName = sub.plan?.name || 'current';
      const err = new Error(`Your ${planName} plan allows up to ${maxSellers} active cashier account(s) (${currentSellers} currently active). Please upgrade your subscription plan in Billing to add more cashiers.`);
      err.statusCode = 403;
      err.code = 'LIMIT_SELLERS_EXCEEDED';
      throw err;
    }
  }
}

export default {
  calculateDaysRemaining,
  getExpiryWarningLevel,
  calculateRenewalDates,
  listPlans,
  getPlanById,
  createPlan,
  updatePlan,
  retirePlan,
  getBusinessSubscription,
  getSubscriptionHistory,
  listBusinessesBilling,
  renewBusinessSubscription,
  cancelBusinessSubscription,
  enforceShopLimit,
  enforceSellerLimit
};
