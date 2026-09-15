import * as analyticsService from '../services/analytics.service.js';

/**
 * Get daily report detailing total units sold, revenue generated, and inventory shrinkage (SRS 3.4)
 */
export async function getDailyReport(req, res, next) {
  try {
    const report = await analyticsService.getDailyReport({
      shopId: req.targetShopId,
      userRole: req.user.role,
      date: req.query.date,
      autoCompile: req.query.auto_compile
    });

    res.status(200).json({
      success: true,
      data: report
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Triggers compilation of daily close data (SRS 3.4)
 */
export async function triggerDailyClose(req, res, next) {
  try {
    const result = await analyticsService.triggerDailyClose({
      shopId: req.targetShopId,
      userRole: req.user.role,
      date: req.body.date
    });

    const targetDate = req.body.date || new Date().toISOString().slice(0, 10);

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
    const result = await analyticsService.getReportRange({
      shopId: req.targetShopId,
      startDate: req.query.start_date,
      endDate: req.query.end_date
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieve top-selling products by quantity and revenue (SRS 3.4)
 */
export async function getTopSellingProducts(req, res, next) {
  try {
    const result = await analyticsService.getTopSellingProducts({
      shopId: req.targetShopId,
      limit: req.query.limit
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get daily reconciliation summary for POS Seller (breakdown by payment method and transactions)
 */
export async function getDailyReconciliation(req, res, next) {
  try {
    const result = await analyticsService.getDailyReconciliation({
      shopId: req.targetShopId,
      date: req.query.date
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Tabular report of products sold with aggregated units, revenue, and average selling price
 */
export async function getProductsSoldReport(req, res, next) {
  try {
    const result = await analyticsService.getProductsSoldReport({
      shopId: req.targetShopId,
      startDate: req.query.start_date,
      endDate: req.query.end_date,
      category: req.query.category,
      search: req.query.search
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

export default {
  getDailyReport,
  triggerDailyClose,
  getReportRange,
  getTopSellingProducts,
  getDailyReconciliation,
  getProductsSoldReport
};

