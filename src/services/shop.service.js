import { query } from '../config/database.config.js';

/**
 * List all shops with total staff and product counts (Super Admin)
 */
export async function getAllShops() {
  const sql = `
    SELECT s.*,
      COUNT(DISTINCT u.id) as staff_count,
      COUNT(DISTINCT p.id) as product_count,
      COALESCE(SUM(p.stock_quantity), 0) as total_units_in_stock
    FROM shops s
    LEFT JOIN users u ON s.id = u.shop_id AND u.is_active = TRUE
    LEFT JOIN products p ON s.id = p.shop_id
    GROUP BY s.id
    ORDER BY s.id ASC
  `;
  const shops = await query(sql);
  return shops;
}

/**
 * Create a new shop (Super Admin)
 */
export async function createShop({ shop_code, name, address, phone, currency_code = 'TZS', currency_symbol = 'TSh', currency_name = 'Tanzanian Shilling' }) {
  if (!shop_code || !name) {
    const err = new Error('Shop code (e.g. SHP01) and business name are required.');
    err.statusCode = 400;
    throw err;
  }

  const cleanCode = shop_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  const existing = await query('SELECT id FROM shops WHERE shop_code = ? LIMIT 1', [cleanCode]);
  if (existing && existing.length > 0) {
    const err = new Error(`Shop code '${cleanCode}' is already registered.`);
    err.statusCode = 409;
    throw err;
  }

  const cleanCurrencyCode = (currency_code || 'TZS').trim().toUpperCase();
  const cleanCurrencySymbol = (currency_symbol || 'TSh').trim();
  const cleanCurrencyName = (currency_name || 'Tanzanian Shilling').trim();

  const result = await query(
    `INSERT INTO shops (shop_code, name, address, phone, currency_code, currency_symbol, currency_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [cleanCode, name, address || null, phone || null, cleanCurrencyCode, cleanCurrencySymbol, cleanCurrencyName]
  );

  return {
    id: result.insertId,
    shop_code: cleanCode,
    name,
    address,
    phone,
    currency_code: cleanCurrencyCode,
    currency_symbol: cleanCurrencySymbol,
    currency_name: cleanCurrencyName
  };
}

/**
 * Get shop details by ID including assigned staff and inventory summary
 */
export async function getShopById(shopId) {
  const shops = await query('SELECT * FROM shops WHERE id = ? LIMIT 1', [shopId]);
  if (!shops || shops.length === 0) {
    const err = new Error('Shop not found.');
    err.statusCode = 404;
    throw err;
  }

  const shop = shops[0];

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
