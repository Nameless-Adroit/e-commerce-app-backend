-- =============================================================================
-- Multi-Tier E-Commerce & POS Mobile Application
-- Database Schema Definition (schema.sql)
-- DBMS: MySQL 8.x / MariaDB
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `pos_ecommerce_db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `pos_ecommerce_db`;

-- Disable foreign key checks during drop/recreate
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `daily_reports`;
DROP TABLE IF EXISTS `inventory_logs`;
DROP TABLE IF EXISTS `transaction_items`;
DROP TABLE IF EXISTS `transactions`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `shops`;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- 1. SHOPS TABLE (Multi-Tenant Shop/Business Support)
-- -----------------------------------------------------------------------------
CREATE TABLE `shops` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `shop_code` VARCHAR(20) NOT NULL UNIQUE COMMENT 'Unique identifier prefix (e.g. SHP01)',
  `name` VARCHAR(150) NOT NULL COMMENT 'Business or Shop Display Name',
  `address` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. USERS TABLE (Strict RBAC: Super Admin, Admin, Seller)
-- -----------------------------------------------------------------------------
CREATE TABLE `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `email` VARCHAR(100) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('super_admin', 'admin', 'seller') NOT NULL,
  `shop_id` INT NULL COMMENT 'NULL for super_admin; References assigned shop for admin/seller',
  `full_name` VARCHAR(100) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_users_shop` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE SET NULL,
  INDEX `idx_users_role` (`role`),
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
  `notes` VARCHAR(255) NULL,
  `transaction_date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_transactions_shop` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_transactions_seller` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`),
  INDEX `idx_transactions_shop` (`shop_id`),
  INDEX `idx_transactions_seller` (`seller_id`),
  INDEX `idx_transactions_date` (`transaction_date`)
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
