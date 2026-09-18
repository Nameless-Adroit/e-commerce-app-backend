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
  getShopById
};
