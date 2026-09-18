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
 * Create a new shop under a Business (Admin for own business, or Super Admin for any business)
 */
export async function createShop({ currentUser, shopData }) {
  const { shop_code, name, address, phone, business_id } = shopData;

  if (!shop_code || !name) {
    const err = new Error('Shop code (e.g. SHP01) and shop display name are required.');
    err.statusCode = 400;
    throw err;
  }

  // Determine target business ID
  let targetBusinessId;
  if (currentUser.role === ROLES.ADMIN) {
    targetBusinessId = currentUser.business_id;
  } else if (currentUser.role === ROLES.SUPER_ADMIN) {
    targetBusinessId = business_id || currentUser.business_id;
  } else {
    const err = new Error('Only Admins and Super Admins can create shops.');
    err.statusCode = 403;
    throw err;
  }

  if (!targetBusinessId) {
    const err = new Error('A parent business_id is required to create a shop.');
    err.statusCode = 400;
    throw err;
  }

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
  getShopById
};
