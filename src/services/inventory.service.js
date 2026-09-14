import { query, executeTransaction } from '../config/database.config.js';
import { INVENTORY_CHANGE_TYPES } from '../config/constants.js';

/**
 * Increment stock count when existing products are restocked or returned (SRS 3.2)
 */
export async function restockProduct({ productId, shopId, userId, quantity, reason, change_type }) {
  const restockQty = parseInt(quantity, 10);
  if (!restockQty || restockQty <= 0) {
    const err = new Error('A valid positive restock quantity is required.');
    err.statusCode = 400;
    throw err;
  }

  const isReturn = change_type === 'return' || (reason && reason.toLowerCase().includes('return'));
  const inventoryChangeType = isReturn ? INVENTORY_CHANGE_TYPES.RETURN : INVENTORY_CHANGE_TYPES.RESTOCK;
  const logReason = reason || (isReturn ? 'Customer product return' : 'Stock replenishment');

  return await executeTransaction(async (conn) => {
    // Lock product row to prevent concurrency races
    let sql = 'SELECT id, shop_id, name, stock_quantity FROM products WHERE id = ?';
    const params = [productId];
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
      [newStock, productId]
    );

    // Log inventory change
    await conn.execute(
      `INSERT INTO inventory_logs (shop_id, product_id, user_id, change_type, quantity_change, previous_stock, new_stock, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [product.shop_id, productId, userId, inventoryChangeType, restockQty, previousStock, newStock, logReason]
    );

    return {
      product_id: productId,
      name: product.name,
      previous_stock: previousStock,
      restocked_quantity: restockQty,
      new_stock: newStock,
      change_type: inventoryChangeType
    };
  });
}

/**
 * Record inventory shrinkage adjustment (loss, damage, theft) (SRS 3.4)
 */
export async function recordShrinkage({ productId, shopId, userId, quantity, reason }) {
  const shrinkageUnits = parseInt(quantity, 10);
  if (!shrinkageUnits || shrinkageUnits <= 0) {
    const err = new Error('A valid positive number of shrinkage units is required.');
    err.statusCode = 400;
    throw err;
  }

  return await executeTransaction(async (conn) => {
    let sql = 'SELECT id, shop_id, name, stock_quantity, cost_price FROM products WHERE id = ?';
    const params = [productId];
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
    await conn.execute('UPDATE products SET stock_quantity = ? WHERE id = ?', [newStock, productId]);

    // Record negative change in inventory_logs
    await conn.execute(
      `INSERT INTO inventory_logs (shop_id, product_id, user_id, change_type, quantity_change, previous_stock, new_stock, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [product.shop_id, productId, userId, INVENTORY_CHANGE_TYPES.SHRINKAGE, -actualDeduction, previousStock, newStock, reason || 'Inventory shrinkage']
    );

    return {
      product_id: productId,
      name: product.name,
      shrinkage_units: actualDeduction,
      shrinkage_cost: (actualDeduction * parseFloat(product.cost_price)).toFixed(2),
      previous_stock: previousStock,
      new_stock: newStock
    };
  });
}

export default {
  restockProduct,
  recordShrinkage
};
