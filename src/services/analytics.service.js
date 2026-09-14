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

export default {
  getDailyReport,
  triggerDailyClose,
  getReportRange,
  getTopSellingProducts
};
