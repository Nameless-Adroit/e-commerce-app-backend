import { query, executeTransaction } from '../config/database.js';
import { generateUniqueProductId, verifyIdChecksum } from '../utils/idGenerator.js';
import { INVENTORY_CHANGE_TYPES, ROLES } from '../config/constants.js';

/**
 * Generates a unique alphanumeric product ID (SRS 3.2)
 * Used directly for product identification and scanning.
 */
export async function generateId(req, res, next) {
  try {
    const shopId = req.targetShopId;

    let shopCode = '';
    if (shopId) {
      const shops = await query('SELECT shop_code FROM shops WHERE id = ? LIMIT 1', [shopId]);
      if (shops && shops.length > 0) {
        shopCode = shops[0].shop_code;
      }
    }

    const uniqueId = await generateUniqueProductId(shopCode);

    res.status(200).json({
      success: true,
      data: {
        product_id: uniqueId,
        shop_code: shopCode || null,
        format: 'PRD-[SHOP_CODE]-[TIME_SEQ]-[RANDOM][CHECKSUM]'
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Creates a new product with unique alphanumeric ID (Admin module)
 */
export async function createProduct(req, res, next) {
  try {
    const shopId = req.targetShopId;
    if (!shopId) {
      return res.status(400).json({ success: false, message: 'A valid shop_id is required.' });
    }

    let { id, name, description, category, price, cost_price, initial_stock, reorder_level } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Product name and price are required.'
      });
    }

    // Retrieve shop code for ID generator
    const shops = await query('SELECT shop_code FROM shops WHERE id = ? LIMIT 1', [shopId]);
    const shopCode = shops && shops.length > 0 ? shops[0].shop_code : 'GEN';

    // If ID was not pre-generated or provided by client, generate guaranteed unique ID
    let productId = id ? id.trim().toUpperCase() : await generateUniqueProductId(shopCode);

    // Verify ID doesn't already exist
    const existing = await query('SELECT id FROM products WHERE id = ? LIMIT 1', [productId]);
    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Product ID '${productId}' is already in use. Please generate a new unique ID.`
      });
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
          [shopId, productId, req.user.id, INVENTORY_CHANGE_TYPES.INITIAL, stockQty, 0, stockQty, 'Initial stock entry']
        );
      }
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully with unique ID.',
      data: {
        id: productId,
        shop_id: shopId,
        name,
        description,
        category: category || 'General',
        price: numericPrice,
        cost_price: numericCostPrice,
        stock_quantity: stockQty,
        reorder_level: reorderLevel
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Modify product pricing, description, and details (SRS 3.2)
 */
export async function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    const shopId = req.targetShopId;
    const { name, description, category, price, cost_price, reorder_level } = req.body;

    // Verify product exists and belongs to shop
    let sql = 'SELECT * FROM products WHERE id = ?';
    const params = [id];
    if (shopId) {
      sql += ' AND shop_id = ?';
      params.push(shopId);
    }
    const products = await query(sql, params);

    if (!products || products.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found in this shop.' });
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
      [newName, newDesc, newCategory, newPrice, newCost, newReorder, id]
    );

    res.status(200).json({
      success: true,
      message: 'Product details updated successfully.',
      data: {
        id,
        name: newName,
        description: newDesc,
        category: newCategory,
        price: newPrice,
        cost_price: newCost,
        reorder_level: newReorder
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Increment stock count when existing products are restocked (SRS 3.2)
 */
export async function restockProduct(req, res, next) {
  try {
    const { id } = req.params;
    const shopId = req.targetShopId;
    const { quantity, reason } = req.body;

    const restockQty = parseInt(quantity, 10);
    if (!restockQty || restockQty <= 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid positive restock quantity is required.'
      });
    }

    const result = await executeTransaction(async (conn) => {
      // Lock product row
      let sql = 'SELECT id, shop_id, name, stock_quantity FROM products WHERE id = ?';
      const params = [id];
      if (shopId) {
        sql += ' AND shop_id = ?';
        params.push(shopId);
      }
      sql += ' FOR UPDATE';

      const [products] = await conn.execute(sql, params);
      if (!products || products.length === 0) {
        const err = new Error('Product not found in this shop.');
        err.statusCode = 404;
        throw err;
      }

      const product = products[0];
      const previousStock = product.stock_quantity;
      const newStock = previousStock + restockQty;

      // Update product stock
      await conn.execute(
        'UPDATE products SET stock_quantity = ? WHERE id = ?',
        [newStock, id]
      );

      // Log inventory change
      await conn.execute(
        `INSERT INTO inventory_logs (shop_id, product_id, user_id, change_type, quantity_change, previous_stock, new_stock, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [product.shop_id, id, req.user.id, INVENTORY_CHANGE_TYPES.RESTOCK, restockQty, previousStock, newStock, reason || 'Stock replenishment']
      );

      return {
        product_id: id,
        name: product.name,
        previous_stock: previousStock,
        restocked_quantity: restockQty,
        new_stock: newStock
      };
    });

    res.status(200).json({
      success: true,
      message: 'Product stock incremented successfully.',
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Record inventory shrinkage adjustment (loss, damage, theft) (SRS 3.4)
 */
export async function recordShrinkage(req, res, next) {
  try {
    const { id } = req.params;
    const shopId = req.targetShopId;
    const { quantity, reason } = req.body;

    const shrinkageUnits = parseInt(quantity, 10);
    if (!shrinkageUnits || shrinkageUnits <= 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid positive number of shrinkage units is required.'
      });
    }

    const result = await executeTransaction(async (conn) => {
      let sql = 'SELECT id, shop_id, name, stock_quantity, cost_price FROM products WHERE id = ?';
      const params = [id];
      if (shopId) {
        sql += ' AND shop_id = ?';
        params.push(shopId);
      }
      sql += ' FOR UPDATE';

      const [products] = await conn.execute(sql, params);
      if (!products || products.length === 0) {
        const err = new Error('Product not found in this shop.');
        err.statusCode = 404;
        throw err;
      }

      const product = products[0];
      const previousStock = product.stock_quantity;
      const newStock = Math.max(0, previousStock - shrinkageUnits);
      const actualDeduction = previousStock - newStock;

      // Update product stock
      await conn.execute('UPDATE products SET stock_quantity = ? WHERE id = ?', [newStock, id]);

      // Record negative change in inventory_logs
      await conn.execute(
        `INSERT INTO inventory_logs (shop_id, product_id, user_id, change_type, quantity_change, previous_stock, new_stock, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [product.shop_id, id, req.user.id, INVENTORY_CHANGE_TYPES.SHRINKAGE, -actualDeduction, previousStock, newStock, reason || 'Inventory shrinkage']
      );

      return {
        product_id: id,
        name: product.name,
        shrinkage_units: actualDeduction,
        shrinkage_cost: (actualDeduction * parseFloat(product.cost_price)).toFixed(2),
        previous_stock: previousStock,
        new_stock: newStock
      };
    });

    res.status(200).json({
      success: true,
      message: 'Inventory shrinkage recorded successfully.',
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Scan / Lookup a product by its unique alphanumeric ID
 * Used by Sellers during checkout and Admins during inventory audits.
 */
export async function getProductById(req, res, next) {
  try {
    const { id } = req.params;
    const shopId = req.targetShopId;

    let sql = `
      SELECT p.*, s.name as shop_name, s.shop_code
      FROM products p
      JOIN shops s ON p.shop_id = s.id
      WHERE p.id = ?
    `;
    const params = [id.trim().toUpperCase()];

    if (shopId) {
      sql += ' AND p.shop_id = ?';
      params.push(shopId);
    }

    const products = await query(sql, params);
    if (!products || products.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No product found with ID '${id}' in this store.`
      });
    }

    res.status(200).json({
      success: true,
      data: products[0]
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List products with pagination, category filter, and search
 */
export async function listProducts(req, res, next) {
  try {
    const shopId = req.targetShopId;
    const { search, category, low_stock, limit = 50, offset = 0 } = req.query;

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

    const sql = `
      SELECT p.*, s.name as shop_name, s.shop_code
      FROM products p
      JOIN shops s ON p.shop_id = s.id
      ${whereStr}
      ORDER BY p.updated_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const products = await query(sql, params);

    // Count total matching
    const countSql = `SELECT COUNT(*) as total FROM products p ${whereStr}`;
    const countResult = await query(countSql, params.slice(0, -2));
    const total = countResult[0] ? countResult[0].total : products.length;

    res.status(200).json({
      success: true,
      data: {
        products,
        pagination: {
          total,
          limit: parseInt(limit, 10),
          offset: parseInt(offset, 10)
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

export default {
  generateId,
  createProduct,
  updateProduct,
  restockProduct,
  recordShrinkage,
  getProductById,
  listProducts
};
