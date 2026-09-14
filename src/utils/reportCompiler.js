import { query, executeTransaction } from '../config/database.js';

/**
 * Compiles end-of-day sales, revenue, profit, and inventory shrinkage for a specific shop on a given date.
 * 
 * @param {number} shopId 
 * @param {string} dateString - Format 'YYYY-MM-DD'
 * @returns {Promise<Object>} Compiled report record
 */
export async function compileDailyReportForShop(shopId, dateString) {
  const targetDate = dateString || new Date().toISOString().slice(0, 10);

  // 1. Calculate transactions and actual cash revenue collected (net after checkout discounts)
  const txnSql = `
    SELECT 
      COUNT(id) AS total_transactions,
      COALESCE(SUM(total_amount), 0) AS revenue_generated
    FROM transactions
    WHERE shop_id = ? 
      AND status = 'completed'
      AND DATE(transaction_date) = ?
  `;
  const txnResult = await query(txnSql, [shopId, targetDate]);
  const txnData = txnResult[0] || { total_transactions: 0, revenue_generated: 0 };

  // 2. Calculate units sold and wholesale cost of goods sold (COGS)
  const itemsSql = `
    SELECT 
      COALESCE(SUM(ti.quantity), 0) AS total_units_sold,
      COALESCE(SUM(ti.quantity * p.cost_price), 0) AS total_cost
    FROM transactions t
    JOIN transaction_items ti ON t.id = ti.transaction_id
    JOIN products p ON ti.product_id = p.id
    WHERE t.shop_id = ? 
      AND t.status = 'completed'
      AND DATE(t.transaction_date) = ?
  `;
  const itemsResult = await query(itemsSql, [shopId, targetDate]);
  const itemsData = itemsResult[0] || { total_units_sold: 0, total_cost: 0 };

  const revenue = parseFloat(Number(txnData.revenue_generated).toFixed(2)) || 0;
  const cost = parseFloat(Number(itemsData.total_cost).toFixed(2)) || 0;
  const netProfit = parseFloat((revenue - cost).toFixed(2));

  // 2. Calculate inventory shrinkage from inventory_logs
  // Shrinkage adjustment logs record missing or damaged units as negative quantity_change
  const shrinkageSql = `
    SELECT 
      COALESCE(SUM(ABS(il.quantity_change)), 0) AS shrinkage_count,
      COALESCE(SUM(ABS(il.quantity_change) * p.cost_price), 0) AS shrinkage_cost
    FROM inventory_logs il
    JOIN products p ON il.product_id = p.id
    WHERE il.shop_id = ?
      AND il.change_type = 'shrinkage_adjustment'
      AND DATE(il.created_at) = ?
  `;
  const shrinkageResult = await query(shrinkageSql, [shopId, targetDate]);
  const shrinkageData = shrinkageResult[0] || { shrinkage_count: 0, shrinkage_cost: 0 };

  // 3. Upsert into daily_reports table
  const upsertSql = `
    INSERT INTO daily_reports (
      shop_id, report_date, total_transactions, total_units_sold,
      revenue_generated, total_cost, net_profit, shrinkage_count, shrinkage_cost
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      total_transactions = VALUES(total_transactions),
      total_units_sold = VALUES(total_units_sold),
      revenue_generated = VALUES(revenue_generated),
      total_cost = VALUES(total_cost),
      net_profit = VALUES(net_profit),
      shrinkage_count = VALUES(shrinkage_count),
      shrinkage_cost = VALUES(shrinkage_cost),
      compiled_at = CURRENT_TIMESTAMP
  `;

  await query(upsertSql, [
    shopId,
    targetDate,
    txnData.total_transactions,
    itemsData.total_units_sold,
    revenue,
    cost,
    netProfit,
    shrinkageData.shrinkage_count,
    parseFloat(shrinkageData.shrinkage_cost) || 0
  ]);

  return {
    shop_id: shopId,
    report_date: targetDate,
    total_transactions: Number(txnData.total_transactions),
    total_units_sold: Number(itemsData.total_units_sold),
    revenue_generated: revenue,
    total_cost: cost,
    net_profit: netProfit,
    shrinkage_count: Number(shrinkageData.shrinkage_count),
    shrinkage_cost: parseFloat(shrinkageData.shrinkage_cost) || 0
  };
}

/**
 * Compiles daily reports across all active shops.
 * Useful for automated end-of-day cron or manual trigger by Super Admin.
 * 
 * @param {string} [dateString]
 * @returns {Promise<Array>}
 */
export async function compileAllShopsDailyReport(dateString) {
  const targetDate = dateString || new Date().toISOString().slice(0, 10);
  const shops = await query('SELECT id FROM shops WHERE is_active = TRUE');
  
  const results = [];
  for (const shop of shops) {
    const report = await compileDailyReportForShop(shop.id, targetDate);
    results.push(report);
  }
  return results;
}

export default {
  compileDailyReportForShop,
  compileAllShopsDailyReport
};
