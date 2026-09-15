import { query, executeTransaction } from '../config/database.config.js';
import { generateTransactionId } from '../utils/id-generator.util.js';
import { INVENTORY_CHANGE_TYPES, TRANSACTION_STATUS, PAYMENT_METHODS } from '../config/constants.js';

/**
 * Scan a product ID using camera / manual entry (SRS 3.3)
 */
export async function scanProduct({ productId, shopId }) {
  const cleanId = productId.trim().toUpperCase();

  let sql = `
    SELECT id, shop_id, name, description, category, price, stock_quantity, reorder_level
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
    const err = new Error(`Product with ID '${cleanId}' not found in this store.`);
    err.statusCode = 404;
    throw err;
  }

  const product = products[0];

  return {
    id: product.id,
    name: product.name,
    description: product.description || '',
    category: product.category,
    price: parseFloat(product.price),
    stock_quantity: product.stock_quantity,
    is_in_stock: product.stock_quantity > 0,
    low_stock_warning: product.stock_quantity <= product.reorder_level
  };
}

/**
 * Confirm and process POS checkout transaction (SRS 3.3)
 * Executes atomic ACID transaction with row-level locks and automatic inventory deduction.
 */
export async function processCheckout({ shopId, sellerId: directSellerId, currentUser, checkoutData }) {
  const sellerId = directSellerId || (currentUser ? currentUser.id : null);
  const paymentMethodVal = checkoutData.payment_method || checkoutData.paymentMethod || PAYMENT_METHODS.CASH;
  const payment_method = String(paymentMethodVal).toUpperCase();
  const { items, notes, discount = 0 } = checkoutData;

  if (!items || !Array.isArray(items) || items.length === 0) {
    const err = new Error('Cart must contain at least one item.');
    err.statusCode = 400;
    throw err;
  }

  // Retrieve shop code for generating unique transaction ID
  const shops = await query('SELECT shop_code FROM shops WHERE id = ? LIMIT 1', [shopId]);
  const shopCode = shops && shops.length > 0 ? shops[0].shop_code : 'SHP';

  const transactionId = generateTransactionId(shopCode);

  // Run ACID transaction
  return await executeTransaction(async (conn) => {
    let totalSubtotal = 0;
    const verifiedLineItems = [];

    for (const item of items) {
      const productId = item.productId ? item.productId.trim().toUpperCase() : null;
      const requestedQty = parseInt(item.quantity, 10);

      if (!productId || !requestedQty || requestedQty <= 0) {
        const err = new Error('Invalid item entry: Product ID and positive quantity are required.');
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

      // Authoritatively determine selling unit price: allow seller override if supplied, otherwise use catalog price
      let unitPrice = parseFloat(product.price);
      const customPriceInput = item.unitPrice !== undefined ? item.unitPrice : item.unit_price;
      if (customPriceInput !== undefined && customPriceInput !== null && String(customPriceInput).trim() !== '') {
        const parsedCustomPrice = parseFloat(customPriceInput);
        if (isNaN(parsedCustomPrice) || !isFinite(parsedCustomPrice) || parsedCustomPrice < 0) {
          const err = new Error(`Invalid price '${customPriceInput}' for '${product.name}'. Price must be a valid non-negative number.`);
          err.statusCode = 400;
          throw err;
        }
        unitPrice = parseFloat(parsedCustomPrice.toFixed(2));
      }

      const subtotal = parseFloat((unitPrice * requestedQty).toFixed(2));
      totalSubtotal += subtotal;

      verifiedLineItems.push({
        productId: product.id,
        name: product.name,
        catalogPrice: parseFloat(product.price),
        requestedQty,
        unitPrice,
        subtotal,
        previousStock: product.stock_quantity,
        newStock: product.stock_quantity - requestedQty
      });
    }

    // Compute discount and final net total
    const parsedDiscount = Math.max(0, parseFloat(discount) || 0);
    const discountAmount = Math.min(totalSubtotal, parseFloat(parsedDiscount.toFixed(2)));
    const totalAmount = Math.max(0, parseFloat((totalSubtotal - discountAmount).toFixed(2)));

    // 1. Insert master transaction record
    await conn.execute(
      `INSERT INTO transactions (id, shop_id, seller_id, subtotal_amount, discount_amount, total_amount, payment_method, status, notes, transaction_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        transactionId,
        shopId,
        sellerId,
        totalSubtotal,
        discountAmount,
        totalAmount,
        payment_method,
        TRANSACTION_STATUS.COMPLETED,
        notes || null
      ]
    );

    // 2. Insert line items, deduct inventory, and create audit logs
    for (const item of verifiedLineItems) {
      await conn.execute(
        `INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [transactionId, item.productId, item.requestedQty, item.unitPrice, item.subtotal]
      );

      await conn.execute(
        `UPDATE products SET stock_quantity = ? WHERE id = ?`,
        [item.newStock, item.productId]
      );

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
      subtotal_amount: totalSubtotal,
      discount_amount: discountAmount,
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
}

/**
 * Query transaction history with filter parameters and summary aggregation
 */
export async function getTransactionHistory({ shopId, queryParams }) {
  const { limit = 50, offset = 0, date, start_date, end_date, seller_id, status } = queryParams;

  let whereClauses = [];
  let params = [];

  if (shopId) {
    whereClauses.push('t.shop_id = ?');
    params.push(shopId);
  }

  if (date) {
    whereClauses.push('DATE(t.transaction_date) = ?');
    params.push(date.trim());
  } else {
    if (start_date) {
      whereClauses.push('DATE(t.transaction_date) >= ?');
      params.push(start_date.trim());
    }

    if (end_date) {
      whereClauses.push('DATE(t.transaction_date) <= ?');
      params.push(end_date.trim());
    }
  }

  if (seller_id) {
    whereClauses.push('t.seller_id = ?');
    params.push(seller_id);
  }

  if (status) {
    whereClauses.push('t.status = ?');
    params.push(status);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Calculate aggregate totals for the filtered set
  const summarySql = `
    SELECT 
      COUNT(DISTINCT t.id) as total_transactions,
      COALESCE(SUM(t.total_amount), 0) as total_revenue,
      COALESCE(SUM(t.discount_amount), 0) as total_discount,
      COALESCE(SUM(t.subtotal_amount), 0) as total_subtotal
    FROM transactions t
    ${whereStr}
  `;
  const summaryRows = await query(summarySql, [...params]);

  const parsedLimit = parseInt(limit, 10);
  const parsedOffset = parseInt(offset, 10);

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
  params.push(parsedLimit, parsedOffset);

  const transactions = await query(sql, params);

  const summary = summaryRows && summaryRows.length > 0 ? {
    total_transactions: parseInt(summaryRows[0].total_transactions, 10) || 0,
    total_revenue: parseFloat(summaryRows[0].total_revenue) || 0,
    total_discount: parseFloat(summaryRows[0].total_discount) || 0,
    total_subtotal: parseFloat(summaryRows[0].total_subtotal) || 0
  } : {
    total_transactions: 0,
    total_revenue: 0,
    total_discount: 0,
    total_subtotal: 0
  };

  return {
    transactions,
    summary
  };
}

/**
 * Get single transaction details with all line items
 */
export async function getTransactionById({ transactionId, shopId }) {
  let sql = `
    SELECT t.*, u.full_name as seller_name, s.name as shop_name, s.shop_code
    FROM transactions t
    JOIN users u ON t.seller_id = u.id
    JOIN shops s ON t.shop_id = s.id
    WHERE t.id = ?
  `;
  const params = [transactionId];

  if (shopId) {
    sql += ' AND t.shop_id = ?';
    params.push(shopId);
  }

  const transactions = await query(sql, params);

  if (!transactions || transactions.length === 0) {
    const err = new Error('Transaction not found.');
    err.statusCode = 404;
    throw err;
  }

  const transaction = transactions[0];

  const items = await query(
    `SELECT ti.*, p.name, p.name as product_name, p.category
     FROM transaction_items ti
     JOIN products p ON ti.product_id = p.id
     WHERE ti.transaction_id = ?`,
    [transactionId]
  );

  return {
    ...transaction,
    items
  };
}

export default {
  scanProduct,
  processCheckout,
  getTransactionHistory,
  getTransactionById
};
