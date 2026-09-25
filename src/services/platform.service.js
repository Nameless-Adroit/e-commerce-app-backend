/**
 * Platform Administration Service (Platform Owner / Technical Team Gateway)
 * Manages database-driven platform settings, registration approvals, manual payment methods, and platform KPIs.
 */
import { query, executeTransaction } from '../config/database.config.js';
import { recordAuditEvent } from './audit.service.js';
import { notifyBusinessApproved, notifyBusinessDeclined } from './notification.service.js';
import { listPlans, calculateRenewalDates, calculateDaysRemaining, getExpiryWarningLevel } from './subscription.service.js';
import { ROLES } from '../config/constants.js';

// -----------------------------------------------------------------------------
// 1. Database-Driven Platform Settings & Public Config
// -----------------------------------------------------------------------------

/**
 * Retrieves public configuration consumed by mobile clients & web gateway
 * Safe for unauthenticated clients: exposes zero sensitive credentials.
 */
export async function getPublicPlatformConfig() {
  // 1. Platform Settings
  const settingsRows = await query('SELECT * FROM platform_settings ORDER BY id ASC LIMIT 1');
  const settings = settingsRows[0] || {
    platform_name: 'JM Solution POS',
    support_name: 'JM Solution Technical Team',
    support_phone: '+255 754 000 000',
    support_whatsapp: '+255 754 000 000',
    support_email: 'support@jmsolutions.co.tz',
    support_address: 'Dar es Salaam, Tanzania',
    terms_version: 'v1.0',
    terms_content: 'Default terms and conditions.'
  };

  // 2. Active Payment Methods (instructions for manual payment)
  const paymentMethodsRows = await query(`
    SELECT id, name, type, account_name, account_number, instructions, is_active
    FROM payment_methods
    WHERE is_active = TRUE
    ORDER BY id ASC
  `);

  const formattedPaymentMethods = paymentMethodsRows.map(pm => ({
    ...pm,
    provider_name: pm.name,
    channel_type: (pm.type || 'MOBILE_MONEY').toLowerCase(),
    is_active: pm.is_active !== undefined ? Boolean(pm.is_active) : true
  }));

  // 3. Active Subscription Plans
  const plans = await listPlans({ activeOnly: true });

  return {
    platformName: settings.platform_name,
    support: {
      name: settings.support_name,
      phone: settings.support_phone,
      whatsapp: settings.support_whatsapp,
      email: settings.support_email,
      address: settings.support_address
    },
    terms: {
      version: settings.terms_version,
      content: settings.terms_content
    },
    settings: {
      platform_name: settings.platform_name,
      support_phone: settings.support_phone,
      support_email: settings.support_email,
      terms_and_conditions: settings.terms_content,
      privacy_policy: settings.terms_content,
      registration_instructions: 'Complete the steps below and submit your payment verification code.'
    },
    paymentMethods: formattedPaymentMethods,
    payment_methods: formattedPaymentMethods,
    plans
  };
}

/**
 * Retrieves full platform settings for editing (Platform Owner)
 */
export async function getPlatformSettings() {
  const rows = await query('SELECT * FROM platform_settings ORDER BY id ASC LIMIT 1');
  return rows[0] || null;
}

/**
 * Updates platform configuration (Platform Owner)
 */
export async function updatePlatformSettings(updates, currentUser) {
  const {
    platform_name,
    support_name,
    support_phone,
    support_whatsapp,
    support_email,
    support_address,
    terms_version,
    terms_content,
    privacy_policy_version,
    privacy_policy_content
  } = updates;

  const current = await getPlatformSettings();
  if (!current) {
    const err = new Error('Platform settings record not found.');
    err.statusCode = 404;
    throw err;
  }

  const fields = [];
  const params = [];
  const changes = {};

  if (platform_name !== undefined) {
    fields.push('platform_name = ?');
    params.push(platform_name.trim());
    changes.platform_name = platform_name.trim();
  }
  if (support_name !== undefined) {
    fields.push('support_name = ?');
    params.push(support_name.trim());
    changes.support_name = support_name.trim();
  }
  if (support_phone !== undefined) {
    fields.push('support_phone = ?');
    params.push(support_phone.trim());
    changes.support_phone = support_phone.trim();
  }
  if (support_whatsapp !== undefined) {
    fields.push('support_whatsapp = ?');
    params.push(support_whatsapp.trim());
    changes.support_whatsapp = support_whatsapp.trim();
  }
  if (support_email !== undefined) {
    fields.push('support_email = ?');
    params.push(support_email.trim());
    changes.support_email = support_email.trim();
  }
  if (support_address !== undefined) {
    fields.push('support_address = ?');
    params.push(support_address.trim());
    changes.support_address = support_address.trim();
  }
  if (terms_version !== undefined) {
    fields.push('terms_version = ?');
    params.push(terms_version.trim());
    changes.terms_version = terms_version.trim();
  }
  if (terms_content !== undefined) {
    fields.push('terms_content = ?');
    params.push(terms_content);
    changes.terms_content = '[UPDATED]';
  }
  if (privacy_policy_version !== undefined) {
    fields.push('privacy_policy_version = ?');
    params.push(privacy_policy_version.trim());
  }
  if (privacy_policy_content !== undefined) {
    fields.push('privacy_policy_content = ?');
    params.push(privacy_policy_content);
  }

  if (currentUser) {
    fields.push('updated_by = ?');
    params.push(currentUser.id);
  }

  if (fields.length > 0) {
    params.push(current.id);
    await query(`UPDATE platform_settings SET ${fields.join(', ')} WHERE id = ?`, params);

    if (currentUser) {
      await recordAuditEvent({
        userId: currentUser.id,
        action: 'PLATFORM_SETTINGS_UPDATED',
        targetResource: 'platform_settings',
        targetId: current.id,
        changes
      });
    }
  }

  return getPlatformSettings();
}

