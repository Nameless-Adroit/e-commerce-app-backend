import { query } from '../config/database.config.js';
import { compileDailyReportForShop, compileAllShopsDailyReport } from '../utils/report-compiler.util.js';
import { ROLES } from '../config/constants.js';

/**
 * Get daily report detailing total units sold, revenue, profit, and shrinkage (SRS 3.4)
 */
export async function getDailyReport({ shopId, userRole, date, autoCompile = 'true' }) {
  const targetDate = date || new Date().toISOString().slice(0, 10);

  // Shop-scoped report (Admin or targeted Super Admin)
  if (shopId) {
    if (autoCompile === 'true') {
      await compileDailyReportForShop(shopId, targetDate);
    }

    const reports = await query(
      `SELECT dr.*, s.name as shop_name, s.shop_code
       FROM daily_reports dr
       JOIN shops s ON dr.shop_id = s.id
       WHERE dr.shop_id = ? AND dr.report_date = ?`,
      [shopId, targetDate]
    );

    if (!reports || reports.length === 0) {
      return {
        shop_id: shopId,
        report_date: targetDate,
        total_transactions: 0,
        total_units_sold: 0,
        revenue_generated: 0.00,
        total_cost: 0.00,
        net_profit: 0.00,
        shrinkage_count: 0,
        shrinkage_cost: 0.00,
        compiled_at: new Date()
      };
    }

    return reports[0];
  }

  // Cross-shop global overview for Super Admin
  if (userRole === ROLES.SUPER_ADMIN) {
    if (autoCompile === 'true') {
      await compileAllShopsDailyReport(targetDate);
    }

    const reports = await query(
      `SELECT dr.*, s.name as shop_name, s.shop_code
       FROM daily_reports dr
       JOIN shops s ON dr.shop_id = s.id
       WHERE dr.report_date = ?
       ORDER BY dr.revenue_generated DESC`,
      [targetDate]
    );

    const summarySql = `
      SELECT 
        COUNT(DISTINCT shop_id) as reporting_shops,
        COALESCE(SUM(total_transactions), 0) as total_transactions,
        COALESCE(SUM(total_units_sold), 0) as total_units_sold,
        COALESCE(SUM(revenue_generated), 0) as total_revenue,
        COALESCE(SUM(total_cost), 0) as total_cost,
        COALESCE(SUM(net_profit), 0) as total_net_profit,
        COALESCE(SUM(shrinkage_count), 0) as total_shrinkage_count,
        COALESCE(SUM(shrinkage_cost), 0) as total_shrinkage_cost
      FROM daily_reports
      WHERE report_date = ?
    `;
    const summaryResult = await query(summarySql, [targetDate]);

    return {
      report_date: targetDate,
      global_summary: summaryResult[0],
      shop_breakdown: reports
    };
  }

  const err = new Error('Unauthorized access.');
  err.statusCode = 403;
  throw err;
}

/**
 * Triggers compilation of daily close data (SRS 3.4)
 */
