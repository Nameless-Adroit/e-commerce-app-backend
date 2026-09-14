-- =============================================================================
-- Multi-Tier E-Commerce & POS Mobile Application
-- Realistic & Production-Grade Seed Data (seed.sql)
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

-- Clean existing data before seeding fresh records
TRUNCATE TABLE `daily_reports`;
TRUNCATE TABLE `inventory_logs`;
TRUNCATE TABLE `transaction_items`;
TRUNCATE TABLE `transactions`;
TRUNCATE TABLE `products`;
TRUNCATE TABLE `users`;
TRUNCATE TABLE `shops`;

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
-- 3. SEED PRODUCTS (With Realistic Margins, Correct Costs, and Rich Descriptions)
-- -----------------------------------------------------------------------------
INSERT INTO `products` (`id`, `shop_id`, `name`, `description`, `category`, `price`, `cost_price`, `stock_quantity`, `reorder_level`) VALUES
-- Shop 1 (Downtown Tech & Gadgets)
('PRD-SHP01-3BSR-7RUR', 1, 'Wireless Noise-Cancelling Headphones', 'Premium over-ear headphones featuring dual-mic hybrid active noise cancellation, custom 40mm neodymium drivers, ambient transparency mode, and 40-hour wireless battery life with fast USB-C charging.', 'Audio', 149.99, 85.00, 24, 5),
('PRD-SHP01-3BSR-CHG4', 1, '65W GaN Fast Wall Charger', 'Ultra-compact Gallium Nitride (GaN) dual USB-C and USB-A wall plug supporting Power Delivery 3.0 and PPS protocols. Fast-charges laptops, tablets, and phones simultaneously with dynamic thermal monitoring.', 'Accessories', 34.99, 14.50, 56, 10),
('PRD-SHP01-3BSR-MOU9', 1, 'Ergonomic Wireless Optical Mouse', 'Ergonomically contoured 2.4GHz wireless and Bluetooth mouse with whisper-quiet tactile switches, adjustable 4000 DPI optical sensor, thumb controls, and an internal rechargeable battery.', 'Peripherals', 29.99, 12.00, 39, 8),
('PRD-SHP01-3BSR-CBL2', 1, 'Braided USB-C to Lightning Cable (2m)', 'Apple MFi certified heavy-duty double-braided nylon cable tested for 20,000+ bends. Supports 27W high-speed charging and 480Mbps data transfer with reinforced aluminum alloy connector housings.', 'Cables', 18.99, 6.00, 79, 15),
('PRD-SHP01-3BSR-SPK5', 1, 'Waterproof Bluetooth Speaker IPX7', 'Rugged waterproof outdoor speaker with dual passive radiators delivering punchy 360-degree bass. Features Bluetooth 5.3 connectivity, TWS stereo pairing, and 16 hours of continuous playback.', 'Audio', 69.99, 35.00, 18, 5),
('PRD-SHP01-3BSR-KBD7', 1, 'RGB Mechanical Gaming Keyboard', 'Tenkeyless mechanical keyboard featuring hot-swappable tactile brown switches, per-key RGB backlighting with 18 presets, sound-dampening EVA foam, and durable double-shot PBT keycaps.', 'Peripherals', 89.99, 48.00, 14, 5),
('PRD-SHP01-3BSR-PHN1', 1, 'Apex Ultra 5G Smartphone', 'Flagship 6.7-inch 120Hz AMOLED smartphone featuring high-speed 5G processor, 256GB internal storage, 50MP triple optical image stabilization camera, and an all-day 5000mAh battery with 65W charging.', 'Phones', 799.99, 480.00, 11, 3),
('PRD-SHP01-3BSR-WAT3', 1, 'Titanium Smartwatch Fitness Tracker', 'Aviation-grade titanium smartwatch with sapphire glass, 24/7 heart rate and blood oxygen monitoring, built-in dual-frequency GPS, 100+ sport modes, and up to 14-day battery endurance.', 'Wearables', 199.99, 110.00, 20, 5),

