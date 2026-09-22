-- =============================================================================
-- Multi-Tier E-Commerce & POS Mobile Application
-- Database Schema Definition (schema.sql)
-- DBMS: MySQL 8.x / MariaDB
-- =============================================================================
-- Note: When importing via DirectAdmin phpMyAdmin, first select your database
-- (e.g. `jmsoluti_pos_ecommerce`) on the left, then import this file.
-- CREATE DATABASE IF NOT EXISTS `pos_ecommerce_db`
--   CHARACTER SET utf8mb4
--   COLLATE utf8mb4_unicode_ci;
-- USE `pos_ecommerce_db`;

-- Disable foreign key checks during drop/recreate
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `daily_reports`;
DROP TABLE IF EXISTS `inventory_logs`;
DROP TABLE IF EXISTS `transaction_items`;
DROP TABLE IF EXISTS `transactions`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `audit_logs`;
DROP TABLE IF EXISTS `security_logs`;
DROP TABLE IF EXISTS `sessions`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `subscription_plans`;
DROP TABLE IF EXISTS `shops`;
DROP TABLE IF EXISTS `businesses`;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- 0. SUBSCRIPTION_PLANS TABLE (Platform Tier Definitions)
-- -----------------------------------------------------------------------------
CREATE TABLE `subscription_plans` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `plan_code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `price` DECIMAL(12, 2) NOT NULL,
  `billing_cycle` ENUM('monthly', 'yearly') NOT NULL DEFAULT 'monthly',
  `max_shops` INT NOT NULL DEFAULT 1,
  `max_sellers` INT NULL COMMENT 'NULL indicates unlimited sellers',
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_plans_active` (`is_active`),
  INDEX `idx_plans_code` (`plan_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 1. BUSINESSES TABLE (Platform Enterprise Tenants)
-- -----------------------------------------------------------------------------
CREATE TABLE `businesses` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `business_code` VARCHAR(20) NOT NULL UNIQUE COMMENT 'Unique identifier prefix (e.g. BIZ01)',
  `name` VARCHAR(150) NOT NULL COMMENT 'Business Display Name',
  `currency_code` VARCHAR(10) NOT NULL DEFAULT 'TZS' COMMENT 'Base currency ISO code (e.g. TZS, USD, KES)',
  `currency_symbol` VARCHAR(10) NOT NULL DEFAULT 'TSh' COMMENT 'Currency display symbol (e.g. TSh, $, KSh)',
  `currency_name` VARCHAR(50) NOT NULL DEFAULT 'Tanzanian Shilling' COMMENT 'Full currency name',
  `status` ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  `subscription_plan_id` INT NULL,
  `subscription_status` ENUM('draft', 'payment_pending', 'payment_received', 'pending_review', 'trial', 'active', 'expired', 'cancelled', 'declined') NOT NULL DEFAULT 'active',
  `subscription_start_date` DATETIME NULL,
  `subscription_end_date` DATETIME NULL,
  `owner_user_id` INT NULL,
  `terms_accepted_version` VARCHAR(20) NULL,
  `terms_accepted_at` DATETIME NULL,
  `registration_notes` TEXT NULL,
  `rejection_reason` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_businesses_plan` FOREIGN KEY (`subscription_plan_id`) REFERENCES `subscription_plans` (`id`) ON DELETE SET NULL,
  INDEX `idx_businesses_status` (`status`),
  INDEX `idx_businesses_sub_status` (`subscription_status`),
  INDEX `idx_businesses_sub_end` (`subscription_end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. SHOPS TABLE (Multi-Tenant Shops under Businesses)
-- -----------------------------------------------------------------------------
CREATE TABLE `shops` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `business_id` INT NOT NULL COMMENT 'Parent Business entity',
  `shop_code` VARCHAR(20) NOT NULL UNIQUE COMMENT 'Unique identifier prefix (e.g. SHP01)',
  `name` VARCHAR(150) NOT NULL COMMENT 'Shop Display Name',
  `address` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `currency_code` VARCHAR(10) NOT NULL DEFAULT 'TZS' COMMENT 'Base currency ISO code (e.g. TZS, USD, KES)',
  `currency_symbol` VARCHAR(10) NOT NULL DEFAULT 'TSh' COMMENT 'Currency display prefix (e.g. TSh, $, KSh)',
  `currency_name` VARCHAR(50) NOT NULL DEFAULT 'Tanzanian Shilling' COMMENT 'Full currency name',
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_shops_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  INDEX `idx_shops_business` (`business_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. USERS TABLE (Strict RBAC: Super Admin, Admin, Seller)
-- -----------------------------------------------------------------------------
CREATE TABLE `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `email` VARCHAR(100) NOT NULL UNIQUE,
  `phone_number` VARCHAR(20) NULL UNIQUE COMMENT 'Normalized E.164 phone (+255XXXXXXXXX) for login',
  `pin_hash` VARCHAR(255) NOT NULL COMMENT 'Bcrypt hash of 6-digit staff/admin PIN',
  `profile_image` VARCHAR(500) NULL COMMENT 'URL or asset path of profile image',
  `temporary_pin` BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Flags if user must change PIN on first login',
  `failed_login_attempts` INT NOT NULL DEFAULT 0 COMMENT 'Counter for brute-force mitigation',
  `locked_until` DATETIME NULL COMMENT 'Lockout expiration timestamp',
  `role` ENUM('super_admin', 'admin', 'seller') NOT NULL,
  `business_id` INT NULL COMMENT 'NULL for super_admin; Owned business for admin; Assigned business for seller',
  `shop_id` INT NULL COMMENT 'NULL for super_admin and admin; Assigned branch shop for seller',
  `full_name` VARCHAR(100) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_users_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_users_shop` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE SET NULL,
  INDEX `idx_users_role` (`role`),
  INDEX `idx_users_phone` (`phone_number`),
  INDEX `idx_users_business` (`business_id`),
  INDEX `idx_users_shop` (`shop_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. PRODUCTS TABLE (Direct Alphanumeric Generated ID Identification)
-- -----------------------------------------------------------------------------
CREATE TABLE `products` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT 'Unique Alphanumeric Product ID (e.g. PRD-SHP01-X7K9-2026)',
  `shop_id` INT NOT NULL COMMENT 'Shop to which this product belongs',
  `name` VARCHAR(150) NOT NULL,
  `description` TEXT NULL,
  `category` VARCHAR(100) NOT NULL DEFAULT 'General',
  `price` DECIMAL(10, 2) NOT NULL COMMENT 'Selling price to customer',
  `cost_price` DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Wholesale / acquisition cost for profit & shrinkage calculation',
  `stock_quantity` INT NOT NULL DEFAULT 0 COMMENT 'Real-time available inventory',
  `reorder_level` INT NOT NULL DEFAULT 5 COMMENT 'Threshold for low-stock warnings',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_products_shop` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  INDEX `idx_products_shop` (`shop_id`),
  INDEX `idx_products_category` (`category`),
  INDEX `idx_products_stock` (`stock_quantity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. TRANSACTIONS TABLE (POS Checkout Records)
-- -----------------------------------------------------------------------------
CREATE TABLE `transactions` (
  `id` VARCHAR(50) PRIMARY KEY COMMENT 'Unique Transaction Code (e.g. TXN-SHP01-20260913-9F3K)',
  `shop_id` INT NOT NULL,
  `seller_id` INT NOT NULL,
  `subtotal_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `discount_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(10, 2) NOT NULL,
  `payment_method` ENUM('cash', 'card', 'mobile_money') NOT NULL DEFAULT 'cash',
  `status` ENUM('completed', 'refunded', 'cancelled') NOT NULL DEFAULT 'completed',
  `original_transaction_id` VARCHAR(50) NULL COMMENT 'References parent sale if this is a customer return transaction',
  `notes` VARCHAR(255) NULL,
  `transaction_date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_transactions_shop` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_transactions_seller` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`),
  INDEX `idx_transactions_shop` (`shop_id`),
  INDEX `idx_transactions_seller` (`seller_id`),
  INDEX `idx_transactions_date` (`transaction_date`),
  INDEX `idx_transactions_original` (`original_transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. TRANSACTION_ITEMS TABLE (POS Checkout Line Items)
-- -----------------------------------------------------------------------------
CREATE TABLE `transaction_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `transaction_id` VARCHAR(50) NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `quantity` INT NOT NULL,
  `unit_price` DECIMAL(10, 2) NOT NULL,
  `subtotal` DECIMAL(10, 2) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_items_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  INDEX `idx_items_transaction` (`transaction_id`),
  INDEX `idx_items_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. INVENTORY_LOGS TABLE (Restocks, POS Sales, Shrinkage Adjustments)
-- -----------------------------------------------------------------------------
CREATE TABLE `inventory_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `shop_id` INT NOT NULL,
  `product_id` VARCHAR(50) NOT NULL,
  `user_id` INT NOT NULL,
  `change_type` ENUM('restock', 'sale', 'shrinkage_adjustment', 'return', 'initial') NOT NULL,
  `quantity_change` INT NOT NULL COMMENT 'Negative for sales/shrinkage; positive for restock/returns',
  `previous_stock` INT NOT NULL,
  `new_stock` INT NOT NULL,
  `reason` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_logs_shop` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_logs_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  INDEX `idx_logs_shop` (`shop_id`),
  INDEX `idx_logs_product` (`product_id`),
  INDEX `idx_logs_change_type` (`change_type`),
  INDEX `idx_logs_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. DAILY_REPORTS TABLE (End-of-Day Aggregated Analytics & Shrinkage)
-- -----------------------------------------------------------------------------
CREATE TABLE `daily_reports` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `shop_id` INT NOT NULL,
  `report_date` DATE NOT NULL,
  `total_transactions` INT NOT NULL DEFAULT 0,
  `total_units_sold` INT NOT NULL DEFAULT 0,
  `revenue_generated` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `total_cost` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `net_profit` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `shrinkage_count` INT NOT NULL DEFAULT 0 COMMENT 'Number of units lost/damaged/unaccounted',
  `shrinkage_cost` DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Monetary value of lost/shrinkage units',
  `compiled_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_reports_shop` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_shop_report_date` (`shop_id`, `report_date`),
  INDEX `idx_reports_shop` (`shop_id`),
  INDEX `idx_reports_date` (`report_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. SESSIONS TABLE (Server-Side Authenticated Device Sessions)
-- -----------------------------------------------------------------------------
CREATE TABLE `sessions` (
  `id` VARCHAR(64) PRIMARY KEY COMMENT 'Unique cryptographic Session ID',
  `user_id` INT NOT NULL,
  `token_family_id` VARCHAR(64) NOT NULL COMMENT 'Tracks refresh token rotation family for reuse detection',
  `refresh_token_hash` VARCHAR(128) NOT NULL COMMENT 'SHA-256 hash of active refresh token',
  `device_name` VARCHAR(150) NULL,
  `device_id` VARCHAR(150) NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `is_revoked` BOOLEAN NOT NULL DEFAULT FALSE,
  `revoke_reason` VARCHAR(100) NULL,
  `expires_at` DATETIME NOT NULL,
  `last_used_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_sessions_user` (`user_id`),
  INDEX `idx_sessions_family` (`token_family_id`),
  INDEX `idx_sessions_token_hash` (`refresh_token_hash`),
  INDEX `idx_sessions_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. SECURITY_LOGS TABLE (Security Events, Brute-Force & Session Anomalies)
-- -----------------------------------------------------------------------------
CREATE TABLE `security_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `event_type` VARCHAR(50) NOT NULL COMMENT 'e.g. LOGIN_SUCCESS, LOGIN_FAILED, AUTH_LOCKOUT, TOKEN_REFRESH_REUSE',
  `user_id` INT NULL,
  `identifier` VARCHAR(100) NULL COMMENT 'Sanitized phone/username, NEVER passwords or tokens',
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `details` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sec_logs_event` (`event_type`),
  INDEX `idx_sec_logs_user` (`user_id`),
  INDEX `idx_sec_logs_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 10. AUDIT_LOGS TABLE (Business Operations & User Identity Changes)
-- -----------------------------------------------------------------------------
CREATE TABLE `audit_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `action` VARCHAR(100) NOT NULL COMMENT 'e.g. USER_CREATED, USER_UPDATED, PRICE_CHANGED, BUSINESS_CLOSED',
  `target_resource` VARCHAR(100) NOT NULL,
  `target_id` VARCHAR(50) NULL,
  `shop_id` INT NULL,
  `business_id` INT NULL,
  `changes` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_audit_user` (`user_id`),
  INDEX `idx_audit_action` (`action`),
  INDEX `idx_audit_shop` (`shop_id`),
  INDEX `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 11. SHOP_REQUESTS TABLE (Branch Store Creation Requests & Super Admin Approvals)
-- -----------------------------------------------------------------------------
CREATE TABLE `shop_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `business_id` INT NOT NULL,
  `requested_by_user_id` INT NOT NULL,
  `shop_code` VARCHAR(20) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `address` VARCHAR(255) NULL,
  `phone` VARCHAR(20) NULL,
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `admin_notes` TEXT NULL,
  `super_admin_notes` TEXT NULL,
  `reviewed_by_user_id` INT NULL,
  `created_shop_id` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` DATETIME NULL,
  CONSTRAINT `fk_shop_req_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_shop_req_user` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_shop_req_status` (`status`),
  INDEX `idx_shop_req_business` (`business_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 12. SUBSCRIPTION_PAYMENTS TABLE (Manual Cash/Bank/M-Pesa Payment Ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE `subscription_payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `business_id` INT NOT NULL,
  `plan_id` INT NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `payment_method` ENUM('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER') NOT NULL DEFAULT 'CASH',
  `payment_reference` VARCHAR(100) NULL,
  `period_start` DATETIME NOT NULL,
  `period_end` DATETIME NOT NULL,
  `recorded_by_user_id` INT NOT NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_sub_payments_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sub_payments_plan` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans` (`id`),
  CONSTRAINT `fk_sub_payments_recorded_by` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`),
  INDEX `idx_sub_pay_business` (`business_id`),
  INDEX `idx_sub_pay_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 13. PLATFORM_SETTINGS TABLE (Database-Driven Platform & Contact Configuration)
-- -----------------------------------------------------------------------------
CREATE TABLE `platform_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `platform_name` VARCHAR(150) NOT NULL DEFAULT 'JM Solution POS',
  `support_name` VARCHAR(150) NOT NULL DEFAULT 'JM Solution Technical Team',
  `support_phone` VARCHAR(50) NOT NULL DEFAULT '+255 754 000 000',
  `support_whatsapp` VARCHAR(50) NOT NULL DEFAULT '+255 754 000 000',
  `support_email` VARCHAR(100) NOT NULL DEFAULT 'support@jmsolutions.co.tz',
  `support_address` VARCHAR(255) NOT NULL DEFAULT 'Dar es Salaam, Tanzania',
  `terms_version` VARCHAR(20) NOT NULL DEFAULT 'v1.0',
  `terms_content` TEXT NOT NULL,
  `privacy_policy_version` VARCHAR(20) NOT NULL DEFAULT 'v1.0',
  `privacy_policy_content` TEXT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 14. PAYMENT_METHODS TABLE (Configurable Manual Payment Instructions)
-- -----------------------------------------------------------------------------
CREATE TABLE `payment_methods` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `type` ENUM('MOBILE_MONEY', 'BANK_TRANSFER', 'CASH', 'OTHER') NOT NULL,
  `account_name` VARCHAR(150) NOT NULL,
  `account_number` VARCHAR(100) NOT NULL,
  `instructions` TEXT NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_paymethods_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 15. BUSINESS_TERMS_ACCEPTANCE TABLE (Legal Auditing of Accepted Terms)
-- -----------------------------------------------------------------------------
CREATE TABLE `business_terms_acceptance` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `business_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `terms_version` VARCHAR(20) NOT NULL,
  `accepted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_terms_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_terms_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_terms_business` (`business_id`),
  INDEX `idx_terms_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
