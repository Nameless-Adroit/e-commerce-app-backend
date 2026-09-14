-- =============================================================================
-- Multi-Tier E-Commerce & POS Mobile Application
-- Realistic Seed Data (seed.sql)
-- DBMS: MySQL 8.x / MariaDB
-- Passwords:
--   superadmin   -> SuperAdmin123!
--   admin_tech   -> Admin123!
--   admin_metro  -> Admin123!
--   seller_alice -> Seller123!
--   seller_bob   -> Seller123!
--   seller_charlie -> Seller123!
-- =============================================================================

USE `pos_ecommerce_db`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. SEED SHOPS
-- -----------------------------------------------------------------------------
INSERT INTO `shops` (`id`, `shop_code`, `name`, `address`, `phone`, `is_active`) VALUES
(1, 'SHP01', 'Downtown Tech & Gadgets', '100 Innovation Way, Suite 4B, Tech District', '+1-555-0101', TRUE),
(2, 'SHP02', 'Metro Fashion Boutique', '450 Galleria Mall, Level 2, Fashion Center', '+1-555-0102', TRUE);

-- -----------------------------------------------------------------------------
-- 2. SEED USERS (Strict RBAC: super_admin, admin, seller)
-- -----------------------------------------------------------------------------
INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `role`, `shop_id`, `full_name`, `is_active`) VALUES
(1, 'superadmin', 'superadmin@system.com', '$2a$10$uS8h5rrsc0.A40b.tyBSUu.zwa2vZaKd.kgI/G5fe8nZZf2qLxDRa', 'super_admin', NULL, 'Alexander Cross', TRUE),
(2, 'admin_tech', 'admin.tech@downtown.com', '$2a$10$TfJIAodYeeTPQGJSX0ILBe3/lsE/VDdvia758JRUIxnwEWCffluz.', 'admin', 1, 'Marcus Vance', TRUE),
(3, 'admin_metro', 'admin.metro@fashion.com', '$2a$10$TfJIAodYeeTPQGJSX0ILBe3/lsE/VDdvia758JRUIxnwEWCffluz.', 'admin', 2, 'Elena Rostova', TRUE),
(4, 'seller_alice', 'alice@downtown.com', '$2a$10$vEh2dCQfdLQ7cS8QsYzxTuOXFmIK.7gN7CiM2Su1GSEO0lLwCLZCG', 'seller', 1, 'Alice Morgan', TRUE),
(5, 'seller_bob', 'bob@downtown.com', '$2a$10$vEh2dCQfdLQ7cS8QsYzxTuOXFmIK.7gN7CiM2Su1GSEO0lLwCLZCG', 'seller', 1, 'Bob Kendrick', TRUE),
(6, 'seller_charlie', 'charlie@fashion.com', '$2a$10$vEh2dCQfdLQ7cS8QsYzxTuOXFmIK.7gN7CiM2Su1GSEO0lLwCLZCG', 'seller', 2, 'Charlie Dupont', TRUE);

-- -----------------------------------------------------------------------------
-- 3. SEED PRODUCTS (With Unique Generated Alphanumeric IDs for Direct Identification)
-- -----------------------------------------------------------------------------
INSERT INTO `products` (`id`, `shop_id`, `name`, `description`, `category`, `price`, `cost_price`, `stock_quantity`, `reorder_level`) VALUES
-- Shop 1 (Downtown Tech & Gadgets)
('PRD-SHP01-3BSR-7RUR', 1, 'Wireless Noise-Cancelling Headphones', 'Over-ear active noise cancelling headphones with 40hr battery', 'Audio', 149.99, 85.00, 25, 5),
('PRD-SHP01-3BSR-CHG4', 1, '65W GaN Fast Wall Charger', 'Dual USB-C and USB-A power delivery travel adapter', 'Accessories', 34.99, 14.50, 58, 10),
('PRD-SHP01-3BSR-MOU9', 1, 'Ergonomic Wireless Optical Mouse', '2.4GHz rechargeable wireless mouse with silent clicks', 'Peripherals', 29.99, 12.00, 39, 8),
('PRD-SHP01-3BSR-CBL2', 1, 'Braided USB-C to Lightning Cable (2m)', 'MFi certified heavy duty braided nylon cable', 'Cables', 18.99, 6.00, 80, 15),
('PRD-SHP01-3BSR-SPK5', 1, 'Waterproof Bluetooth Speaker IPX7', 'Portable outdoor speaker with 360 degree bass boost', 'Audio', 69.99, 35.00, 18, 5),
('PRD-SHP01-3BSR-KBD7', 1, 'RGB Mechanical Gaming Keyboard', 'Hot-swappable tactile brown switches with RGB backlight', 'Peripherals', 89.99, 48.00, 14, 5),

