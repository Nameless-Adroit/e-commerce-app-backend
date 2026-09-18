// Application Roles (Strict RBAC)
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  SELLER: 'seller'
};

// Ownership Scopes
export const SCOPES = {
  SYSTEM: 'SYSTEM',
  BUSINESS: 'BUSINESS',
  SHOP: 'SHOP'
};

// Business Statuses
export const BUSINESS_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended'
};

// Transaction Statuses
export const TRANSACTION_STATUS = {
  COMPLETED: 'completed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled'
};

// Payment Methods
export const PAYMENT_METHODS = {
  CASH: 'cash',
  CARD: 'card',
  MOBILE_MONEY: 'mobile_money'
};

// Inventory Change Reasons / Types
export const INVENTORY_CHANGE_TYPES = {
  RESTOCK: 'restock',
  SALE: 'sale',
  SHRINKAGE: 'shrinkage_adjustment',
  RETURN: 'return',
  INITIAL: 'initial'
};

// ID Generation Standards
export const ID_CONFIG = {
  PRODUCT_PREFIX: 'PRD',
  TRANSACTION_PREFIX: 'TXN',
  RETURN_PREFIX: 'RTN',
  BUSINESS_PREFIX: 'BIZ',
  SHOP_PREFIX: 'SHP',
  // Unambiguous Base30 charset (omits 0, O, 1, I, L)
  CHARSET: '23456789ABCDEFGHJKMNPQRSTUVWXYZ',
  ENTROPY_LENGTH: 5
};

export default {
  ROLES,
  SCOPES,
  BUSINESS_STATUS,
  TRANSACTION_STATUS,
  PAYMENT_METHODS,
  INVENTORY_CHANGE_TYPES,
  ID_CONFIG
};
