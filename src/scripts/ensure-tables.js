/**
 * Ensure Essential Tables and Catalogs Migration
 * Guarantees that retail operational tables (products, transactions, transaction_items,
 * inventory_logs, daily_reports) exist without dropping or losing existing data.
 */
import { query } from '../config/database.config.js';

export async function ensureAllTablesExist() {
  console.log('📦 Verifying core operational tables (products, transactions, inventory)...');

  try {
    // 1. Ensure `products` table
    await query(`
      CREATE TABLE IF NOT EXISTS \`products\` (
        \`id\` VARCHAR(50) PRIMARY KEY COMMENT 'Unique Alphanumeric Product ID (e.g. PRD-SHP01-X7K9-2026)',
        \`shop_id\` INT NOT NULL COMMENT 'Shop to which this product belongs',
        \`name\` VARCHAR(150) NOT NULL,
        \`description\` TEXT NULL,
        \`category\` VARCHAR(100) NOT NULL DEFAULT 'General',
        \`price\` DECIMAL(10, 2) NOT NULL COMMENT 'Selling price to customer',
        \`cost_price\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Wholesale / acquisition cost for profit & shrinkage calculation',
        \`stock_quantity\` INT NOT NULL DEFAULT 0 COMMENT 'Real-time available inventory',
        \`reorder_level\` INT NOT NULL DEFAULT 5 COMMENT 'Threshold for low-stock warnings',
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_products_shop\` FOREIGN KEY (\`shop_id\`) REFERENCES \`shops\` (\`id\`) ON DELETE CASCADE,
        INDEX \`idx_products_shop\` (\`shop_id\`),
        INDEX \`idx_products_category\` (\`category\`),
        INDEX \`idx_products_stock\` (\`stock_quantity\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Ensure `transactions` table
    await query(`
      CREATE TABLE IF NOT EXISTS \`transactions\` (
        \`id\` VARCHAR(50) PRIMARY KEY COMMENT 'Unique Transaction Code (e.g. TXN-SHP01-20260913-9F3K)',
        \`shop_id\` INT NOT NULL,
        \`seller_id\` INT NOT NULL,
        \`subtotal_amount\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        \`discount_amount\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        \`total_amount\` DECIMAL(10, 2) NOT NULL,
        \`payment_method\` ENUM('cash', 'card', 'mobile_money') NOT NULL DEFAULT 'cash',
        \`status\` ENUM('completed', 'refunded', 'cancelled') NOT NULL DEFAULT 'completed',
        \`original_transaction_id\` VARCHAR(50) NULL COMMENT 'References parent sale if this is a customer return transaction',
        \`notes\` VARCHAR(255) NULL,
        \`transaction_date\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_transactions_shop\` FOREIGN KEY (\`shop_id\`) REFERENCES \`shops\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_transactions_seller\` FOREIGN KEY (\`seller_id\`) REFERENCES \`users\` (\`id\`),
        INDEX \`idx_transactions_shop\` (\`shop_id\`),
        INDEX \`idx_transactions_seller\` (\`seller_id\`),
        INDEX \`idx_transactions_date\` (\`transaction_date\`),
        INDEX \`idx_transactions_original\` (\`original_transaction_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Ensure `transaction_items` table
    await query(`
      CREATE TABLE IF NOT EXISTS \`transaction_items\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`transaction_id\` VARCHAR(50) NOT NULL,
        \`product_id\` VARCHAR(50) NOT NULL,
        \`quantity\` INT NOT NULL,
        \`unit_price\` DECIMAL(10, 2) NOT NULL,
        \`subtotal\` DECIMAL(10, 2) NOT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_items_transaction\` FOREIGN KEY (\`transaction_id\`) REFERENCES \`transactions\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_items_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`),
        INDEX \`idx_items_transaction\` (\`transaction_id\`),
        INDEX \`idx_items_product\` (\`product_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Ensure `inventory_logs` table
    await query(`
      CREATE TABLE IF NOT EXISTS \`inventory_logs\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`shop_id\` INT NOT NULL,
        \`product_id\` VARCHAR(50) NOT NULL,
        \`user_id\` INT NOT NULL,
        \`change_type\` ENUM('restock', 'sale', 'shrinkage_adjustment', 'return', 'initial') NOT NULL,
        \`quantity_change\` INT NOT NULL COMMENT 'Negative for sales/shrinkage; positive for restock/returns',
        \`previous_stock\` INT NOT NULL,
        \`new_stock\` INT NOT NULL,
        \`reason\` VARCHAR(255) NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_logs_shop\` FOREIGN KEY (\`shop_id\`) REFERENCES \`shops\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_logs_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_logs_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`),
        INDEX \`idx_logs_shop\` (\`shop_id\`),
        INDEX \`idx_logs_product\` (\`product_id\`),
        INDEX \`idx_logs_change_type\` (\`change_type\`),
        INDEX \`idx_logs_created_at\` (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Ensure `daily_reports` table
    await query(`
      CREATE TABLE IF NOT EXISTS \`daily_reports\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`shop_id\` INT NOT NULL,
        \`report_date\` DATE NOT NULL,
        \`total_transactions\` INT NOT NULL DEFAULT 0,
        \`total_units_sold\` INT NOT NULL DEFAULT 0,
        \`revenue_generated\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        \`total_cost\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        \`net_profit\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        \`shrinkage_count\` INT NOT NULL DEFAULT 0 COMMENT 'Number of units lost/damaged/unaccounted',
        \`shrinkage_cost\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Monetary value of lost/shrinkage units',
        \`compiled_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_reports_shop\` FOREIGN KEY (\`shop_id\`) REFERENCES \`shops\` (\`id\`) ON DELETE CASCADE,
        UNIQUE KEY \`uk_shop_report_date\` (\`shop_id\`, \`report_date\`),
        INDEX \`idx_reports_shop\` (\`shop_id\`),
        INDEX \`idx_reports_date\` (\`report_date\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('✅ Core operational tables created or verified.');

    // 6. Seed sample products if table is empty
    const productCount = await query('SELECT COUNT(*) as count FROM products');
    if (productCount[0].count === 0) {
      const shops = await query('SELECT id FROM shops ORDER BY id ASC LIMIT 2');
      if (shops.length > 0) {
        const shop1Id = shops[0].id;
        console.log(`🌱 Seeding sample products for Shop ID ${shop1Id}...`);
        await query(`
          INSERT INTO \`products\` (\`id\`, \`shop_id\`, \`name\`, \`description\`, \`category\`, \`price\`, \`cost_price\`, \`stock_quantity\`, \`reorder_level\`) VALUES
          ('PRD-SHP01-3BSR-7RUR', ?, 'Wireless Noise-Cancelling Headphones', 'Premium over-ear headphones featuring dual-mic hybrid active noise cancellation, custom 40mm neodymium drivers, ambient transparency mode, and 40-hour wireless battery life with fast USB-C charging.', 'Audio', 380000.00, 220000.00, 24, 5),
          ('PRD-SHP01-3BSR-CHG4', ?, '65W GaN Fast Wall Charger', 'Ultra-compact Gallium Nitride (GaN) dual USB-C and USB-A wall plug supporting Power Delivery 3.0 and PPS protocols. Fast-charges laptops, tablets, and phones simultaneously with dynamic thermal monitoring.', 'Accessories', 90000.00, 45000.00, 56, 10),
          ('PRD-SHP01-3BSR-MOU9', ?, 'Ergonomic Wireless Optical Mouse', 'Ergonomically contoured 2.4GHz wireless and Bluetooth mouse with whisper-quiet tactile switches, adjustable 4000 DPI optical sensor, thumb controls, and an internal rechargeable battery.', 'Peripherals', 75000.00, 35000.00, 39, 8),
          ('PRD-SHP01-3BSR-CBL2', ?, 'Braided USB-C to Lightning Cable (2m)', 'Apple MFi certified heavy-duty double-braided nylon cable tested for 20,000+ bends. Supports 27W high-speed charging and 480Mbps data transfer with reinforced aluminum alloy connector housings.', 'Cables', 45000.00, 18000.00, 79, 15),
          ('PRD-SHP01-3BSR-SPK5', ?, 'Waterproof Bluetooth Speaker IPX7', 'Rugged waterproof outdoor speaker with dual passive radiators delivering punchy 360-degree bass. Features Bluetooth 5.3 connectivity, TWS stereo pairing, and 16 hours of continuous playback.', 'Audio', 180000.00, 95000.00, 18, 5),
          ('PRD-SHP01-3BSR-KBD7', ?, 'RGB Mechanical Gaming Keyboard', 'Tenkeyless mechanical keyboard featuring hot-swappable tactile brown switches, per-key RGB backlighting with 18 presets, sound-dampening EVA foam, and durable double-shot PBT keycaps.', 'Peripherals', 230000.00, 120000.00, 14, 5),
          ('PRD-SHP01-3BSR-PHN1', ?, 'Apex Ultra 5G Smartphone', 'Flagship 6.7-inch 120Hz AMOLED smartphone featuring high-speed 5G processor, 256GB internal storage, 50MP triple optical image stabilization camera, and an all-day 5000mAh battery with 65W charging.', 'Phones', 2050000.00, 1350000.00, 11, 3),
          ('PRD-SHP01-3BSR-WAT3', ?, 'Titanium Smartwatch Fitness Tracker', 'Aviation-grade titanium smartwatch with sapphire glass, 24/7 heart rate and blood oxygen monitoring, built-in dual-frequency GPS, 100+ sport modes, and up to 14-day battery endurance.', 'Wearables', 520000.00, 290000.00, 20, 5)
        `, [shop1Id, shop1Id, shop1Id, shop1Id, shop1Id, shop1Id, shop1Id, shop1Id]);

        if (shops.length > 1) {
          const shop2Id = shops[1].id;
          console.log(`🌱 Seeding sample products for Shop ID ${shop2Id}...`);
          await query(`
            INSERT INTO \`products\` (\`id\`, \`shop_id\`, \`name\`, \`description\`, \`category\`, \`price\`, \`cost_price\`, \`stock_quantity\`, \`reorder_level\`) VALUES
            ('PRD-SHP02-3BSR-DNM3', ?, 'Classic Slim-Fit Denim Jeans', 'Tailored slim-fit trousers crafted from 12.5oz Japanese stretch denim in deep indigo wash.', 'Apparel', 150000.00, 70000.00, 34, 10),
            ('PRD-SHP02-3BSR-TEE6', ?, 'Organic Cotton Crewneck T-Shirt', 'Super-soft 180 GSM ring-spun organic combed cotton t-shirt with ribbed crew neckline.', 'Apparel', 65000.00, 25000.00, 96, 20),
            ('PRD-SHP02-3BSR-JKT9', ?, 'Urban Faux-Leather Biker Jacket', 'Contemporary motorcycle jacket crafted from weather-treated supple vegan leather.', 'Outerwear', 480000.00, 240000.00, 10, 3),
            ('PRD-SHP02-3BSR-SNK2', ?, 'Breathable Knit Walking Sneakers', 'Ultra-lightweight walking athletic shoes engineered with seamless 3D knit upper.', 'Footwear', 200000.00, 95000.00, 22, 5),
            ('PRD-SHP02-3BSR-BLT4', ?, 'Full-Grain Reversible Leather Belt', 'Handcrafted 34mm genuine full-grain Italian leather belt with rotating brushed steel buckle.', 'Accessories', 100000.00, 45000.00, 29, 8),
            ('PRD-SHP02-3BSR-BAG8', ?, 'Minimalist Canvas Everyday Tote', 'Heavyweight 16oz water-repellent organic cotton canvas tote bag with reinforced handles.', 'Bags', 115000.00, 50000.00, 25, 6)
          `, [shop2Id, shop2Id, shop2Id, shop2Id, shop2Id, shop2Id]);
        }
        console.log('✅ Sample products seeded successfully.');
      }
    }

    // 7. Seed sample transactions if table is empty
    const txnCount = await query('SELECT COUNT(*) as count FROM transactions');
    if (txnCount[0].count === 0) {
      const shops = await query('SELECT id FROM shops ORDER BY id ASC LIMIT 1');
      const users = await query("SELECT id FROM users WHERE role IN ('seller', 'admin') ORDER BY id ASC LIMIT 2");
      if (shops.length > 0 && users.length > 0) {
        const shopId = shops[0].id;
        const sellerId = users[0].id;
        console.log(`🌱 Seeding sample POS transactions for Shop ID ${shopId}...`);
        await query(`
          INSERT INTO \`transactions\` (\`id\`, \`shop_id\`, \`seller_id\`, \`subtotal_amount\`, \`discount_amount\`, \`total_amount\`, \`payment_method\`, \`status\`, \`notes\`, \`transaction_date\`) VALUES
          ('TXN-SHP01-20260914-1A01', ?, ?, 425000.00, 25000.00, 400000.00, 'card', 'completed', 'Counter sale: Headphones + Cable with bundle discount', NOW()),
          ('TXN-SHP01-20260914-1A02', ?, ?, 165000.00, 0.00, 165000.00, 'cash', 'completed', 'Walk-in cash sale: Fast Charger + Wireless Mouse', NOW()),
          ('TXN-SHP01-20260914-1A03', ?, ?, 2140000.00, 40000.00, 2100000.00, 'mobile_money', 'completed', 'M-Pesa payment: Flagship phone purchase with fast charger', NOW())
        `, [shopId, sellerId, shopId, sellerId, shopId, sellerId]);

        // Insert items for these transactions
        const prods = await query('SELECT id, price FROM products LIMIT 3');
        if (prods.length >= 2) {
          await query(`
            INSERT INTO \`transaction_items\` (\`transaction_id\`, \`product_id\`, \`quantity\`, \`unit_price\`, \`subtotal\`) VALUES
            ('TXN-SHP01-20260914-1A01', ?, 1, 380000.00, 380000.00),
            ('TXN-SHP01-20260914-1A01', ?, 1, 45000.00, 45000.00),
            ('TXN-SHP01-20260914-1A02', ?, 1, 90000.00, 90000.00),
            ('TXN-SHP01-20260914-1A02', ?, 1, 75000.00, 75000.00)
          `, [prods[0].id, prods[1].id, prods[1].id, prods[0].id]);
        }
        console.log('✅ Sample POS transactions and items seeded successfully.');
      }
    }
  } catch (err) {
    console.error('⚠️ Notice ensuring core tables exist:', err.message);
  }
}

export default {
  ensureAllTablesExist
};
