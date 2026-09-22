/**
 * Database Migration Script: Subscription System, Dynamic Platform Config & Registration Workflow
 * Idempotent schema migration ensuring tables and columns exist without data loss.
 */
import { query, pool } from '../config/database.config.js';

export async function runSubscriptionPlatformMigration() {
  console.log('🔄 Running Subscription System & Platform Configuration Migration...');

  try {
    const dbName = process.env.DB_NAME || 'pos_ecommerce_db';

    // Helper: Check column existence
    const checkColumn = async (tableName, colName) => {
      const rows = await query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
      `, [dbName, tableName, colName]);
      return rows.length > 0;
    };

    // 1. Create subscription_plans table
    console.log('📦 Ensuring `subscription_plans` table exists...');
    await query(`
      CREATE TABLE IF NOT EXISTS \`subscription_plans\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`plan_code\` VARCHAR(50) NOT NULL UNIQUE,
        \`name\` VARCHAR(100) NOT NULL,
        \`price\` DECIMAL(12, 2) NOT NULL,
        \`billing_cycle\` ENUM('monthly', 'yearly') NOT NULL DEFAULT 'monthly',
        \`max_shops\` INT NOT NULL DEFAULT 1,
        \`max_sellers\` INT NULL COMMENT 'NULL indicates unlimited sellers',
        \`is_active\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_plans_active\` (\`is_active\`),
        INDEX \`idx_plans_code\` (\`plan_code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Seed default subscription plans if table is empty
    const existingPlans = await query('SELECT COUNT(*) as count FROM subscription_plans');
    if (existingPlans[0].count === 0) {
      console.log('🌱 Seeding initial subscription plans...');
      await query(`
        INSERT INTO \`subscription_plans\` (\`plan_code\`, \`name\`, \`price\`, \`billing_cycle\`, \`max_shops\`, \`max_sellers\`, \`is_active\`)
        VALUES 
          ('STARTER', 'Starter Plan', 25000.00, 'monthly', 1, 2, TRUE),
          ('BUSINESS', 'Business Growth', 60000.00, 'monthly', 3, 10, TRUE),
          ('ENTERPRISE', 'Enterprise Retail', 150000.00, 'monthly', 10, NULL, TRUE),
          ('STARTER_YEARLY', 'Starter Annual', 250000.00, 'yearly', 1, 2, TRUE),
          ('BUSINESS_YEARLY', 'Business Annual', 600000.00, 'yearly', 3, 10, TRUE),
          ('ENTERPRISE_YEARLY', 'Enterprise Annual', 1500000.00, 'yearly', 10, NULL, TRUE)
      `);
      console.log('✅ Initial subscription plans seeded.');
    }

    // 2. Extend businesses table with subscription fields and registration state
    console.log('📦 Updating `businesses` table with subscription & registration fields...');
    if (!(await checkColumn('businesses', 'subscription_plan_id'))) {
      await query('ALTER TABLE `businesses` ADD COLUMN `subscription_plan_id` INT NULL AFTER `status`');
      await query('ALTER TABLE `businesses` ADD CONSTRAINT `fk_businesses_plan` FOREIGN KEY (`subscription_plan_id`) REFERENCES `subscription_plans` (`id`) ON DELETE SET NULL');
      console.log('✅ Added `subscription_plan_id` to businesses');
    }

    if (!(await checkColumn('businesses', 'subscription_status'))) {
      await query(`
        ALTER TABLE \`businesses\` 
        ADD COLUMN \`subscription_status\` ENUM('draft', 'payment_pending', 'payment_received', 'pending_review', 'trial', 'active', 'expired', 'cancelled', 'declined') 
        NOT NULL DEFAULT 'active' AFTER \`subscription_plan_id\`
      `);
      await query('ALTER TABLE `businesses` ADD INDEX `idx_businesses_sub_status` (`subscription_status`)');
      console.log('✅ Added `subscription_status` to businesses');
    }

    if (!(await checkColumn('businesses', 'subscription_start_date'))) {
      await query('ALTER TABLE `businesses` ADD COLUMN `subscription_start_date` DATETIME NULL AFTER `subscription_status`');
      console.log('✅ Added `subscription_start_date` to businesses');
    }

    if (!(await checkColumn('businesses', 'subscription_end_date'))) {
      await query('ALTER TABLE `businesses` ADD COLUMN `subscription_end_date` DATETIME NULL AFTER `subscription_start_date`');
      await query('ALTER TABLE `businesses` ADD INDEX `idx_businesses_sub_end` (`subscription_end_date`)');
      console.log('✅ Added `subscription_end_date` to businesses');
    }

    if (!(await checkColumn('businesses', 'owner_user_id'))) {
      await query('ALTER TABLE `businesses` ADD COLUMN `owner_user_id` INT NULL AFTER `subscription_end_date`');
      console.log('✅ Added `owner_user_id` to businesses');
    }

    if (!(await checkColumn('businesses', 'terms_accepted_version'))) {
      await query('ALTER TABLE `businesses` ADD COLUMN `terms_accepted_version` VARCHAR(20) NULL AFTER `owner_user_id`');
      console.log('✅ Added `terms_accepted_version` to businesses');
    }

    if (!(await checkColumn('businesses', 'terms_accepted_at'))) {
      await query('ALTER TABLE `businesses` ADD COLUMN `terms_accepted_at` DATETIME NULL AFTER `terms_accepted_version`');
      console.log('✅ Added `terms_accepted_at` to businesses');
    }

    if (!(await checkColumn('businesses', 'registration_notes'))) {
      await query('ALTER TABLE `businesses` ADD COLUMN `registration_notes` TEXT NULL AFTER `terms_accepted_at`');
      console.log('✅ Added `registration_notes` to businesses');
    }

    if (!(await checkColumn('businesses', 'rejection_reason'))) {
      await query('ALTER TABLE `businesses` ADD COLUMN `rejection_reason` TEXT NULL AFTER `registration_notes`');
      console.log('✅ Added `rejection_reason` to businesses');
    }

    // 3. Create subscription_payments table
    console.log('📦 Ensuring `subscription_payments` table exists...');
    await query(`
      CREATE TABLE IF NOT EXISTS \`subscription_payments\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`business_id\` INT NOT NULL,
        \`plan_id\` INT NOT NULL,
        \`amount\` DECIMAL(12, 2) NOT NULL,
        \`payment_method\` ENUM('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER') NOT NULL DEFAULT 'CASH',
        \`payment_reference\` VARCHAR(100) NULL,
        \`period_start\` DATETIME NOT NULL,
        \`period_end\` DATETIME NOT NULL,
        \`recorded_by_user_id\` INT NOT NULL,
        \`notes\` TEXT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sub_payments_business\` FOREIGN KEY (\`business_id\`) REFERENCES \`businesses\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_sub_payments_plan\` FOREIGN KEY (\`plan_id\`) REFERENCES \`subscription_plans\` (\`id\`),
        CONSTRAINT \`fk_sub_payments_recorded_by\` FOREIGN KEY (\`recorded_by_user_id\`) REFERENCES \`users\` (\`id\`),
        INDEX \`idx_sub_pay_business\` (\`business_id\`),
        INDEX \`idx_sub_pay_created\` (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Create platform_settings table
    console.log('📦 Ensuring `platform_settings` table exists...');
    await query(`
      CREATE TABLE IF NOT EXISTS \`platform_settings\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`platform_name\` VARCHAR(150) NOT NULL DEFAULT 'JM Solution POS',
        \`support_name\` VARCHAR(150) NOT NULL DEFAULT 'JM Solution Technical Team',
        \`support_phone\` VARCHAR(50) NOT NULL DEFAULT '+255 754 000 000',
        \`support_whatsapp\` VARCHAR(50) NOT NULL DEFAULT '+255 754 000 000',
        \`support_email\` VARCHAR(100) NOT NULL DEFAULT 'support@jmsolutions.co.tz',
        \`support_address\` VARCHAR(255) NOT NULL DEFAULT 'Dar es Salaam, Tanzania',
        \`terms_version\` VARCHAR(20) NOT NULL DEFAULT 'v1.0',
        \`terms_content\` TEXT NOT NULL,
        \`privacy_policy_version\` VARCHAR(20) NOT NULL DEFAULT 'v1.0',
        \`privacy_policy_content\` TEXT NULL,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`updated_by\` INT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Seed default platform settings if not present
    const existingSettings = await query('SELECT COUNT(*) as count FROM platform_settings');
    if (existingSettings[0].count === 0) {
      console.log('🌱 Seeding initial platform settings...');
      const defaultTerms = `TERMS AND CONDITIONS - JM SOLUTION POS (v1.0)
1. ACCEPTANCE OF TERMS: By accessing or using JM Solution POS, you agree to be bound by these terms.
2. SUBSCRIPTION & SERVICE: Access is provided under a valid subscription plan. Subscriptions must be renewed manually through the Technical Team prior to expiry.
3. DATA RESPONSIBILITY: Business owners are responsible for the accuracy of inventory records, sales transactions, and staff access credentials.
4. CREDENTIAL PRIVACY: You must keep your 6-digit access PIN confidential at all times.
5. MANUAL PAYMENT: All subscription fees are paid directly to authorized company accounts and verified manually by the Technical Team.
6. TERMINATION: Accounts with unpaid or expired subscriptions are subject to suspension until renewed.`;

      await query(`
        INSERT INTO \`platform_settings\` (
          \`platform_name\`, \`support_name\`, \`support_phone\`, \`support_whatsapp\`,
          \`support_email\`, \`support_address\`, \`terms_version\`, \`terms_content\`
        ) VALUES (
          'JM Solution POS',
          'JM Solution Technical Team',
          '+255 754 000 000',
          '+255 754 000 000',
          'support@jmsolutions.co.tz',
          'Mlimani City Commercial Complex, Dar es Salaam, Tanzania',
          'v1.0',
          ?
        )
      `, [defaultTerms]);
      console.log('✅ Initial platform settings seeded.');
    }

    // 5. Create payment_methods table (Configurable manual payment instructions)
    console.log('📦 Ensuring `payment_methods` table exists...');
    await query(`
      CREATE TABLE IF NOT EXISTS \`payment_methods\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(100) NOT NULL,
        \`type\` ENUM('MOBILE_MONEY', 'BANK_TRANSFER', 'CASH', 'OTHER') NOT NULL,
        \`account_name\` VARCHAR(150) NOT NULL,
        \`account_number\` VARCHAR(100) NOT NULL,
        \`instructions\` TEXT NOT NULL,
        \`is_active\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_paymethods_active\` (\`is_active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Seed default manual payment methods if empty
    const existingMethods = await query('SELECT COUNT(*) as count FROM payment_methods');
    if (existingMethods[0].count === 0) {
      console.log('🌱 Seeding initial payment methods...');
      await query(`
        INSERT INTO \`payment_methods\` (\`name\`, \`type\`, \`account_name\`, \`account_number\`, \`instructions\`, \`is_active\`)
        VALUES
          ('Vodacom M-Pesa (Lipa Namba)', 'MOBILE_MONEY', 'JM SOLUTIONS ENTERPRISES', '5522119', 'Go to Lipa kwa M-Pesa, choose Buy Goods / Lipa Hapa, enter Lipa Namba 5522119. Use your business name as reference.', TRUE),
          ('Airtel Money (Merchant)', 'MOBILE_MONEY', 'JM SOLUTIONS POS', '7744331', 'Enter Airtel Money menu, select Lipa Merchant, enter Till 7744331. Provide transaction ID to Technical Team.', TRUE),
          ('CRDB Bank Transfer', 'BANK_TRANSFER', 'JM SOLUTIONS COMPANY LTD', '0150992384700', 'Transfer via SimBanking or branch to CRDB Tower Branch. Send deposit confirmation slip to WhatsApp support.', TRUE),
          ('Cash at Office', 'CASH', 'JM SOLUTIONS CASHIER', 'OFFICE-DESK', 'Visit our main office during business hours (Mon-Sat 8:30 AM - 5:30 PM). Formal printed receipt provided.', TRUE)
      `);
      console.log('✅ Initial payment methods seeded.');
    }

    // 6. Create business_terms_acceptance table
    console.log('📦 Ensuring `business_terms_acceptance` table exists...');
    await query(`
      CREATE TABLE IF NOT EXISTS \`business_terms_acceptance\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`business_id\` INT NOT NULL,
        \`user_id\` INT NOT NULL,
        \`terms_version\` VARCHAR(20) NOT NULL,
        \`accepted_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_terms_business\` FOREIGN KEY (\`business_id\`) REFERENCES \`businesses\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_terms_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        INDEX \`idx_terms_business\` (\`business_id\`),
        INDEX \`idx_terms_user\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 7. Backfill existing active businesses with subscription plan & dates if unset
    console.log('🔄 Backfilling existing active businesses with default active subscription...');
    const defaultPlanRows = await query("SELECT id FROM subscription_plans WHERE plan_code = 'BUSINESS' LIMIT 1");
    const defaultPlanId = defaultPlanRows[0]?.id || 2;

    await query(`
      UPDATE \`businesses\`
      SET 
        \`subscription_plan_id\` = COALESCE(\`subscription_plan_id\`, ?),
        \`subscription_status\` = COALESCE(\`subscription_status\`, 'active'),
        \`subscription_start_date\` = COALESCE(\`subscription_start_date\`, NOW()),
        \`subscription_end_date\` = COALESCE(\`subscription_end_date\`, DATE_ADD(NOW(), INTERVAL 1 YEAR))
      WHERE \`subscription_plan_id\` IS NULL OR \`subscription_end_date\` IS NULL
    `, [defaultPlanId]);

    // Backfill owner_user_id for existing businesses from their first admin
    await query(`
      UPDATE \`businesses\` b
      JOIN (
        SELECT business_id, MIN(id) as admin_id
        FROM users
        WHERE role = 'admin'
        GROUP BY business_id
      ) u ON b.id = u.business_id
      SET b.owner_user_id = u.admin_id
      WHERE b.owner_user_id IS NULL
    `);

    console.log('✅ Migration completed successfully.');
    return true;
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  }
}

// Allow direct execution: `node src/scripts/migration-subscription-platform.js`
if (process.argv[1]?.endsWith('migration-subscription-platform.js')) {
  runSubscriptionPlatformMigration()
    .then(() => {
      console.log('🎉 Migration script completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('💥 Migration fatal error:', err);
      process.exit(1);
    });
}