// -----------------------------------------------------------------------------
// 2. Manual Payment Methods Management
// -----------------------------------------------------------------------------

export async function listPaymentMethods({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE is_active = TRUE' : '';
  const sql = `SELECT * FROM payment_methods ${where} ORDER BY id ASC`;
  const rows = await query(sql);
  return rows.map(pm => ({
    ...pm,
    provider_name: pm.name,
    channel_type: (pm.type || 'MOBILE_MONEY').toLowerCase(),
    is_active: pm.is_active !== undefined ? Boolean(pm.is_active) : true
  }));
}

export async function createPaymentMethod({ name, provider_name, type, channel_type, account_name, account_number, instructions, currentUser }) {
  const resolvedName = (name || provider_name || '').trim();
  const rawType = (type || channel_type || 'MOBILE_MONEY').toUpperCase();
  const validTypes = ['MOBILE_MONEY', 'BANK_TRANSFER', 'CASH', 'OTHER'];
  const resolvedType = validTypes.includes(rawType) ? rawType : 'OTHER';
  const resolvedAccName = (account_name || '').trim();
  const resolvedAccNumber = (account_number || '').trim();

  if (!resolvedName || !resolvedAccName || !resolvedAccNumber) {
    const err = new Error('Name, account name, and account number are required.');
    err.statusCode = 400;
    throw err;
  }

  const result = await query(`
    INSERT INTO payment_methods (name, type, account_name, account_number, instructions, is_active)
    VALUES (?, ?, ?, ?, ?, TRUE)
  `, [
    resolvedName,
    resolvedType,
    resolvedAccName,
    resolvedAccNumber,
    instructions ? instructions.trim() : ''
  ]);

  if (currentUser) {
    await recordAuditEvent({
      userId: currentUser.id,
      action: 'PAYMENT_METHOD_CREATED',
      targetResource: 'payment_methods',
      targetId: result.insertId,
      changes: { name: resolvedName, type: resolvedType, account_number: resolvedAccNumber }
    });
  }

  const rows = await query('SELECT * FROM payment_methods WHERE id = ?', [result.insertId]);
  const created = rows[0];
  return {
    ...created,
    provider_name: created.name,
    channel_type: (created.type || 'MOBILE_MONEY').toLowerCase()
  };
}

export async function updatePaymentMethod(methodId, updates, currentUser) {
  const resolvedName = updates.name !== undefined ? updates.name : updates.provider_name;
  let resolvedType = updates.type !== undefined ? updates.type : (updates.channel_type ? updates.channel_type.toUpperCase() : undefined);
  if (resolvedType) {
    const validTypes = ['MOBILE_MONEY', 'BANK_TRANSFER', 'CASH', 'OTHER'];
    resolvedType = validTypes.includes(resolvedType) ? resolvedType : 'OTHER';
  }
  const { account_name, account_number, instructions, is_active } = updates;
  const fields = [];
  const params = [];

  if (resolvedName !== undefined) { fields.push('name = ?'); params.push(resolvedName.trim()); }
  if (resolvedType !== undefined) { fields.push('type = ?'); params.push(resolvedType); }
  if (account_name !== undefined) { fields.push('account_name = ?'); params.push(account_name.trim()); }
  if (account_number !== undefined) { fields.push('account_number = ?'); params.push(account_number.trim()); }
  if (instructions !== undefined) { fields.push('instructions = ?'); params.push(instructions.trim()); }
  if (is_active !== undefined) { fields.push('is_active = ?'); params.push(Boolean(is_active)); }

  if (fields.length > 0) {
    params.push(methodId);
    await query(`UPDATE payment_methods SET ${fields.join(', ')} WHERE id = ?`, params);

    if (currentUser) {
      await recordAuditEvent({
        userId: currentUser.id,
        action: 'PAYMENT_METHOD_UPDATED',
        targetResource: 'payment_methods',
        targetId: methodId,
        changes: updates
      });
    }
  }

  const rows = await query('SELECT * FROM payment_methods WHERE id = ?', [methodId]);
  const updated = rows[0];
  return {
    ...updated,
    provider_name: updated?.name,
    channel_type: (updated?.type || 'MOBILE_MONEY').toLowerCase()
  };
}

// -----------------------------------------------------------------------------
// 3. Business Registration Requests & Approvals
// -----------------------------------------------------------------------------

/**
 * Lists business registration requests with filtering
 * @param {'all'|'pending'|'approved'|'declined'} filter
 */
export async function listRegistrationRequests(filter = 'pending') {
  let statusCondition = '';
  if (filter === 'pending') {
    statusCondition = "WHERE b.subscription_status IN ('payment_pending', 'payment_received', 'pending_review', 'draft')";
  } else if (filter === 'approved') {
    statusCondition = "WHERE b.subscription_status = 'active'";
  } else if (filter === 'declined') {
    statusCondition = "WHERE b.subscription_status = 'declined'";
  }

  const sql = `
    SELECT 
      b.id as business_id,
      b.name as business_name,
      b.business_code,
      b.currency_code,
      b.currency_symbol,
      b.status as business_status,
      b.subscription_status,
      b.subscription_start_date,
      b.subscription_end_date,
      b.terms_accepted_version,
      b.terms_accepted_at,
      b.registration_notes,
      b.rejection_reason,
      b.created_at as registered_at,
      p.id as plan_id,
      p.name as plan_name,
      p.plan_code,
      p.price as plan_price,
      p.billing_cycle,
      u.id as owner_id,
      u.full_name as owner_name,
      u.phone_number as owner_phone,
      u.email as owner_email,
      (SELECT COUNT(*) FROM subscription_payments WHERE business_id = b.id) as payment_count,
      (SELECT COALESCE(SUM(amount), 0) FROM subscription_payments WHERE business_id = b.id) as total_paid
    FROM businesses b
    LEFT JOIN users u ON b.owner_user_id = u.id
    LEFT JOIN subscription_plans p ON b.subscription_plan_id = p.id
    ${statusCondition}
    ORDER BY b.created_at DESC
  `;

  const rows = await query(sql);
  return rows.map(r => ({
    ...r,
    plan_price: parseFloat(r.plan_price || 0),
    total_paid: parseFloat(r.total_paid || 0),
    payment_count: parseInt(r.payment_count, 10) || 0
  }));
}

/**
 * Approves a business registration request and activates the business
 */
export async function approveRegistrationRequest(businessId, { adminNotes, currentUser }) {
  const parsedBusinessId = parseInt(businessId, 10);

  const businessRows = await query(`
    SELECT b.*, u.phone_number as owner_phone, u.full_name as owner_name, p.billing_cycle, p.name as plan_name
    FROM businesses b
    LEFT JOIN users u ON b.owner_user_id = u.id
    LEFT JOIN subscription_plans p ON b.subscription_plan_id = p.id
    WHERE b.id = ? LIMIT 1
  `, [parsedBusinessId]);

  if (!businessRows || businessRows.length === 0) {
    const err = new Error('Business not found.');
    err.statusCode = 404;
    throw err;
  }
  const b = businessRows[0];

  // Calculate subscription start & end
  const { periodStart, periodEnd } = calculateRenewalDates({
    currentEndDate: b.subscription_end_date,
    billingCycle: b.billing_cycle || 'monthly',
    cycles: 1
  });

  const formattedStart = periodStart.toISOString().slice(0, 19).replace('T', ' ');
  const formattedEnd = periodEnd.toISOString().slice(0, 19).replace('T', ' ');

  await executeTransaction(async (conn) => {
    // 1. Activate business and subscription
    await conn.query(`
      UPDATE businesses 
      SET 
        status = 'active',
        subscription_status = 'active',
        subscription_start_date = COALESCE(subscription_start_date, ?),
        subscription_end_date = COALESCE(subscription_end_date, ?),
        registration_notes = COALESCE(?, registration_notes),
        rejection_reason = NULL
      WHERE id = ?
    `, [formattedStart, formattedEnd, adminNotes || null, parsedBusinessId]);

    // 2. Activate owner user
    if (b.owner_user_id) {
      await conn.query('UPDATE users SET is_active = TRUE WHERE id = ?', [b.owner_user_id]);
    }

    // 3. Ensure a primary shop exists under this business
    const [shopCount] = await conn.query('SELECT COUNT(*) as count FROM shops WHERE business_id = ?', [parsedBusinessId]);
    if (shopCount[0].count === 0) {
      const defaultShopCode = `SHP${String(parsedBusinessId).padStart(2, '0')}-01`;
      await conn.query(`
        INSERT INTO shops (business_id, shop_code, name, address, phone, currency_code, currency_symbol, currency_name, is_active)
        VALUES (?, ?, ?, 'Main Branch', ?, ?, ?, ?, TRUE)
      `, [
        parsedBusinessId,
        defaultShopCode,
        `${b.name} - Main Branch`,
        b.owner_phone || null,
        b.currency_code || 'TZS',
        b.currency_symbol || 'TSh',
        b.currency_name || 'Tanzanian Shilling'
      ]);
    }
  });

  // Audit event
  if (currentUser) {
    await recordAuditEvent({
      userId: currentUser.id,
      action: 'BUSINESS_APPROVED',
      targetResource: 'businesses',
      targetId: parsedBusinessId,
      businessId: parsedBusinessId,
      changes: {
        subscription_status: 'active',
        status: 'active',
        notes: adminNotes || 'Approved by Platform Owner'
      }
    });
  }

  // Non-blocking notification dispatch
  if (b.owner_phone) {
    notifyBusinessApproved({
      toPhone: b.owner_phone,
      businessName: b.name,
      ownerName: b.owner_name
    }).catch(() => {});
  }

  return { success: true, message: `Business "${b.name}" has been approved and activated.` };
}

/**
 * Declines a business registration request
 */
export async function declineRegistrationRequest(businessId, { rejectionReason, currentUser }) {
  const parsedBusinessId = parseInt(businessId, 10);

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
  const b = businessRows[0];
  const reason = rejectionReason || 'Registration conditions not satisfied or manual payment unconfirmed.';

  await query(`
    UPDATE businesses 
    SET 
      subscription_status = 'declined',
      status = 'suspended',
      rejection_reason = ?
    WHERE id = ?
  `, [reason, parsedBusinessId]);

  if (currentUser) {
    await recordAuditEvent({
      userId: currentUser.id,
      action: 'BUSINESS_DECLINED',
      targetResource: 'businesses',
      targetId: parsedBusinessId,
      businessId: parsedBusinessId,
      changes: { rejection_reason: reason }
    });
  }

  if (b.owner_phone) {
    notifyBusinessDeclined({
      toPhone: b.owner_phone,
      businessName: b.name,
      reason
    }).catch(() => {});
  }

  return { success: true, message: `Business registration for "${b.name}" has been declined.` };
}

// -----------------------------------------------------------------------------
// 4. Platform Owner Dashboard Metrics
// -----------------------------------------------------------------------------

export async function getPlatformDashboardMetrics() {
  const [totalBiz] = await query('SELECT COUNT(*) as count FROM businesses');
  const [activeBiz] = await query("SELECT COUNT(*) as count FROM businesses WHERE status = 'active' AND subscription_status IN ('active', 'trial')");
  const [pendingReq] = await query("SELECT COUNT(*) as count FROM businesses WHERE subscription_status IN ('payment_pending', 'payment_received', 'pending_review', 'draft')");
  const [expiredBiz] = await query(`
    SELECT COUNT(*) as count 
    FROM businesses 
    WHERE subscription_status = 'expired' OR (subscription_end_date IS NOT NULL AND subscription_end_date < NOW())
  `);
  const [revenueRows] = await query('SELECT COALESCE(SUM(amount), 0) as total FROM subscription_payments');
  const [expiringSoon] = await query(`
    SELECT COUNT(*) as count 
    FROM businesses 
    WHERE subscription_status IN ('active', 'trial') 
      AND subscription_end_date IS NOT NULL 
      AND subscription_end_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)
  `);

  // Active shops & sellers counts
  const [activeShops] = await query("SELECT COUNT(*) as count FROM shops WHERE is_active = TRUE").catch(() => [{ count: 0 }]);
  const [activeSellers] = await query("SELECT COUNT(*) as count FROM users WHERE role = 'seller' AND is_active = TRUE").catch(() => [{ count: 0 }]);

  // Expiring businesses (strictly <= 30 days or already expired)
  const expiringBusinessesRows = await query(`
    SELECT b.id, b.name, b.business_code, b.subscription_status, b.subscription_end_date, p.name as plan_name
    FROM businesses b
    LEFT JOIN subscription_plans p ON b.subscription_plan_id = p.id
    WHERE b.subscription_end_date IS NOT NULL 
      AND (
        (b.subscription_status IN ('active', 'trial') AND b.subscription_end_date <= DATE_ADD(NOW(), INTERVAL 30 DAY))
        OR b.subscription_status = 'expired'
      )
    ORDER BY b.subscription_end_date ASC
    LIMIT 20
  `).catch(() => []);

  const expiring_businesses = (expiringBusinessesRows || []).map((b) => {
    const daysRemaining = calculateDaysRemaining(b.subscription_end_date);
    const warningLevel = getExpiryWarningLevel(daysRemaining, b.subscription_status);
    return {
      id: b.id,
      name: b.name,
      business_code: b.business_code,
      subscription_status: b.subscription_status,
      subscription_end_date: b.subscription_end_date,
      days_remaining: daysRemaining,
      warning_level: warningLevel,
      plan_name: b.plan_name || 'Retail Plan'
    };
  });

  // Recent payments
  const recentPayments = await query(`
    SELECT sp.*, b.name as business_name, p.name as plan_name, u.full_name as recorded_by_name
    FROM subscription_payments sp
    JOIN businesses b ON sp.business_id = b.id
    JOIN subscription_plans p ON sp.plan_id = p.id
    LEFT JOIN users u ON sp.recorded_by_user_id = u.id
    ORDER BY sp.created_at DESC
    LIMIT 5
  `).catch(() => []);

  // Recent registrations
  const recentRegistrations = await query(`
    SELECT b.id, b.name, b.business_code, b.subscription_status, b.created_at, u.full_name as owner_name, u.phone_number as owner_phone, p.name as plan_name
    FROM businesses b
    LEFT JOIN users u ON b.owner_user_id = u.id
    LEFT JOIN subscription_plans p ON b.subscription_plan_id = p.id
    ORDER BY b.created_at DESC
    LIMIT 5
  `).catch(() => []);

  const totalBusinesses = parseInt(totalBiz?.count || 0, 10);
  const activeBusinesses = parseInt(activeBiz?.count || 0, 10);
  const pendingRegistrations = parseInt(pendingReq?.count || 0, 10);
  const expiredBusinesses = parseInt(expiredBiz?.count || 0, 10);
  const expiringSoonCount = parseInt(expiringSoon?.count || 0, 10);
  const totalRevenue = parseFloat(revenueRows?.total || 0);
  const totalActiveShops = parseInt(activeShops?.count || 0, 10);
  const totalActiveSellers = parseInt(activeSellers?.count || 0, 10);

  return {
    total_businesses: totalBusinesses,
    totalBusinesses,
    active_subscriptions: activeBusinesses,
    activeBusinesses,
    pending_registrations: pendingRegistrations,
    pendingRegistrations,
    expired_count: expiredBusinesses,
    expiredBusinesses,
    expiring_soon_count: expiringSoonCount,
    expiringSoonCount,
    total_revenue_tzs: totalRevenue,
    totalRevenue,
    total_active_shops: totalActiveShops,
    totalActiveShops,
    total_active_sellers: totalActiveSellers,
    totalActiveSellers,
    expiring_businesses,
    expiringBusinesses: expiring_businesses,
    recent_payments: recentPayments.map(p => ({ ...p, amount: parseFloat(p.amount) })),
    recentPayments: recentPayments.map(p => ({ ...p, amount: parseFloat(p.amount) })),
    recent_registrations: recentRegistrations,
    recentRegistrations
  };
}

// -----------------------------------------------------------------------------
// 5. Platform Audit Logs
// -----------------------------------------------------------------------------

export async function getPlatformAuditLogs({ limit = 50, offset = 0, action = null } = {}) {
  let where = '';
  const params = [];

  if (action) {
    where = 'WHERE a.action = ?';
    params.push(action);
  }

  params.push(parseInt(limit, 10) || 50);
  params.push(parseInt(offset, 10) || 0);

  const sql = `
    SELECT a.*, u.full_name as user_name, u.role as user_role, b.name as business_name
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN businesses b ON a.business_id = b.id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `;

  return query(sql, params);
}

export default {
  getPublicPlatformConfig,
  getPlatformSettings,
  updatePlatformSettings,
  listPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  listRegistrationRequests,
  approveRegistrationRequest,
  declineRegistrationRequest,
  getPlatformDashboardMetrics,
  getPlatformAuditLogs
};
