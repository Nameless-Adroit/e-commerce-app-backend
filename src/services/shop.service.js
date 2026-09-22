import { query } from '../config/database.config.js';
import { ROLES } from '../config/constants.js';

/**
 * List shops respecting role and business boundary:
 * - Super Admin: all shops or filtered by business_id
 * - Admin: all shops belonging to own business
 * - Seller: assigned shop only
 */
export async function getAllShops({ currentUser, businessId }) {
  let whereClauses = [];
  let params = [];

  if (currentUser) {
    if (currentUser.role === ROLES.ADMIN) {
      whereClauses.push('s.business_id = ?');
      params.push(currentUser.business_id);
    } else if (currentUser.role === ROLES.SELLER) {
      whereClauses.push('s.id = ?');
      params.push(currentUser.shop_id);
    } else if (currentUser.role === ROLES.SUPER_ADMIN && businessId) {
      whereClauses.push('s.business_id = ?');
      params.push(parseInt(businessId, 10));
    }
  } else if (businessId) {
    whereClauses.push('s.business_id = ?');
    params.push(parseInt(businessId, 10));
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sql = `
    SELECT s.*,
      b.name as business_name,
      b.business_code,
      COUNT(DISTINCT u.id) as staff_count,
      COUNT(DISTINCT p.id) as product_count,
      COALESCE(SUM(p.stock_quantity), 0) as total_units_in_stock
    FROM shops s
    LEFT JOIN businesses b ON s.business_id = b.id
    LEFT JOIN users u ON s.id = u.shop_id AND u.is_active = TRUE
    LEFT JOIN products p ON s.id = p.shop_id
    ${whereStr}
    GROUP BY s.id
    ORDER BY s.id ASC
  `;

  const shops = await query(sql, params);
  return shops.map(s => ({
    ...s,
    staff_count: parseInt(s.staff_count, 10) || 0,
    product_count: parseInt(s.product_count, 10) || 0,
    total_units_in_stock: parseInt(s.total_units_in_stock, 10) || 0
  }));
}

/**
 * Create a new shop under a Business (Super Admin only)
 */
export async function createShop({ currentUser, shopData }) {
  if (currentUser.role !== ROLES.SUPER_ADMIN) {
    const err = new Error('Direct store creation is restricted to Super Admins. Store Admins must submit a store request for approval.');
    err.statusCode = 403;
    throw err;
  }

  const { shop_code, name, address, phone, business_id } = shopData;

  if (!shop_code || !name) {
    const err = new Error('Shop code (e.g. SHP01) and shop display name are required.');
    err.statusCode = 400;
    throw err;
  }

  const targetBusinessId = business_id || currentUser.business_id;
  if (!targetBusinessId) {
    const err = new Error('A parent business_id is required to create a shop.');
    err.statusCode = 400;
    throw err;
  }

  // Enforce subscription plan max_shops limit
  const { enforceShopLimit } = await import('./subscription.service.js');
  await enforceShopLimit(targetBusinessId);

  // Fetch business to verify existence and inherit currency settings
  const businesses = await query('SELECT * FROM businesses WHERE id = ? LIMIT 1', [targetBusinessId]);
  if (!businesses || businesses.length === 0) {
    const err = new Error('Parent business not found.');
    err.statusCode = 404;
    throw err;
  }

  const business = businesses[0];
  const cleanCode = shop_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  const existing = await query('SELECT id FROM shops WHERE shop_code = ? LIMIT 1', [cleanCode]);
  if (existing && existing.length > 0) {
    const err = new Error(`Shop code '${cleanCode}' is already registered.`);
    err.statusCode = 409;
    throw err;
  }

  const currencyCode = (shopData.currency_code || business.currency_code || 'TZS').trim().toUpperCase();
  const currencySymbol = (shopData.currency_symbol || business.currency_symbol || 'TSh').trim();
  const currencyName = (shopData.currency_name || business.currency_name || 'Tanzanian Shilling').trim();

  const result = await query(
    `INSERT INTO shops (business_id, shop_code, name, address, phone, currency_code, currency_symbol, currency_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [targetBusinessId, cleanCode, name.trim(), address || null, phone || null, currencyCode, currencySymbol, currencyName]
  );

  return {
    id: result.insertId,
    business_id: targetBusinessId,
    business_name: business.name,
    shop_code: cleanCode,
    name: name.trim(),
    address: address || null,
    phone: phone || null,
    currency_code: currencyCode,
    currency_symbol: currencySymbol,
    currency_name: currencyName
  };
}

/**
 * Submit a request to add a new shop branch (Admin)
 */
export async function submitShopRequest({ currentUser, requestData }) {
  if (currentUser.role !== ROLES.ADMIN && currentUser.role !== ROLES.SUPER_ADMIN) {
    const err = new Error('Only Store Admins can submit store creation requests.');
    err.statusCode = 403;
    throw err;
  }

  const { shop_code, name, address, phone, admin_notes } = requestData;

  if (!shop_code || !name) {
    const err = new Error('Shop code (e.g. SHP02) and shop display name are required.');
    err.statusCode = 400;
    throw err;
  }

  const businessId = currentUser.business_id || requestData.business_id;
  if (!businessId) {
    const err = new Error('Business identifier is required.');
    err.statusCode = 400;
    throw err;
  }

  const cleanCode = shop_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Check existing shops
  const existingShop = await query('SELECT id FROM shops WHERE shop_code = ? LIMIT 1', [cleanCode]);
  if (existingShop && existingShop.length > 0) {
    const err = new Error(`Shop code '${cleanCode}' is already registered.`);
    err.statusCode = 409;
    throw err;
  }

  // Check existing pending requests
  const existingReq = await query(
    "SELECT id FROM shop_requests WHERE shop_code = ? AND status = 'pending' LIMIT 1",
    [cleanCode]
  );
  if (existingReq && existingReq.length > 0) {
    const err = new Error(`A pending request for shop code '${cleanCode}' is already awaiting review.`);
    err.statusCode = 409;
    throw err;
  }

  const result = await query(
    `INSERT INTO shop_requests (business_id, requested_by_user_id, shop_code, name, address, phone, admin_notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [businessId, currentUser.id, cleanCode, name.trim(), address || null, phone || null, admin_notes || null]
  );

  return {
    id: result.insertId,
    business_id: businessId,
    requested_by_user_id: currentUser.id,
    shop_code: cleanCode,
    name: name.trim(),
    address: address || null,
    phone: phone || null,
    admin_notes: admin_notes || null,
    status: 'pending'
  };
}

/**
 * List shop requests:
 * - Admin: requests belonging to own business
 * - Super Admin: all requests across platform
 */
export async function getShopRequests({ currentUser, status }) {
  let whereClauses = [];
  let params = [];

  if (currentUser.role === ROLES.ADMIN) {
    whereClauses.push('sr.business_id = ?');
    params.push(currentUser.business_id);
  }

  if (status) {
    whereClauses.push('sr.status = ?');
    params.push(status);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sql = `
    SELECT sr.*,
      b.name as business_name,
      b.business_code,
      u_req.full_name as requested_by_name,
      u_req.phone_number as requested_by_phone,
      u_rev.full_name as reviewed_by_name
    FROM shop_requests sr
    JOIN businesses b ON sr.business_id = b.id
    JOIN users u_req ON sr.requested_by_user_id = u_req.id
    LEFT JOIN users u_rev ON sr.reviewed_by_user_id = u_rev.id
    ${whereStr}
    ORDER BY sr.id DESC
  `;

  return await query(sql, params);
}

/**
 * Approve a shop request and instantiate the new shop (Super Admin only)
 */
export async function approveShopRequest({ currentUser, requestId, superAdminNotes }) {
  if (currentUser.role !== ROLES.SUPER_ADMIN) {
    const err = new Error('Only Super Admins can approve shop requests.');
    err.statusCode = 403;
    throw err;
  }

  const requests = await query('SELECT * FROM shop_requests WHERE id = ? LIMIT 1', [requestId]);
  if (!requests || requests.length === 0) {
    const err = new Error('Shop request not found.');
    err.statusCode = 404;
    throw err;
  }

  const reqRow = requests[0];
  if (reqRow.status !== 'pending') {
    const err = new Error(`Request cannot be approved because its current status is '${reqRow.status}'.`);
    err.statusCode = 400;
    throw err;
  }

  // Fetch business for currency inheritance
  const businesses = await query('SELECT * FROM businesses WHERE id = ? LIMIT 1', [reqRow.business_id]);
  if (!businesses || businesses.length === 0) {
    const err = new Error('Associated business not found.');
    err.statusCode = 404;
    throw err;
  }
  const business = businesses[0];

  // Enforce subscription plan max_shops limit
  const { enforceShopLimit } = await import('./subscription.service.js');
  await enforceShopLimit(reqRow.business_id);

  // Verify shop_code uniqueness in shops table
  const existingShop = await query('SELECT id FROM shops WHERE shop_code = ? LIMIT 1', [reqRow.shop_code]);
  if (existingShop && existingShop.length > 0) {
    const err = new Error(`Cannot approve: Shop code '${reqRow.shop_code}' is already active.`);
    err.statusCode = 409;
    throw err;
  }

  // Instantiate shop
  const createResult = await query(
    `INSERT INTO shops (business_id, shop_code, name, address, phone, currency_code, currency_symbol, currency_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reqRow.business_id,
      reqRow.shop_code,
      reqRow.name,
      reqRow.address || null,
      reqRow.phone || null,
      business.currency_code || 'TZS',
      business.currency_symbol || 'TSh',
      business.currency_name || 'Tanzanian Shilling'
    ]
  );

  const newShopId = createResult.insertId;

  // Update request record
  await query(
    `UPDATE shop_requests 
     SET status = 'approved',
         reviewed_by_user_id = ?,
         super_admin_notes = ?,
         created_shop_id = ?,
         reviewed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [currentUser.id, superAdminNotes || null, newShopId, requestId]
  );

  return {
    success: true,
    message: `Shop request approved successfully. Store '${reqRow.name}' (${reqRow.shop_code}) is now active.`,
    shop_id: newShopId,
    request_id: requestId
  };
}

/**
 * Reject a shop request (Super Admin only)
 */
export async function rejectShopRequest({ currentUser, requestId, superAdminNotes }) {
  if (currentUser.role !== ROLES.SUPER_ADMIN) {
    const err = new Error('Only Super Admins can reject shop requests.');
    err.statusCode = 403;
    throw err;
  }

  const requests = await query('SELECT * FROM shop_requests WHERE id = ? LIMIT 1', [requestId]);
  if (!requests || requests.length === 0) {
    const err = new Error('Shop request not found.');
    err.statusCode = 404;
    throw err;
  }

  const reqRow = requests[0];
  if (reqRow.status !== 'pending') {
    const err = new Error(`Request cannot be rejected because its current status is '${reqRow.status}'.`);
    err.statusCode = 400;
    throw err;
  }

  await query(
    `UPDATE shop_requests 
     SET status = 'rejected',
         reviewed_by_user_id = ?,
         super_admin_notes = ?,
         reviewed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [currentUser.id, superAdminNotes || null, requestId]
  );

  return {
    success: true,
    message: 'Shop request has been rejected.',
    request_id: requestId
  };
}

/**
 * Get shop details by ID including assigned staff, inventory summary, and business info
 */
export async function getShopById(shopId, currentUser) {
  const shops = await query(`
    SELECT s.*, b.name as business_name, b.business_code, b.status as business_status
    FROM shops s
    LEFT JOIN businesses b ON s.business_id = b.id
    WHERE s.id = ? LIMIT 1
  `, [shopId]);

  if (!shops || shops.length === 0) {
    const err = new Error('Shop not found.');
    err.statusCode = 404;
    throw err;
  }

  const shop = shops[0];

  // Enforce ownership boundary
  if (currentUser) {
    if (currentUser.role === ROLES.ADMIN && shop.business_id !== currentUser.business_id) {
      const err = new Error('Forbidden: You do not have permission to view shops outside your business.');
      err.statusCode = 403;
      throw err;
    }
    if (currentUser.role === ROLES.SELLER && shop.id !== currentUser.shop_id) {
      const err = new Error('Forbidden: Sellers are restricted to their assigned shop.');
      err.statusCode = 403;
      throw err;
    }
  }

  // Get assigned staff
  const staff = await query(
    'SELECT id, username, email, full_name, role, is_active FROM users WHERE shop_id = ?',
    [shopId]
  );

  // Get product stats
  const stats = await query(
    `SELECT COUNT(*) as product_count, 
            COALESCE(SUM(stock_quantity), 0) as total_units,
            COALESCE(SUM(stock_quantity * price), 0) as inventory_retail_value,
            COALESCE(SUM(stock_quantity * cost_price), 0) as inventory_cost_value
     FROM products WHERE shop_id = ?`,
    [shopId]
  );

  return {
    ...shop,
    staff,
    stats: stats[0]
  };
}

export default {
  getAllShops,
  createShop,
  submitShopRequest,
  getShopRequests,
  approveShopRequest,
  rejectShopRequest,
  getShopById
};

