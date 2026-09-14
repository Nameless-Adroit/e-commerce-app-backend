import * as shopService from '../services/shop.service.js';

/**
 * List all shops with total staff and product counts (Super Admin)
 */
export async function getAllShops(req, res, next) {
  try {
    const shops = await shopService.getAllShops();
    res.status(200).json({
      success: true,
      data: { shops }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a new shop (Super Admin)
 */
export async function createShop(req, res, next) {
  try {
    const newShop = await shopService.createShop(req.body);
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
    const shopDetails = await shopService.getShopById(req.params.id);
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
