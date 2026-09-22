/**
 * Subscription & Billing Controller
 */
import * as subscriptionService from '../services/subscription.service.js';

export async function listPlans(req, res, next) {
  try {
    const activeOnly = req.query.all !== 'true';
    const plans = await subscriptionService.listPlans({ activeOnly });
    res.status(200).json({
      success: true,
      data: { plans }
    });
  } catch (err) {
    next(err);
  }
}

export async function getPlan(req, res, next) {
  try {
    const plan = await subscriptionService.getPlanById(parseInt(req.params.id, 10));
    res.status(200).json({
      success: true,
      data: plan
    });
  } catch (err) {
    next(err);
  }
}

export async function createPlan(req, res, next) {
  try {
    const plan = await subscriptionService.createPlan({
      ...req.body,
      currentUser: req.user
    });
    res.status(201).json({
      success: true,
      message: 'Subscription plan created successfully.',
      data: plan
    });
  } catch (err) {
    next(err);
  }
}

export async function updatePlan(req, res, next) {
  try {
    const plan = await subscriptionService.updatePlan(parseInt(req.params.id, 10), {
      ...req.body,
      currentUser: req.user
    });
    res.status(200).json({
      success: true,
      message: 'Subscription plan updated successfully.',
      data: plan
    });
  } catch (err) {
    next(err);
  }
}

export async function retirePlan(req, res, next) {
  try {
    const result = await subscriptionService.retirePlan(parseInt(req.params.id, 10), {
      currentUser: req.user
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getMySubscription(req, res, next) {
  try {
    if (!req.user.business_id) {
      return res.status(400).json({
        success: false,
        message: 'Current user is not associated with any business entity.'
      });
    }
    const sub = await subscriptionService.getBusinessSubscription(req.user.business_id);
    res.status(200).json({
      success: true,
      data: sub
    });
  } catch (err) {
    next(err);
  }
}

export async function getBusinessSubscription(req, res, next) {
  try {
    const sub = await subscriptionService.getBusinessSubscription(parseInt(req.params.businessId, 10));
    res.status(200).json({
      success: true,
      data: sub
    });
  } catch (err) {
    next(err);
  }
}

export async function getBusinessHistory(req, res, next) {
  try {
    const history = await subscriptionService.getSubscriptionHistory(parseInt(req.params.businessId, 10));
    res.status(200).json({
      success: true,
      data: { payments: history }
    });
  } catch (err) {
    next(err);
  }
}

export async function listBusinessesBilling(req, res, next) {
  try {
    const list = await subscriptionService.listBusinessesBilling();
    res.status(200).json({
      success: true,
      data: { businesses: list }
    });
  } catch (err) {
    next(err);
  }
}

export async function renewSubscription(req, res, next) {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const sub = await subscriptionService.renewBusinessSubscription({
      businessId,
      ...req.body,
      currentUser: req.user
    });
    res.status(200).json({
      success: true,
      message: 'Subscription successfully renewed and payment recorded.',
      data: sub
    });
  } catch (err) {
    next(err);
  }
}

export async function cancelSubscription(req, res, next) {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const sub = await subscriptionService.cancelBusinessSubscription({
      businessId,
      reason: req.body.reason,
      currentUser: req.user
    });
    res.status(200).json({
      success: true,
      message: 'Business subscription cancelled.',
      data: sub
    });
  } catch (err) {
    next(err);
  }
}

export default {
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  retirePlan,
  getMySubscription,
  getBusinessSubscription,
  getBusinessHistory,
  listBusinessesBilling,
  renewSubscription,
  cancelSubscription
};
