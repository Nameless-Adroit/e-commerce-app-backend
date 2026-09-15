import * as productService from '../services/product.service.js';
import * as inventoryService from '../services/inventory.service.js';

/**
 * Generates a unique alphanumeric product ID (SRS 3.2)
 */
export async function generateId(req, res, next) {
  try {
    const data = await productService.generateProductId(req.targetShopId);
    res.status(200).json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Creates a new product with unique alphanumeric ID (Admin module)
 */
export async function createProduct(req, res, next) {
  try {
    const newProduct = await productService.createProduct({
      shopId: req.targetShopId,
      currentUser: req.user,
      productData: req.body
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully with unique ID.',
      data: newProduct
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Modify product pricing, description, and details (SRS 3.2)
 */
export async function updateProduct(req, res, next) {
  try {
    const updated = await productService.updateProduct({
      productId: req.params.id,
      shopId: req.targetShopId,
      updateData: req.body
    });

    res.status(200).json({
      success: true,
      message: 'Product details updated successfully.',
      data: updated
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Increment stock count when existing products are restocked (SRS 3.2)
 */
export async function restockProduct(req, res, next) {
  try {
    const result = await inventoryService.restockProduct({
      productId: req.params.id,
      shopId: req.targetShopId,
      userId: req.user.id,
      quantity: req.body.quantity,
      reason: req.body.reason,
      change_type: req.body.change_type
    });

    res.status(200).json({
      success: true,
      message: 'Product stock incremented successfully.',
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Record inventory shrinkage adjustment (loss, damage, theft) (SRS 3.4)
 */
export async function recordShrinkage(req, res, next) {
  try {
    const result = await inventoryService.recordShrinkage({
      productId: req.params.id,
      shopId: req.targetShopId,
      userId: req.user.id,
      quantity: req.body.quantity,
      reason: req.body.reason
    });

    res.status(200).json({
      success: true,
      message: 'Inventory shrinkage recorded successfully.',
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Scan / Lookup a product by its unique alphanumeric ID
 */
export async function getProductById(req, res, next) {
  try {
    const product = await productService.getProductById({
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
 * List products with pagination, category filter, and search
 */
export async function listProducts(req, res, next) {
  try {
    const result = await productService.listProducts({
      shopId: req.targetShopId,
      filters: req.query
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
 * Generate a printable PDF containing a sheet of QR code labels for a product
 */
export async function generateQRLabels(req, res, next) {
  try {
    const { doc, product } = await productService.generateProductQRLabelsPDF({
      productId: req.params.id,
      shopId: req.targetShopId,
      count: req.query.count || 15
    });

    const filename = `labels-${product.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    doc.pipe(res);
  } catch (err) {
    next(err);
  }
}

export default {
  generateId,
  createProduct,
  updateProduct,
  restockProduct,
  recordShrinkage,
  getProductById,
  listProducts,
  generateQRLabels
};

