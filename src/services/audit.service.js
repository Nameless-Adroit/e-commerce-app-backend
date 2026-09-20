/**
 * Business Audit Logging Service
 * Records administrative and business operational events (user changes, price modifications, shop adjustments).
 */
import { query } from '../config/database.config.js';

/**
 * Sanitizes audit payload to prevent accidental leakage of sensitive credentials.
 * 
 * @param {object|null} changes
 * @returns {object|null}
 */
function sanitizeAuditChanges(changes) {
  if (!changes || typeof changes !== 'object') return null;
  const sanitized = { ...changes };
  const sensitiveKeys = ['password', 'pin', 'token', 'secret', 'password_hash', 'pin_hash'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
}

/**
 * Records an immutable business audit log entry.
 * 
 * @param {object} params
 * @param {number} params.userId - Actor user ID
 * @param {string} params.action - e.g. USER_CREATED, USER_UPDATED, USER_STATUS_CHANGED, PRICE_CHANGED
 * @param {string} params.targetResource - e.g. users, products, shops, businesses
 * @param {string|number|null} params.targetId - ID of target entity
 * @param {number|null} params.shopId - Scope shop ID if applicable
 * @param {number|null} params.businessId - Scope business ID if applicable
 * @param {object|null} params.changes - Details / diff of changes
 */
export async function recordAuditEvent({ userId, action, targetResource, targetId = null, shopId = null, businessId = null, changes = null }) {
  try {
    const safeChanges = sanitizeAuditChanges(changes);
    const jsonStr = safeChanges ? JSON.stringify(safeChanges) : null;

    await query(
      `INSERT INTO audit_logs (user_id, action, target_resource, target_id, shop_id, business_id, changes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        action,
        targetResource,
        targetId ? String(targetId) : null,
        shopId || null,
        businessId || null,
        jsonStr
      ]
    );
  } catch (err) {
    console.error('Failed to write business audit log:', err.message);
  }
}

/**
 * Retrieves audit logs with role/scope filtering.
 * 
 * @param {object} params
 * @param {number|null} params.businessId
 * @param {number|null} params.shopId
 * @param {number} params.limit
 * @param {number} params.offset
 * @returns {Promise<Array<object>>}
 */
export async function getAuditLogs({ businessId = null, shopId = null, limit = 50, offset = 0 } = {}) {
  const whereClauses = [];
  const params = [];

  if (businessId) {
    whereClauses.push('a.business_id = ?');
    params.push(businessId);
  }
  if (shopId) {
    whereClauses.push('a.shop_id = ?');
    params.push(shopId);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  params.push(Math.min(limit, 100), offset);

  const logs = await query(
    `SELECT a.id, a.user_id, u.full_name as user_name, u.role as user_role,
            a.action, a.target_resource, a.target_id, a.shop_id, a.business_id,
            a.changes, a.created_at
     FROM audit_logs a
     JOIN users u ON a.user_id = u.id
     ${whereStr}
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );

  return logs.map(l => ({
    ...l,
    changes: typeof l.changes === 'string' ? JSON.parse(l.changes) : l.changes
  }));
}

export default {
  recordAuditEvent,
  getAuditLogs
};
