import { query, executeTransaction } from '../config/database.config.js';
import { generateUniqueProductId } from '../utils/id-generator.util.js';
import { INVENTORY_CHANGE_TYPES } from '../config/constants.js';

/**
 * Generates a unique alphanumeric product ID for a given shop
 */
export async function generateProductId(shopId) {
  let shopCode = '';
  if (shopId) {
    const shops = await query('SELECT shop_code FROM shops WHERE id = ? LIMIT 1', [shopId]);
    if (shops && shops.length > 0) {
      shopCode = shops[0].shop_code;
    }
  }

  const uniqueId = await generateUniqueProductId(shopCode);
  return {
    product_id: uniqueId,
    shop_code: shopCode || null,
    format: 'PRD-[SHOP_CODE]-[TIME_SEQ]-[RANDOM][CHECKSUM]'
  };
}

/**
 * Creates a new product with unique alphanumeric ID and initial inventory log
 */
export async function createProduct({ shopId, currentUser, productData }) {
  if (!shopId) {
    const err = new Error('A valid shop_id is required.');
    err.statusCode = 400;
    throw err;
  }

  let { id, name, description, category, price, cost_price, initial_stock, reorder_level } = productData;

  if (!name || price === undefined) {
    const err = new Error('Product name and price are required.');
    err.statusCode = 400;
    throw err;
  }

  // Retrieve shop code for ID generator
  const shops = await query('SELECT shop_code FROM shops WHERE id = ? LIMIT 1', [shopId]);
  const shopCode = shops && shops.length > 0 ? shops[0].shop_code : 'GEN';

  // If ID was not pre-generated or provided by client, generate guaranteed unique ID
  let productId = id ? id.trim().toUpperCase() : await generateUniqueProductId(shopCode);

  // Verify ID doesn't already exist
  const existing = await query('SELECT id FROM products WHERE id = ? LIMIT 1', [productId]);
  if (existing && existing.length > 0) {
    const err = new Error(`Product ID '${productId}' is already in use. Please generate a new unique ID.`);
    err.statusCode = 409;
    throw err;
  }

  const numericPrice = parseFloat(price);
  const numericCostPrice = parseFloat(cost_price) || 0.00;
  const stockQty = parseInt(initial_stock, 10) || 0;
  const reorderLevel = parseInt(reorder_level, 10) || 5;

  // Use transaction to ensure product creation and initial inventory log occur atomically
  await executeTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO products (id, shop_id, name, description, category, price, cost_price, stock_quantity, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [productId, shopId, name, description || null, category || 'General', numericPrice, numericCostPrice, stockQty, reorderLevel]
    );

    if (stockQty > 0) {
      await conn.execute(
        `INSERT INTO inventory_logs (shop_id, product_id, user_id, change_type, quantity_change, previous_stock, new_stock, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [shopId, productId, currentUser.id, INVENTORY_CHANGE_TYPES.INITIAL, stockQty, 0, stockQty, 'Initial stock entry']
      );
    }
  });

  return {
    id: productId,
    shop_id: shopId,
    name,
    description,
    category: category || 'General',
    price: numericPrice,
    cost_price: numericCostPrice,
    stock_quantity: stockQty,
    reorder_level: reorderLevel
  };
}

/**
 * Modify product pricing, description, and details
 */
export async function updateProduct({ productId, shopId, updateData }) {
  const { name, description, category, price, cost_price, reorder_level } = updateData;

  // Verify product exists and belongs to shop
  let sql = 'SELECT * FROM products WHERE id = ?';
  const params = [productId];
  if (shopId) {
    sql += ' AND shop_id = ?';
    params.push(shopId);
  }
  const products = await query(sql, params);

  if (!products || products.length === 0) {
    const err = new Error('Product not found in this shop.');
    err.statusCode = 404;
    throw err;
  }

  const current = products[0];
  const newName = name !== undefined ? name : current.name;
  const newDesc = description !== undefined ? description : current.description;
  const newCategory = category !== undefined ? category : current.category;
  const newPrice = price !== undefined ? parseFloat(price) : current.price;
  const newCost = cost_price !== undefined ? parseFloat(cost_price) : current.cost_price;
  const newReorder = reorder_level !== undefined ? parseInt(reorder_level, 10) : current.reorder_level;

  await query(
    `UPDATE products 
     SET name = ?, description = ?, category = ?, price = ?, cost_price = ?, reorder_level = ?
     WHERE id = ?`,
    [newName, newDesc, newCategory, newPrice, newCost, newReorder, productId]
  );

  return {
    id: productId,
    name: newName,
    description: newDesc,
    category: newCategory,
    price: newPrice,
    cost_price: newCost,
    reorder_level: newReorder
  };
}

/**
 * Scan / Lookup a product by its unique alphanumeric ID
 */
export async function getProductById({ productId, shopId }) {
  let sql = `
    SELECT p.*, s.name as shop_name, s.shop_code
    FROM products p
    JOIN shops s ON p.shop_id = s.id
    WHERE p.id = ?
  `;
  const params = [productId.trim().toUpperCase()];

  if (shopId) {
    sql += ' AND p.shop_id = ?';
    params.push(shopId);
  }

  const products = await query(sql, params);
  if (!products || products.length === 0) {
    const err = new Error(`No product found with ID '${productId}' in this store.`);
    err.statusCode = 404;
    throw err;
  }

  return products[0];
}

/**
 * List products with pagination, category filter, and search
 */
export async function listProducts({ shopId, filters }) {
  const { search, category, low_stock, limit = 50, offset = 0 } = filters;

  let whereClauses = [];
  let params = [];

  if (shopId) {
    whereClauses.push('p.shop_id = ?');
    params.push(shopId);
  }

  if (category) {
    whereClauses.push('p.category = ?');
    params.push(category);
  }

  if (low_stock === 'true' || low_stock === '1') {
    whereClauses.push('p.stock_quantity <= p.reorder_level');
  }

  if (search) {
    whereClauses.push('(p.id LIKE ? OR p.name LIKE ? OR p.description LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const parsedLimit = parseInt(limit, 10);
  const parsedOffset = parseInt(offset, 10);

  const sql = `
    SELECT p.*, s.name as shop_name, s.shop_code
    FROM products p
    JOIN shops s ON p.shop_id = s.id
    ${whereStr}
    ORDER BY p.updated_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(parsedLimit, parsedOffset);

  const products = await query(sql, params);

  // Count total matching
  const countSql = `SELECT COUNT(*) as total FROM products p ${whereStr}`;
  const countResult = await query(countSql, params.slice(0, -2));
  const total = countResult[0] ? countResult[0].total : products.length;

  return {
    products,
    pagination: {
      total,
      limit: parsedLimit,
      offset: parsedOffset
    }
  };
}

export default {
  generateProductId,
  createProduct,
  updateProduct,
  getProductById,
  listProducts
};
