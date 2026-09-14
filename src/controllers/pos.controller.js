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
    const checkoutResult = await posService.processCheckout({
      shopId: req.targetShopId,
      sellerId: req.user.id,
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
 * Retrieve transaction history with filtering and summary totals
 */
export async function getTransactionHistory(req, res, next) {
  try {
    const result = await posService.getTransactionHistory({
      shopId: req.targetShopId,
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
  getTransactionHistory,
  getTransactionById
};
