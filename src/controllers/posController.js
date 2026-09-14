import { query, executeTransaction } from '../config/database.js';
import { generateTransactionId } from '../utils/idGenerator.js';
import { INVENTORY_CHANGE_TYPES, TRANSACTION_STATUS, PAYMENT_METHODS } from '../config/constants.js';

/**
 * Scan a product ID using camera / manual entry (SRS 3.3)
 * Returns product name, current price, and available stock units.
 */
export async function scanProduct(req, res, next) {
  try {
    const { id } = req.params;
    const shopId = req.targetShopId;

    const cleanId = id.trim().toUpperCase();

    let sql = `
      SELECT id, shop_id, name, category, price, stock_quantity, reorder_level
      FROM products
      WHERE id = ?
    `;
    const params = [cleanId];

    if (shopId) {
      sql += ' AND shop_id = ?';
      params.push(shopId);
    }

    const products = await query(sql, params);

    if (!products || products.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Product with ID '${cleanId}' not found in this store.`
      });
    }

    const product = products[0];

    res.status(200).json({
      success: true,
      data: {
        id: product.id,
        name: product.name,
        category: product.category,
        price: parseFloat(product.price),
        stock_quantity: product.stock_quantity,
        is_in_stock: product.stock_quantity > 0,
        low_stock_warning: product.stock_quantity <= product.reorder_level
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Confirm and process POS checkout transaction (SRS 3.3)
 * Executes atomic ACID transaction with row-level locks and automatic inventory deduction.
 */
export async function checkout(req, res, next) {
  try {
    const shopId = req.targetShopId;
    const sellerId = req.user.id;
    const { items, payment_method = PAYMENT_METHODS.CASH, notes } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart must contain at least one item.'
      });
    }

    // Retrieve shop code for generating unique transaction ID
    const shops = await query('SELECT shop_code FROM shops WHERE id = ? LIMIT 1', [shopId]);
    const shopCode = shops && shops.length > 0 ? shops[0].shop_code : 'SHP';

    const transactionId = generateTransactionId(shopCode);

    // Run ACID transaction
    const checkoutResult = await executeTransaction(async (conn) => {
      let totalAmount = 0;
      const verifiedLineItems = [];

      for (const item of items) {
        const productId = item.productId ? item.productId.trim().toUpperCase() : null;
        const requestedQty = parseInt(item.quantity, 10);

        if (!productId || !requestedQty || requestedQty <= 0) {
          const err = new Error(`Invalid item entry: Product ID and positive quantity are required.`);
          err.statusCode = 400;
          throw err;
        }

        // Lock row to prevent race conditions
        const [products] = await conn.execute(
          `SELECT id, name, price, cost_price, stock_quantity 
           FROM products 
           WHERE id = ? AND shop_id = ? 
           FOR UPDATE`,
          [productId, shopId]
        );

        if (!products || products.length === 0) {
          const err = new Error(`Product '${productId}' not found in this shop.`);
          err.statusCode = 404;
          throw err;
        }

        const product = products[0];

        // Verify stock sufficiency
        if (product.stock_quantity < requestedQty) {
          const err = new Error(
            `Insufficient stock for '${product.name}' (ID: ${product.id}). Available: ${product.stock_quantity}, requested: ${requestedQty}`
          );
          err.statusCode = 400;
          throw err;
        }

        const unitPrice = parseFloat(product.price);
        const subtotal = unitPrice * requestedQty;
        totalAmount += subtotal;

        verifiedLineItems.push({
          productId: product.id,
          name: product.name,
          requestedQty,
          unitPrice,
          subtotal,
          previousStock: product.stock_quantity,
          newStock: product.stock_quantity - requestedQty
        });
      }

      // 1. Insert master transaction record
      await conn.execute(
        `INSERT INTO transactions (id, shop_id, seller_id, total_amount, payment_method, status, notes, transaction_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          transactionId,
          shopId,
          sellerId,
          totalAmount,
          payment_method,
          TRANSACTION_STATUS.COMPLETED,
          notes || null
        ]
      );

      // 2. Insert line items, deduct inventory, and create audit logs
      for (const item of verifiedLineItems) {
        // Insert transaction item
        await conn.execute(
          `INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, subtotal)
           VALUES (?, ?, ?, ?, ?)`,
          [transactionId, item.productId, item.requestedQty, item.unitPrice, item.subtotal]
        );

        // Deduct inventory
        await conn.execute(
          `UPDATE products SET stock_quantity = ? WHERE id = ?`,
          [item.newStock, item.productId]
        );

        // Insert inventory log entry (type: 'sale')
        await conn.execute(
          `INSERT INTO inventory_logs (shop_id, product_id, user_id, change_type, quantity_change, previous_stock, new_stock, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shopId,
            item.productId,
            sellerId,
            INVENTORY_CHANGE_TYPES.SALE,
            -item.requestedQty,
            item.previousStock,
            item.newStock,
            `POS Sale: Transaction #${transactionId}`
          ]
        );
      }

      return {
        transaction_id: transactionId,
        shop_id: shopId,
        seller_id: sellerId,
        total_amount: totalAmount,
        payment_method,
        status: TRANSACTION_STATUS.COMPLETED,
        items_count: verifiedLineItems.length,
        items: verifiedLineItems.map(i => ({
          product_id: i.productId,
          name: i.name,
          product_name: i.name,
          quantity: i.requestedQty,
          unit_price: i.unitPrice,
          subtotal: i.subtotal,
          remaining_stock: i.newStock
        }))
      };
    });

    res.status(201).json({
      success: true,
      message: 'Transaction completed and inventory deducted successfully.',
      data: checkoutResult
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get transaction history for current shop / seller
 */
export async function getTransactionHistory(req, res, next) {
  try {
    const shopId = req.targetShopId;
    const { limit = 20, offset = 0, start_date, end_date } = req.query;

    let whereClauses = [];
    let params = [];

    if (shopId) {
      whereClauses.push('t.shop_id = ?');
      params.push(shopId);
    }

    if (start_date) {
      whereClauses.push('DATE(t.transaction_date) >= ?');
      params.push(start_date);
    }

    if (end_date) {
      whereClauses.push('DATE(t.transaction_date) <= ?');
      params.push(end_date);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT t.*, u.full_name as seller_name, s.name as shop_name,
             COUNT(ti.id) as item_count
      FROM transactions t
      JOIN users u ON t.seller_id = u.id
      JOIN shops s ON t.shop_id = s.id
      LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
      ${whereStr}
      GROUP BY t.id
      ORDER BY t.transaction_date DESC
      LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const transactions = await query(sql, params);

    res.status(200).json({
      success: true,
      data: {
        transactions
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get single transaction details with all line items
 */
export async function getTransactionById(req, res, next) {
  try {
    const { id } = req.params;
    const shopId = req.targetShopId;

    let sql = `
      SELECT t.*, u.full_name as seller_name, s.name as shop_name, s.shop_code
      FROM transactions t
      JOIN users u ON t.seller_id = u.id
      JOIN shops s ON t.shop_id = s.id
      WHERE t.id = ?
    `;
    const params = [id];

    if (shopId) {
      sql += ' AND t.shop_id = ?';
      params.push(shopId);
    }

    const transactions = await query(sql, params);

    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    const transaction = transactions[0];

    const items = await query(
      `SELECT ti.*, p.name, p.name as product_name, p.category
       FROM transaction_items ti
       JOIN products p ON ti.product_id = p.id
       WHERE ti.transaction_id = ?`,
      [id]
    );

    res.status(200).json({
      success: true,
      data: {
        ...transaction,
        items
      }
    });
  } catch (err) {
    next(err);
  }
}

export default {
  scanProduct,
  checkout,
  getTransactionHistory,
  getTransactionById
};
