import { query } from '../config/database.js';
import { compileDailyReportForShop, compileAllShopsDailyReport } from '../utils/reportCompiler.js';
import { ROLES } from '../config/constants.js';

/**
 * Get daily report detailing total units sold, revenue generated, and inventory shrinkage (SRS 3.4)
 * Accessible to Admins and Super Admins.
 */
export async function getDailyReport(req, res, next) {
  try {
    const shopId = req.targetShopId;
    const { date, auto_compile = 'true' } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);

    // If shopId is specified (or enforced for Admin)
    if (shopId) {
      // If auto_compile is requested, compile live stats first
      if (auto_compile === 'true') {
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
        return res.status(200).json({
          success: true,
          data: {
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
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: reports[0]
      });
    }

    // Super Admin requesting cross-shop overview for the day
    if (req.user.role === ROLES.SUPER_ADMIN) {
      if (auto_compile === 'true') {
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

      // Aggregate totals across all shops
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

      return res.status(200).json({
        success: true,
        data: {
          report_date: targetDate,
          global_summary: summaryResult[0],
          shop_breakdown: reports
        }
      });
    }

    return res.status(403).json({ success: false, message: 'Unauthorized access.' });
  } catch (err) {
    next(err);
  }
}

/**
 * Triggers compilation of daily close data (SRS 3.4)
 * Can be invoked by Cron jobs or Admins at close of business day.
 */
export async function triggerDailyClose(req, res, next) {
  try {
    const shopId = req.targetShopId;
    const { date } = req.body;
    const targetDate = date || new Date().toISOString().slice(0, 10);

    let result;
    if (shopId) {
      result = await compileDailyReportForShop(shopId, targetDate);
    } else if (req.user.role === ROLES.SUPER_ADMIN) {
      result = await compileAllShopsDailyReport(targetDate);
    } else {
      return res.status(400).json({ success: false, message: 'Shop ID required.' });
    }

    res.status(200).json({
      success: true,
      message: `Daily close report compiled successfully for date: ${targetDate}`,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Historical analytics report over a date range
 */
export async function getReportRange(req, res, next) {
  try {
    const shopId = req.targetShopId;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'Both start_date and end_date (YYYY-MM-DD) are required.'
      });
    }

    let sql = `
      SELECT dr.*, s.name as shop_name, s.shop_code
      FROM daily_reports dr
      JOIN shops s ON dr.shop_id = s.id
      WHERE dr.report_date BETWEEN ? AND ?
    `;
    const params = [start_date, end_date];

    if (shopId) {
      sql += ' AND dr.shop_id = ?';
      params.push(shopId);
    }

    sql += ' ORDER BY dr.report_date ASC';

    const records = await query(sql, params);

    res.status(200).json({
      success: true,
      data: {
        start_date,
        end_date,
        records
      }
    });
  } catch (err) {
    next(err);
  }
}

export default {
  getDailyReport,
  triggerDailyClose,
  getReportRange
};
