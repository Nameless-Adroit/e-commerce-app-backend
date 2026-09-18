import * as businessService from '../services/business.service.js';

export async function listBusinesses(req, res, next) {
  try {
    const businesses = await businessService.getAllBusinesses();
    res.json({
      success: true,
      data: businesses
    });
  } catch (err) {
    next(err);
  }
}

export async function getBusiness(req, res, next) {
  try {
    const businessId = req.targetBusinessId || req.params.id;
    const business = await businessService.getBusinessById(businessId);
    res.json({
      success: true,
      data: business
    });
  } catch (err) {
    next(err);
  }
}

export async function createBusiness(req, res, next) {
  try {
    const result = await businessService.createBusiness(req.body);
    res.status(201).json({
      success: true,
      message: 'Business created successfully.',
      data: result
    });
  } catch (err) {
    next(err);
  }
}

export async function updateBusiness(req, res, next) {
  try {
    const businessId = req.targetBusinessId || req.params.id;
    const updated = await businessService.updateBusiness(businessId, req.body);
    res.json({
      success: true,
      message: 'Business updated successfully.',
      data: updated
    });
  } catch (err) {
    next(err);
  }
}

export async function getBusinessOverview(req, res, next) {
  try {
    const businessId = req.targetBusinessId || req.params.id;
    const overview = await businessService.getBusinessOverview(businessId);
    res.json({
      success: true,
      data: overview
    });
  } catch (err) {
    next(err);
  }
}

export default {
  listBusinesses,
  getBusiness,
  createBusiness,
  updateBusiness,
  getBusinessOverview
};
