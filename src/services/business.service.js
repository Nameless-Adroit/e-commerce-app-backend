import { query } from '../config/database.config.js';
import { BUSINESS_STATUS, ROLES } from '../config/constants.js';

/**
 * List all businesses with aggregated counts and metrics (Super Admin)
 */
export async function getAllBusinesses() {
  const sql = `
    SELECT 
      b.*,
      COUNT(DISTINCT s.id) as shops_count,
      COUNT(DISTINCT CASE WHEN u.role = 'admin' AND u.is_active = TRUE THEN u.id END) as admins_count,
      COUNT(DISTINCT CASE WHEN u.role = 'seller' AND u.is_active = TRUE THEN u.id END) as sellers_count,
      COALESCE(SUM(t.total_amount), 0) as total_revenue
    FROM businesses b
    LEFT JOIN shops s ON b.id = s.business_id
    LEFT JOIN users u ON b.id = u.business_id
    LEFT JOIN transactions t ON s.id = t.shop_id AND t.status = 'completed'
    GROUP BY b.id
    ORDER BY b.id ASC
  `;

  const businesses = await query(sql);
  return businesses.map(b => ({
    ...b,
    shops_count: parseInt(b.shops_count, 10) || 0,
    admins_count: parseInt(b.admins_count, 10) || 0,
    sellers_count: parseInt(b.sellers_count, 10) || 0,
    total_revenue: parseFloat(b.total_revenue) || 0
  }));
}

/**
 * Get detailed business record by ID including shops and staff
 */
export async function getBusinessById(businessId) {
  const businesses = await query('SELECT * FROM businesses WHERE id = ? LIMIT 1', [businessId]);
  if (!businesses || businesses.length === 0) {
    const err = new Error('Business not found.');
    err.statusCode = 404;
    throw err;
  }

  const business = businesses[0];

  // Retrieve shops under this business
  const shops = await query(`
    SELECT s.*,
           COUNT(DISTINCT u.id) as staff_count,
           COUNT(DISTINCT p.id) as product_count,
           COALESCE(SUM(p.stock_quantity), 0) as total_units_in_stock
    FROM shops s
    LEFT JOIN users u ON s.id = u.shop_id AND u.is_active = TRUE
    LEFT JOIN products p ON s.id = p.shop_id
    WHERE s.business_id = ?
    GROUP BY s.id
    ORDER BY s.id ASC
  `, [businessId]);

  // Retrieve users belonging to this business
  const users = await query(`
    SELECT u.id, u.username, u.email, u.full_name, u.role, u.shop_id, u.is_active, u.temporary_password,
           s.name as shop_name, s.shop_code
    FROM users u
    LEFT JOIN shops s ON u.shop_id = s.id
    WHERE u.business_id = ?
    ORDER BY u.role ASC, u.id ASC
  `, [businessId]);

  const admins = users.filter(u => u.role === ROLES.ADMIN);
  const sellers = users.filter(u => u.role === ROLES.SELLER);

  return {
    ...business,
    shops,
    admins,
    sellers
  };
}

/**
 * Create a new Business (Super Admin)
 */
