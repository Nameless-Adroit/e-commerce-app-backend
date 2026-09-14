import { query } from '../config/database.js';

/**
 * List all shops with total staff and product counts (Super Admin)
 */
export async function getAllShops(req, res, next) {
  try {
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

    res.status(200).json({
      success: true,
      data: { shops }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a new shop (Super Admin)
 */
export async function createShop(req, res, next) {
  try {
    const { shop_code, name, address, phone } = req.body;

    if (!shop_code || !name) {
      return res.status(400).json({
        success: false,
        message: 'Shop code (e.g. SHP01) and business name are required.'
      });
    }

    const cleanCode = shop_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    const existing = await query('SELECT id FROM shops WHERE shop_code = ? LIMIT 1', [cleanCode]);
    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Shop code '${cleanCode}' is already registered.`
      });
    }

    const result = await query(
      `INSERT INTO shops (shop_code, name, address, phone) VALUES (?, ?, ?, ?)`,
      [cleanCode, name, address || null, phone || null]
    );

    res.status(201).json({
      success: true,
      message: 'Shop created successfully.',
      data: {
        id: result.insertId,
        shop_code: cleanCode,
        name,
        address,
        phone
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get shop details by ID
 */
export async function getShopById(req, res, next) {
  try {
    const { id } = req.params;

    const shops = await query('SELECT * FROM shops WHERE id = ? LIMIT 1', [id]);
    if (!shops || shops.length === 0) {
      return res.status(404).json({ success: false, message: 'Shop not found.' });
    }

    const shop = shops[0];

    // Get assigned staff
    const staff = await query(
      'SELECT id, username, email, full_name, role, is_active FROM users WHERE shop_id = ?',
      [id]
    );

    // Get product stats
    const stats = await query(
      `SELECT COUNT(*) as product_count, 
              COALESCE(SUM(stock_quantity), 0) as total_units,
              COALESCE(SUM(stock_quantity * price), 0) as inventory_retail_value,
              COALESCE(SUM(stock_quantity * cost_price), 0) as inventory_cost_value
       FROM products WHERE shop_id = ?`,
      [id]
    );

    res.status(200).json({
      success: true,
      data: {
        ...shop,
        staff,
        stats: stats[0]
      }
    });
  } catch (err) {
    next(err);
  }
}

export default {
  getAllShops,
  createShop,
  getShopById
};