-- Shop 2 (Metro Fashion Boutique)
('PRD-SHP02-3BSR-DNM3', 2, 'Classic Slim-Fit Denim Jeans', 'Tailored slim-fit trousers crafted from 12.5oz Japanese stretch denim in deep indigo wash. Features antique brass rivets, reinforced 5-pocket styling, and comfortable shape-retaining cotton elastane blend.', 'Apparel', 59.99, 24.00, 34, 10),
('PRD-SHP02-3BSR-TEE6', 2, 'Organic Cotton Crewneck T-Shirt', 'Super-soft 180 GSM ring-spun organic combed cotton t-shirt with ribbed crew neckline and pre-shrunk finish. Breathable, durable, and naturally hypoallergenic for everyday luxury comfort.', 'Apparel', 24.99, 8.50, 96, 20),
('PRD-SHP02-3BSR-JKT9', 2, 'Urban Faux-Leather Biker Jacket', 'Contemporary motorcycle jacket crafted from weather-treated supple vegan leather. Accented with asymmetrical gunmetal zippered closures, notched lapels, and quilted thermal satin lining.', 'Outerwear', 189.99, 95.00, 10, 3),
('PRD-SHP02-3BSR-SNK2', 2, 'Breathable Knit Walking Sneakers', 'Ultra-lightweight walking athletic shoes engineered with seamless 3D knit upper and high-rebound EVA cushioning. Delivers anatomical arch support and non-slip rubber traction pods.', 'Footwear', 79.99, 38.00, 22, 5),
('PRD-SHP02-3BSR-BLT4', 2, 'Full-Grain Reversible Leather Belt', 'Handcrafted 34mm genuine full-grain Italian leather belt with a rotating brushed steel buckle. Seamlessly reverses between classic black and rich cognac brown to match any business or casual attire.', 'Accessories', 39.99, 16.00, 29, 8),
('PRD-SHP02-3BSR-BAG8', 2, 'Minimalist Canvas Everyday Tote', 'Heavyweight 16oz water-repellent organic cotton canvas tote bag with reinforced leather handles, magnetic top closure, padded interior 15-inch laptop sleeve, and zippered security key pocket.', 'Bags', 44.99, 18.00, 25, 6);