export async function triggerDailyClose({ shopId, userRole, date }) {
  const targetDate = date || new Date().toISOString().slice(0, 10);

  if (shopId) {
    return await compileDailyReportForShop(shopId, targetDate);
  } else if (userRole === ROLES.SUPER_ADMIN) {
    return await compileAllShopsDailyReport(targetDate);
  } else {
    const err = new Error('Shop ID required.');
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Historical analytics report over a date range
 */
export async function getReportRange({ shopId, startDate, endDate }) {
  if (!startDate || !endDate) {
    const err = new Error('Both start_date and end_date (YYYY-MM-DD) are required.');
    err.statusCode = 400;
    throw err;
  }

  let sql = `
    SELECT dr.*, s.name as shop_name, s.shop_code
    FROM daily_reports dr
    JOIN shops s ON dr.shop_id = s.id
    WHERE dr.report_date BETWEEN ? AND ?
  `;
  const params = [startDate, endDate];

  if (shopId) {
    sql += ' AND dr.shop_id = ?';
    params.push(shopId);
  }

  sql += ' ORDER BY dr.report_date ASC';

  const records = await query(sql, params);

  return {
    start_date: startDate,
    end_date: endDate,
    records
  };
}

/**
 * Retrieve top-selling products by quantity and revenue (SRS 3.4 / POS Seller Insights)
 */
export async function getTopSellingProducts({ shopId, limit = 5 }) {
  const parsedLimit = parseInt(limit, 10) || 5;

  let sql = `
    SELECT 
      ti.product_id,
      p.name,
      p.category,
      p.price,
      p.stock_quantity,
      s.name AS shop_name,
      COALESCE(SUM(ti.quantity), 0) AS total_units_sold,
      COALESCE(SUM(ti.subtotal), 0) AS total_revenue
    FROM transaction_items ti
    JOIN products p ON ti.product_id = p.id
    JOIN transactions t ON ti.transaction_id = t.id
    JOIN shops s ON p.shop_id = s.id
    WHERE t.status = 'completed'
  `;
  const params = [];

  if (shopId) {
    sql += ' AND t.shop_id = ?';
    params.push(shopId);
  }

  sql += `
    GROUP BY ti.product_id, p.name, p.category, p.price, p.stock_quantity, s.name
    ORDER BY total_units_sold DESC, total_revenue DESC
    LIMIT ?
  `;
  params.push(parsedLimit);

  const topProducts = await query(sql, params);

  return {
    shop_id: shopId || null,
    top_products: topProducts.map((p) => ({
      product_id: p.product_id,
      name: p.name,
      category: p.category,
      price: parseFloat(p.price),
      stock_quantity: parseInt(p.stock_quantity, 10),
      shop_name: p.shop_name,
      total_units_sold: parseInt(p.total_units_sold, 10),
      total_revenue: parseFloat(p.total_revenue)
    }))
  };
}

/**
 * Get daily reconciliation summary for POS Seller to cross-check sales before closing
 */
export async function getDailyReconciliation({ shopId, date }) {
  const targetDate = date || new Date().toISOString().slice(0, 10);

  let sql = `
    SELECT 
      COUNT(t.id) as total_transactions,
      COALESCE(SUM(t.total_amount), 0) as total_sales,
      COALESCE(SUM(t.subtotal_amount), 0) as total_gross,
      COALESCE(SUM(t.discount_amount), 0) as total_discounts,
      COALESCE(SUM(CASE WHEN t.payment_method = 'cash' THEN t.total_amount ELSE 0 END), 0) as cash_total,
      COALESCE(SUM(CASE WHEN t.payment_method = 'card' THEN t.total_amount ELSE 0 END), 0) as card_total,
      COALESCE(SUM(CASE WHEN t.payment_method = 'mobile_money' THEN t.total_amount ELSE 0 END), 0) as mobile_money_total,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END), 0) as completed_count,
      COALESCE(SUM(CASE WHEN t.status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count,
      COALESCE(SUM(CASE WHEN t.status = 'refunded' THEN 1 ELSE 0 END), 0) as refunded_count
    FROM transactions t
    WHERE DATE(t.transaction_date) = ?
  `;
  const params = [targetDate];

  if (shopId) {
    sql += ' AND t.shop_id = ?';
    params.push(shopId);
  }

  const result = await query(sql, params);
  const row = result[0] || {};

  // Total items sold
  let itemsSql = `
    SELECT COALESCE(SUM(ti.quantity), 0) as total_units_sold
    FROM transactions t
    JOIN transaction_items ti ON t.id = ti.transaction_id
    WHERE t.status = 'completed' AND DATE(t.transaction_date) = ?
  `;
  const itemParams = [targetDate];
  if (shopId) {
    itemsSql += ' AND t.shop_id = ?';
    itemParams.push(shopId);
  }
  const itemsResult = await query(itemsSql, itemParams);
  const totalUnits = itemsResult[0] ? parseInt(itemsResult[0].total_units_sold, 10) : 0;

  // Check if daily close has already been compiled for this date
  let closeCheckSql = `SELECT id, compiled_at FROM daily_reports WHERE report_date = ?`;
  const closeParams = [targetDate];
  if (shopId) {
    closeCheckSql += ' AND shop_id = ?';
    closeParams.push(shopId);
  }
  const closeCheck = await query(closeCheckSql, closeParams);
  const isClosed = closeCheck && closeCheck.length > 0;

  // Retrieve shop and business currency configuration
  let shopCurrency = { currency_code: 'TZS', currency_symbol: 'TSh' };
  if (shopId) {
    const shopRow = await query(`
      SELECT s.currency_code, s.currency_symbol, b.currency_code as biz_currency_code, b.currency_symbol as biz_currency_symbol 
      FROM shops s
      LEFT JOIN businesses b ON s.business_id = b.id
      WHERE s.id = ? LIMIT 1
    `, [shopId]);
    if (shopRow && shopRow.length > 0) {
      shopCurrency = {
        currency_code: shopRow[0].biz_currency_code || shopRow[0].currency_code || 'TZS',
        currency_symbol: shopRow[0].biz_currency_symbol || shopRow[0].currency_symbol || 'TSh'
      };
    }
  }

  // Retrieve today's completed transactions for line-by-line audit cross-check
  let txnListSql = `
    SELECT 
      t.id,
      t.total_amount,
      t.payment_method,
      t.transaction_date,
      COALESCE((SELECT SUM(quantity) FROM transaction_items WHERE transaction_id = t.id), 0) as items_count
    FROM transactions t
    WHERE DATE(t.transaction_date) = ? AND t.status = 'completed'
  `;
  const txnListParams = [targetDate];
  if (shopId) {
    txnListSql += ' AND t.shop_id = ?';
    txnListParams.push(shopId);
  }
  txnListSql += ' ORDER BY t.transaction_date DESC';

  const txns = await query(txnListSql, txnListParams);
  const formattedTxns = (txns || []).map(t => {
    const d = new Date(t.transaction_date);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return {
      id: t.id,
      total_amount: parseFloat(Number(t.total_amount).toFixed(2)),
      payment_method: t.payment_method,
      time: `${hours}:${mins}`,
      items_count: parseInt(t.items_count, 10) || 0
    };
  });

  const txnCount = parseInt(row.total_transactions, 10) || 0;

  return {
    shop_id: shopId || null,
    date: targetDate,
    reconcile_date: targetDate,
    is_closed: isClosed,
    closed_at: isClosed ? closeCheck[0].compiled_at : null,
    total_transactions: txnCount,
    transactions_count: txnCount,
    total_units_sold: totalUnits,
    total_items_sold: totalUnits,
    total_sales: parseFloat(Number(row.total_sales).toFixed(2)),
    total_gross: parseFloat(Number(row.total_gross).toFixed(2)),
    total_discounts: parseFloat(Number(row.total_discounts).toFixed(2)),
    currency_code: shopCurrency.currency_code || 'TZS',
    currency_symbol: shopCurrency.currency_symbol || 'TSh',
    payment_breakdown: {
      cash: parseFloat(Number(row.cash_total).toFixed(2)),
      card: parseFloat(Number(row.card_total).toFixed(2)),
      mobile_money: parseFloat(Number(row.mobile_money_total).toFixed(2))
    },
    status_counts: {
      completed: parseInt(row.completed_count, 10) || 0,
      cancelled: parseInt(row.cancelled_count, 10) || 0,
      refunded: parseInt(row.refunded_count, 10) || 0
    },
    transactions: formattedTxns
  };
}

/**
 * Get aggregated products sold report for Shop Admin (tabular format)
 */
export async function getProductsSoldReport({ shopId, startDate, endDate, category, search }) {
  let whereClauses = ["t.status = 'completed'"];
  let params = [];

  if (shopId) {
    whereClauses.push('t.shop_id = ?');
    params.push(shopId);
  }

  if (startDate) {
    whereClauses.push('DATE(t.transaction_date) >= ?');
    params.push(startDate);
  }

  if (endDate) {
    whereClauses.push('DATE(t.transaction_date) <= ?');
    params.push(endDate);
  }

  if (category) {
    whereClauses.push('p.category = ?');
    params.push(category);
  }

  if (search) {
    whereClauses.push('(p.name LIKE ? OR p.id LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sql = `
    SELECT 
      p.id AS product_id,
      p.name,
      p.category,
      p.price AS catalog_price,
      p.stock_quantity AS current_stock,
      s.name AS shop_name,
      s.currency_code,
      s.currency_symbol,
      COALESCE(SUM(ti.quantity), 0) AS total_quantity_sold,
      COALESCE(SUM(ti.subtotal), 0) AS total_revenue,
      CASE 
        WHEN SUM(ti.quantity) > 0 THEN ROUND(SUM(ti.subtotal) / SUM(ti.quantity), 2)
        ELSE p.price 
      END AS average_selling_price
    FROM transaction_items ti
    JOIN transactions t ON ti.transaction_id = t.id
    JOIN products p ON ti.product_id = p.id
    JOIN shops s ON p.shop_id = s.id
    ${whereStr}
    GROUP BY p.id, p.name, p.category, p.price, p.stock_quantity, s.name, s.currency_code, s.currency_symbol
    ORDER BY total_quantity_sold DESC, total_revenue DESC
  `;

  const rows = await query(sql, params);

  const totalUnits = rows.reduce((sum, r) => sum + parseInt(r.total_quantity_sold, 10), 0);
  const totalRevenue = rows.reduce((sum, r) => sum + parseFloat(r.total_revenue), 0);

  return {
    shop_id: shopId || null,
    start_date: startDate || null,
    end_date: endDate || null,
    summary: {
      distinct_products_sold: rows.length,
      total_units_sold: totalUnits,
      total_revenue: parseFloat(totalRevenue.toFixed(2))
    },
    products: rows.map(r => ({
      product_id: r.product_id,
      name: r.name,
      category: r.category,
      catalog_price: parseFloat(r.catalog_price),
      current_stock: parseInt(r.current_stock, 10),
      shop_name: r.shop_name,
      currency_code: r.currency_code || 'TZS',
      currency_symbol: r.currency_symbol || 'TSh',
      total_quantity_sold: parseInt(r.total_quantity_sold, 10),
      total_revenue: parseFloat(r.total_revenue),
      average_selling_price: parseFloat(r.average_selling_price)
    }))
  };
}

export default {
  getDailyReport,
  triggerDailyClose,
  getReportRange,
  getTopSellingProducts,
  getDailyReconciliation,
  getProductsSoldReport
};