-- Shop 2 (Metro Fashion Boutique)
('PRD-SHP02-3BSR-DNM3', 2, 'Classic Slim-Fit Denim Jeans', 'Premium stretch raw denim trousers in dark indigo', 'Apparel', 59.99, 24.00, 35, 10),
('PRD-SHP02-3BSR-TEE6', 2, 'Organic Cotton Crewneck T-Shirt', '100% ring-spun organic cotton breathable tee in black', 'Apparel', 24.99, 8.50, 98, 20),
('PRD-SHP02-3BSR-JKT9', 2, 'Urban Faux-Leather Biker Jacket', 'Weather-resistant slim fit motorcycle style jacket', 'Outerwear', 189.99, 95.00, 11, 3),
('PRD-SHP02-3BSR-SNK2', 2, 'Breathable Knit Walking Sneakers', 'Lightweight cushion sole athletic walking shoes', 'Footwear', 79.99, 38.00, 22, 5),
('PRD-SHP02-3BSR-BLT4', 2, 'Full-Grain Reversible Leather Belt', 'Handcrafted leather dress belt with gunmetal buckle', 'Accessories', 39.99, 16.00, 30, 8);

-- -----------------------------------------------------------------------------
-- 4. SEED INITIAL INVENTORY LOGS
-- -----------------------------------------------------------------------------
INSERT INTO `inventory_logs` (`shop_id`, `product_id`, `user_id`, `change_type`, `quantity_change`, `previous_stock`, `new_stock`, `reason`, `created_at`) VALUES
(1, 'PRD-SHP01-3BSR-7RUR', 2, 'initial', 25, 0, 25, 'Initial store stock entry', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-CHG4', 2, 'initial', 60, 0, 60, 'Initial store stock entry', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-MOU9', 2, 'initial', 40, 0, 40, 'Initial store stock entry', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-CBL2', 2, 'initial', 80, 0, 80, 'Initial store stock entry', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-SPK5', 2, 'initial', 20, 0, 20, 'Initial store stock entry', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-KBD7', 2, 'initial', 15, 0, 15, 'Initial store stock entry', '2026-09-01 09:00:00'),

(2, 'PRD-SHP02-3BSR-DNM3', 3, 'initial', 35, 0, 35, 'Initial store stock entry', '2026-09-01 09:00:00'),
(2, 'PRD-SHP02-3BSR-TEE6', 3, 'initial', 100, 0, 100, 'Initial store stock entry', '2026-09-01 09:00:00'),
(2, 'PRD-SHP02-3BSR-JKT9', 3, 'initial', 12, 0, 12, 'Initial store stock entry', '2026-09-01 09:00:00'),
(2, 'PRD-SHP02-3BSR-SNK2', 3, 'initial', 22, 0, 22, 'Initial store stock entry', '2026-09-01 09:00:00'),
(2, 'PRD-SHP02-3BSR-BLT4', 3, 'initial', 30, 0, 30, 'Initial store stock entry', '2026-09-01 09:00:00');

-- -----------------------------------------------------------------------------
-- 5. SEED SAMPLE POS TRANSACTIONS (SRS 3.3)
-- -----------------------------------------------------------------------------
INSERT INTO `transactions` (`id`, `shop_id`, `seller_id`, `total_amount`, `payment_method`, `status`, `notes`, `transaction_date`) VALUES
('TXN-SHP01-20260913-7ESU', 1, 4, 99.97, 'card', 'completed', 'Customer counter purchase', '2026-09-13 10:15:00'),
('TXN-SHP01-20260913-4B8Y', 1, 5, 89.99, 'cash', 'completed', 'Walk-in cash customer', '2026-09-13 11:30:00'),
('TXN-SHP02-20260913-9K2N', 2, 6, 214.98, 'card', 'completed', 'Fashion retail sale', '2026-09-13 10:45:00');

-- -----------------------------------------------------------------------------
-- 6. SEED TRANSACTION LINE ITEMS
-- -----------------------------------------------------------------------------
INSERT INTO `transaction_items` (`transaction_id`, `product_id`, `quantity`, `unit_price`, `subtotal`) VALUES
-- Transaction 1 items: 2 chargers ($34.99 each) + 1 mouse ($29.99) = $99.97
('TXN-SHP01-20260913-7ESU', 'PRD-SHP01-3BSR-CHG4', 2, 34.99, 69.98),
('TXN-SHP01-20260913-7ESU', 'PRD-SHP01-3BSR-MOU9', 1, 29.99, 29.99),

-- Transaction 2 items: 1 keyboard ($89.99) = $89.99
('TXN-SHP01-20260913-4B8Y', 'PRD-SHP01-3BSR-KBD7', 1, 89.99, 89.99),

-- Transaction 3 items: 1 jacket ($189.99) + 1 t-shirt ($24.99) = $214.98
('TXN-SHP02-20260913-9K2N', 'PRD-SHP02-3BSR-JKT9', 1, 189.99, 189.99),
('TXN-SHP02-20260913-9K2N', 'PRD-SHP02-3BSR-TEE6', 1, 24.99, 24.99);

-- -----------------------------------------------------------------------------
-- 7. SEED INVENTORY SALE DEDUCTION LOGS (ACID trail)
-- -----------------------------------------------------------------------------
INSERT INTO `inventory_logs` (`shop_id`, `product_id`, `user_id`, `change_type`, `quantity_change`, `previous_stock`, `new_stock`, `reason`, `created_at`) VALUES
(1, 'PRD-SHP01-3BSR-CHG4', 4, 'sale', -2, 60, 58, 'POS Sale: Transaction #TXN-SHP01-20260913-7ESU', '2026-09-13 10:15:00'),
(1, 'PRD-SHP01-3BSR-MOU9', 4, 'sale', -1, 40, 39, 'POS Sale: Transaction #TXN-SHP01-20260913-7ESU', '2026-09-13 10:15:00'),
(1, 'PRD-SHP01-3BSR-KBD7', 5, 'sale', -1, 15, 14, 'POS Sale: Transaction #TXN-SHP01-20260913-4B8Y', '2026-09-13 11:30:00'),
(2, 'PRD-SHP02-3BSR-JKT9', 6, 'sale', -1, 12, 11, 'POS Sale: Transaction #TXN-SHP02-20260913-9K2N', '2026-09-13 10:45:00'),
(2, 'PRD-SHP02-3BSR-TEE6', 6, 'sale', -1, 100, 99, 'POS Sale: Transaction #TXN-SHP02-20260913-9K2N', '2026-09-13 10:45:00');

-- -----------------------------------------------------------------------------
-- 8. SEED INVENTORY SHRINKAGE LOGS (SRS 3.4 Discrepancies/Loss)
-- -----------------------------------------------------------------------------
INSERT INTO `inventory_logs` (`shop_id`, `product_id`, `user_id`, `change_type`, `quantity_change`, `previous_stock`, `new_stock`, `reason`, `created_at`) VALUES
-- 2 speaker units damaged in transit / water leak in warehouse
(1, 'PRD-SHP01-3BSR-SPK5', 2, 'shrinkage_adjustment', -2, 20, 18, 'Damaged stock during warehouse storage', '2026-09-13 08:30:00'),
-- 1 t-shirt lost in dressing room / damaged display sample
(2, 'PRD-SHP02-3BSR-TEE6', 3, 'shrinkage_adjustment', -1, 99, 98, 'Defective zipper / fitting room display damage', '2026-09-13 09:00:00');

-- -----------------------------------------------------------------------------
-- 9. SEED DAILY COMPILED REPORT (SRS 3.4)
-- -----------------------------------------------------------------------------
INSERT INTO `daily_reports` (`shop_id`, `report_date`, `total_transactions`, `total_units_sold`, `revenue_generated`, `total_cost`, `net_profit`, `shrinkage_count`, `shrinkage_cost`, `compiled_at`) VALUES
(1, '2026-09-13', 2, 4, 189.96, 89.00, 100.96, 2, 70.00, '2026-09-13 12:00:00'),
(2, '2026-09-13', 1, 2, 214.98, 103.50, 111.48, 1, 8.50, '2026-09-13 12:00:00');

SET FOREIGN_KEY_CHECKS = 1;
