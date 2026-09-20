import * as shopService from '../services/shop.service.js';

/**
 * List all shops with total staff and product counts (Super Admin / Admin / Seller)
 */
export async function getAllShops(req, res, next) {
  try {
    const shops = await shopService.getAllShops({
      currentUser: req.user,
      businessId: req.query.business_id
    });
    res.status(200).json({
      success: true,
      data: { shops }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a new shop (Super Admin or Admin for own business)
 */
export async function createShop(req, res, next) {
  try {
    const newShop = await shopService.createShop({
      currentUser: req.user,
      shopData: req.body
    });
    res.status(201).json({
      success: true,
      message: 'Shop created successfully.',
      data: newShop
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Submit a shop creation request (Admin)
 */
export async function submitShopRequest(req, res, next) {
  try {
    const request = await shopService.submitShopRequest({
      currentUser: req.user,
      requestData: req.body
    });
    res.status(201).json({
      success: true,
      message: 'Store creation request submitted successfully. Awaiting Super Admin review.',
      data: request
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List shop requests
 */
export async function getShopRequests(req, res, next) {
  try {
    const requests = await shopService.getShopRequests({
      currentUser: req.user,
      status: req.query.status
    });
    res.status(200).json({
      success: true,
      data: { requests }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Approve shop request (Super Admin)
 */
export async function approveShopRequest(req, res, next) {
  try {
    const result = await shopService.approveShopRequest({
      currentUser: req.user,
      requestId: parseInt(req.params.id, 10),
      superAdminNotes: req.body.super_admin_notes
    });
    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Reject shop request (Super Admin)
 */
export async function rejectShopRequest(req, res, next) {
  try {
    const result = await shopService.rejectShopRequest({
      currentUser: req.user,
      requestId: parseInt(req.params.id, 10),
      superAdminNotes: req.body.super_admin_notes
    });
    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get shop details by ID
 */
export async function getShopById(req, res, next) {
  try {
    const shopDetails = await shopService.getShopById(req.params.id, req.user);
    res.status(200).json({
      success: true,
      data: shopDetails
    });
  } catch (err) {
    next(err);
  }
}

export default {
  getAllShops,
  createShop,
  submitShopRequest,
  getShopRequests,
  approveShopRequest,
  rejectShopRequest,
  getShopById
};