-- -----------------------------------------------------------------------------
-- 4. SEED INITIAL INVENTORY LOGS
-- -----------------------------------------------------------------------------
INSERT INTO `inventory_logs` (`shop_id`, `product_id`, `user_id`, `change_type`, `quantity_change`, `previous_stock`, `new_stock`, `reason`, `created_at`) VALUES
(1, 'PRD-SHP01-3BSR-7RUR', 2, 'initial', 25, 0, 25, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-CHG4', 2, 'initial', 60, 0, 60, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-MOU9', 2, 'initial', 40, 0, 40, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-CBL2', 2, 'initial', 80, 0, 80, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-SPK5', 2, 'initial', 20, 0, 20, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-KBD7', 2, 'initial', 15, 0, 15, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-PHN1', 2, 'initial', 12, 0, 12, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(1, 'PRD-SHP01-3BSR-WAT3', 2, 'initial', 20, 0, 20, 'Initial store inventory baseline', '2026-09-01 09:00:00'),

(2, 'PRD-SHP02-3BSR-DNM3', 3, 'initial', 35, 0, 35, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(2, 'PRD-SHP02-3BSR-TEE6', 3, 'initial', 100, 0, 100, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(2, 'PRD-SHP02-3BSR-JKT9', 3, 'initial', 11, 0, 11, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(2, 'PRD-SHP02-3BSR-SNK2', 3, 'initial', 22, 0, 22, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(2, 'PRD-SHP02-3BSR-BLT4', 3, 'initial', 30, 0, 30, 'Initial store inventory baseline', '2026-09-01 09:00:00'),
(2, 'PRD-SHP02-3BSR-BAG8', 3, 'initial', 25, 0, 25, 'Initial store inventory baseline', '2026-09-01 09:00:00');

-- -----------------------------------------------------------------------------
-- 5. SEED POS TRANSACTIONS (Realistic Positive Revenue & Healthy Profit Margins)
-- -----------------------------------------------------------------------------
INSERT INTO `transactions` (`id`, `shop_id`, `seller_id`, `subtotal_amount`, `discount_amount`, `total_amount`, `payment_method`, `status`, `notes`, `transaction_date`) VALUES
-- Shop 1 Transactions
('TXN-SHP01-20260914-1A01', 1, 4, 168.98, 8.98, 160.00, 'card', 'completed', 'Counter sale: Headphones + Cable with promotional discount', NOW()),
('TXN-SHP01-20260914-1A02', 1, 4, 64.98, 0.00, 64.98, 'cash', 'completed', 'Walk-in cash sale: Fast Charger + Wireless Mouse', NOW()),
('TXN-SHP01-20260914-1A03', 1, 5, 834.98, 34.98, 800.00, 'card', 'completed', 'Flagship phone purchase with bundled fast charger promo', NOW()),
('TXN-SHP01-20260914-1A04', 1, 5, 89.99, 0.00, 89.99, 'mobile_money', 'completed', 'RGB Mechanical Gaming Keyboard counter sale', NOW()),

-- Shop 2 Transactions
('TXN-SHP02-20260914-2B01', 2, 6, 249.98, 10.00, 239.98, 'card', 'completed', 'Biker Jacket + Denim Jeans weekend outfit bundle', NOW()),
('TXN-SHP02-20260914-2B02', 2, 6, 89.97, 0.00, 89.97, 'cash', 'completed', '2x Organic Cotton T-Shirts + Reversible Leather Belt', NOW());

-- -----------------------------------------------------------------------------
-- 6. SEED TRANSACTION LINE ITEMS
-- -----------------------------------------------------------------------------
INSERT INTO `transaction_items` (`transaction_id`, `product_id`, `quantity`, `unit_price`, `subtotal`) VALUES
-- Txn 1: 1 Headphones ($149.99) + 1 Cable ($18.99)
('TXN-SHP01-20260914-1A01', 'PRD-SHP01-3BSR-7RUR', 1, 149.99, 149.99),
('TXN-SHP01-20260914-1A01', 'PRD-SHP01-3BSR-CBL2', 1, 18.99, 18.99),

-- Txn 2: 1 Charger ($34.99) + 1 Mouse ($29.99)
('TXN-SHP01-20260914-1A02', 'PRD-SHP01-3BSR-CHG4', 1, 34.99, 34.99),
('TXN-SHP01-20260914-1A02', 'PRD-SHP01-3BSR-MOU9', 1, 29.99, 29.99),

-- Txn 3: 1 Smartphone ($799.99) + 1 Charger ($34.99)
('TXN-SHP01-20260914-1A03', 'PRD-SHP01-3BSR-PHN1', 1, 799.99, 799.99),
('TXN-SHP01-20260914-1A03', 'PRD-SHP01-3BSR-CHG4', 1, 34.99, 34.99),

-- Txn 4: 1 Keyboard ($89.99)
('TXN-SHP01-20260914-1A04', 'PRD-SHP01-3BSR-KBD7', 1, 89.99, 89.99),

-- Txn 5: 1 Jacket ($189.99) + 1 Jeans ($59.99)
('TXN-SHP02-20260914-2B01', 'PRD-SHP02-3BSR-JKT9', 1, 189.99, 189.99),
('TXN-SHP02-20260914-2B01', 'PRD-SHP02-3BSR-DNM3', 1, 59.99, 59.99),

-- Txn 6: 2 T-Shirts ($24.99 ea = $49.98) + 1 Belt ($39.99)
('TXN-SHP02-20260914-2B02', 'PRD-SHP02-3BSR-TEE6', 2, 24.99, 49.98),
('TXN-SHP02-20260914-2B02', 'PRD-SHP02-3BSR-BLT4', 1, 39.99, 39.99);

-- -----------------------------------------------------------------------------
-- 7. SEED INVENTORY SALE AUDIT LOGS
-- -----------------------------------------------------------------------------
INSERT INTO `inventory_logs` (`shop_id`, `product_id`, `user_id`, `change_type`, `quantity_change`, `previous_stock`, `new_stock`, `reason`, `created_at`) VALUES
(1, 'PRD-SHP01-3BSR-7RUR', 4, 'sale', -1, 25, 24, 'POS Sale: Transaction #TXN-SHP01-20260914-1A01', NOW()),
(1, 'PRD-SHP01-3BSR-CBL2', 4, 'sale', -1, 80, 79, 'POS Sale: Transaction #TXN-SHP01-20260914-1A01', NOW()),
(1, 'PRD-SHP01-3BSR-CHG4', 4, 'sale', -1, 60, 59, 'POS Sale: Transaction #TXN-SHP01-20260914-1A02', NOW()),
(1, 'PRD-SHP01-3BSR-MOU9', 4, 'sale', -1, 40, 39, 'POS Sale: Transaction #TXN-SHP01-20260914-1A02', NOW()),
(1, 'PRD-SHP01-3BSR-PHN1', 5, 'sale', -1, 12, 11, 'POS Sale: Transaction #TXN-SHP01-20260914-1A03', NOW()),
(1, 'PRD-SHP01-3BSR-CHG4', 5, 'sale', -1, 59, 58, 'POS Sale: Transaction #TXN-SHP01-20260914-1A03', NOW()),
(1, 'PRD-SHP01-3BSR-KBD7', 5, 'sale', -1, 15, 14, 'POS Sale: Transaction #TXN-SHP01-20260914-1A04', NOW()),

(2, 'PRD-SHP02-3BSR-JKT9', 6, 'sale', -1, 11, 10, 'POS Sale: Transaction #TXN-SHP02-20260914-2B01', NOW()),
(2, 'PRD-SHP02-3BSR-DNM3', 6, 'sale', -1, 35, 34, 'POS Sale: Transaction #TXN-SHP02-20260914-2B01', NOW()),
(2, 'PRD-SHP02-3BSR-TEE6', 6, 'sale', -2, 100, 98, 'POS Sale: Transaction #TXN-SHP02-20260914-2B02', NOW()),
(2, 'PRD-SHP02-3BSR-BLT4', 6, 'sale', -1, 30, 29, 'POS Sale: Transaction #TXN-SHP02-20260914-2B02', NOW());

-- -----------------------------------------------------------------------------
-- 8. SEED MINOR SHRINKAGE LOGS (Realistic Minor Losses with Reasons)
-- -----------------------------------------------------------------------------
INSERT INTO `inventory_logs` (`shop_id`, `product_id`, `user_id`, `change_type`, `quantity_change`, `previous_stock`, `new_stock`, `reason`, `created_at`) VALUES
-- 1 charger unit with damaged packaging from freight delivery
(1, 'PRD-SHP01-3BSR-CHG4', 2, 'shrinkage_adjustment', -2, 58, 56, 'Supplier shipping carton water damage / defective casing', NOW()),
-- 2 t-shirts with fitting room dye discoloration
(2, 'PRD-SHP02-3BSR-TEE6', 3, 'shrinkage_adjustment', -2, 98, 96, 'Fitting room display makeup staining / fabric snag', NOW());

-- -----------------------------------------------------------------------------
-- 9. SEED DAILY COMPILED REPORTS (Healthy Margins: Shop 1 ~42%, Shop 2 ~54%)
-- -----------------------------------------------------------------------------
-- Shop 1 (Downtown Tech): 4 txns, 7 units, $1,114.97 revenue, $659.00 cost, $455.97 net profit, $29.00 shrinkage
-- Shop 2 (Metro Fashion): 2 txns, 5 units, $329.95 revenue, $152.00 cost, $177.95 net profit, $17.00 shrinkage
INSERT INTO `daily_reports` (`shop_id`, `report_date`, `total_transactions`, `total_units_sold`, `revenue_generated`, `total_cost`, `net_profit`, `shrinkage_count`, `shrinkage_cost`, `compiled_at`) VALUES
(1, CURRENT_DATE(), 4, 7, 1114.97, 659.00, 455.97, 2, 29.00, NOW()),
(2, CURRENT_DATE(), 2, 5, 329.95, 152.00, 177.95, 2, 17.00, NOW());

SET FOREIGN_KEY_CHECKS = 1;