export async function createBusiness({ name, business_code, currency_code = 'TZS', currency_symbol = 'TSh', currency_name = 'Tanzanian Shilling' }) {
  if (!name) {
    const err = new Error('Business name is required.');
    err.statusCode = 400;
    throw err;
  }

  let cleanCode = business_code ? business_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
  if (!cleanCode) {
    // Generate unique code if not provided
    const [countRows] = await query('SELECT COUNT(*) as count FROM businesses');
    const nextNum = (countRows[0].count || 0) + 1;
    cleanCode = `BIZ${String(nextNum).padStart(2, '0')}`;
  }

  const existing = await query('SELECT id FROM businesses WHERE business_code = ? LIMIT 1', [cleanCode]);
  if (existing && existing.length > 0) {
    const err = new Error(`Business code '${cleanCode}' is already registered.`);
    err.statusCode = 409;
    throw err;
  }

  const cleanCurrencyCode = (currency_code || 'TZS').trim().toUpperCase();
  const cleanCurrencySymbol = (currency_symbol || 'TSh').trim();
  const cleanCurrencyName = (currency_name || 'Tanzanian Shilling').trim();

  const result = await query(
    `INSERT INTO businesses (business_code, name, currency_code, currency_symbol, currency_name, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [cleanCode, name.trim(), cleanCurrencyCode, cleanCurrencySymbol, cleanCurrencyName, BUSINESS_STATUS.ACTIVE]
  );

  return {
    id: result.insertId,
    business_code: cleanCode,
    name: name.trim(),
    currency_code: cleanCurrencyCode,
    currency_symbol: cleanCurrencySymbol,
    currency_name: cleanCurrencyName,
    status: BUSINESS_STATUS.ACTIVE
  };
}

/**
 * Update Business details (Super Admin or owning Admin)
 */
export async function updateBusiness(businessId, updateData) {
  const { name, currency_code, currency_symbol, currency_name, status } = updateData;

  const businesses = await query('SELECT * FROM businesses WHERE id = ? LIMIT 1', [businessId]);
  if (!businesses || businesses.length === 0) {
    const err = new Error('Business not found.');
    err.statusCode = 404;
    throw err;
  }

  const fields = [];
  const params = [];

  if (name !== undefined) {
    fields.push('name = ?');
    params.push(name.trim());
  }
  if (currency_code !== undefined) {
    fields.push('currency_code = ?');
    params.push(currency_code.trim().toUpperCase());
  }
  if (currency_symbol !== undefined) {
    fields.push('currency_symbol = ?');
    params.push(currency_symbol.trim());
  }
  if (currency_name !== undefined) {
    fields.push('currency_name = ?');
    params.push(currency_name.trim());
  }
  if (status !== undefined) {
    fields.push('status = ?');
    params.push(status);
  }

  if (fields.length > 0) {
    params.push(businessId);
    await query(`UPDATE businesses SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  return await getBusinessById(businessId);
}

/**
 * Get Business Overview dashboard metrics for an Admin's own business
 */
export async function getBusinessOverview(businessId) {
  const businesses = await query('SELECT * FROM businesses WHERE id = ? LIMIT 1', [businessId]);
  if (!businesses || businesses.length === 0) {
    const err = new Error('Business not found.');
    err.statusCode = 404;
    throw err;
  }

  const business = businesses[0];

  // Retrieve shops under this business with metrics
  const shops = await query(`
    SELECT s.*,
           COUNT(DISTINCT u.id) as staff_count,
           COUNT(DISTINCT p.id) as product_count,
           COALESCE(SUM(p.stock_quantity), 0) as total_units_in_stock,
           COALESCE((
             SELECT SUM(t.total_amount) 
             FROM transactions t 
             WHERE t.shop_id = s.id AND t.status = 'completed'
           ), 0) as shop_total_revenue,
           COALESCE((
             SELECT SUM(t.total_amount) 
             FROM transactions t 
             WHERE t.shop_id = s.id AND t.status = 'completed' AND DATE(t.transaction_date) = CURRENT_DATE()
           ), 0) as shop_today_revenue
    FROM shops s
    LEFT JOIN users u ON s.id = u.shop_id AND u.is_active = TRUE
    LEFT JOIN products p ON s.id = p.shop_id
    WHERE s.business_id = ?
    GROUP BY s.id
    ORDER BY s.id ASC
  `, [businessId]);

  // Overall totals across the entire business
  let totalRevenue = 0;
  let todayRevenue = 0;
  let totalStockUnits = 0;
  let totalProducts = 0;
  let totalStaff = 0;

  shops.forEach(s => {
    totalRevenue += parseFloat(s.shop_total_revenue) || 0;
    todayRevenue += parseFloat(s.shop_today_revenue) || 0;
    totalStockUnits += parseInt(s.total_units_in_stock, 10) || 0;
    totalProducts += parseInt(s.product_count, 10) || 0;
    totalStaff += parseInt(s.staff_count, 10) || 0;
  });

  return {
    business,
    summary: {
      shops_count: shops.length,
      staff_count: totalStaff,
      products_count: totalProducts,
      total_units_in_stock: totalStockUnits,
      total_revenue: totalRevenue,
      today_revenue: todayRevenue
    },
    shops
  };
}

export default {
  getAllBusinesses,
  getBusinessById,
  createBusiness,
  updateBusiness,
  getBusinessOverview
};
