import * as posService from '../services/pos.service.js';

/**
 * Scan a product ID using camera / manual entry (SRS 3.3)
 */
export async function scanProduct(req, res, next) {
  try {
    const product = await posService.scanProduct({
      productId: req.params.id,
      shopId: req.targetShopId
    });

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Confirm and process POS checkout transaction (SRS 3.3)
 */
export async function checkout(req, res, next) {
  try {
    const targetShopId = req.targetShopId || (req.body && req.body.shop_id);
    if (!targetShopId) {
      const err = new Error('A target shop is required to process checkout.');
      err.statusCode = 400;
      throw err;
    }

    const checkoutResult = await posService.processCheckout({
      shopId: targetShopId,
      sellerId: req.user.id,
      currentUser: req.user,
      checkoutData: req.body
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
 * Process customer return transaction (Prompt Section 5)
 */
export async function processReturn(req, res, next) {
  try {
    const targetShopId = req.targetShopId || (req.body && req.body.shop_id);
    if (!targetShopId) {
      const err = new Error('A target shop is required to process return.');
      err.statusCode = 400;
      throw err;
    }

    const returnResult = await posService.processReturn({
      shopId: targetShopId,
      sellerId: req.user.id,
      currentUser: req.user,
      returnData: req.body
    });

    res.status(201).json({
      success: true,
      message: 'Return transaction processed and inventory updated successfully.',
      data: returnResult
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieve transaction history with filtering and summary totals
 */
export async function getTransactionHistory(req, res, next) {
  try {
    const result = await posService.getTransactionHistory({
      shopId: req.targetShopId,
      businessId: req.user.business_id,
      queryParams: req.query
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
 * Get single transaction details with all line items
 */
export async function getTransactionById(req, res, next) {
  try {
    const transaction = await posService.getTransactionById({
      transactionId: req.params.id,
      shopId: req.targetShopId
    });

    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (err) {
    next(err);
  }
}

export default {
  scanProduct,
  checkout,
  processReturn,
  getTransactionHistory,
  getTransactionById
};
