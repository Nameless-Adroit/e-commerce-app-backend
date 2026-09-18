import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pos_ecommerce_db',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true
});

/**
 * Execute a query with standard parameters
 */
export async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Executes a callback within a managed ACID database transaction.
 * Automatically performs COMMIT if callback succeeds, or ROLLBACK if an error is thrown.
 * 
 * @param {Function} callback - async (connection) => { ... }
 */
export async function executeTransaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Test the database connection
 */
/**
 * Test the database connection and execute non-destructive auto-migrations
 */
export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    const dbName = process.env.DB_NAME || 'pos_ecommerce_db';
    console.log(`✅ Connected successfully to MySQL Database (${dbName})`);

    try {
      // 1. Create businesses table if it does not exist
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`businesses\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`business_code\` VARCHAR(20) NOT NULL UNIQUE COMMENT 'Unique identifier prefix (e.g. BIZ01)',
          \`name\` VARCHAR(150) NOT NULL COMMENT 'Business Display Name',
          \`currency_code\` VARCHAR(10) NOT NULL DEFAULT 'TZS' COMMENT 'Base currency ISO code (e.g. TZS, USD, KES)',
          \`currency_symbol\` VARCHAR(10) NOT NULL DEFAULT 'TSh' COMMENT 'Currency display symbol (e.g. TSh, $, KSh)',
          \`currency_name\` VARCHAR(50) NOT NULL DEFAULT 'Tanzanian Shilling' COMMENT 'Full currency name',
          \`status\` ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX \`idx_businesses_status\` (\`status\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Helper to check column existence
      const checkColumn = async (tableName, colName) => {
        const [rows] = await connection.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
        `, [dbName, tableName, colName]);
        return rows.length > 0;
      };

      // 2. Ensure business_id exists on shops
      if (!(await checkColumn('shops', 'business_id'))) {
        await connection.query('ALTER TABLE shops ADD COLUMN business_id INT NULL AFTER id');
        await connection.query('ALTER TABLE shops ADD INDEX idx_shops_business (business_id)');
        console.log('✅ Added business_id column to shops table');
      }

      // Ensure currency columns exist on shops table
      if (!(await checkColumn('shops', 'currency_code'))) {
        await connection.query("ALTER TABLE shops ADD COLUMN currency_code VARCHAR(10) NOT NULL DEFAULT 'TZS' AFTER phone");
        console.log('✅ Added currency_code column to shops table');
      }
      if (!(await checkColumn('shops', 'currency_symbol'))) {
        await connection.query("ALTER TABLE shops ADD COLUMN currency_symbol VARCHAR(10) NOT NULL DEFAULT 'TSh' AFTER currency_code");
        console.log('✅ Added currency_symbol column to shops table');
      }
      if (!(await checkColumn('shops', 'currency_name'))) {
        await connection.query("ALTER TABLE shops ADD COLUMN currency_name VARCHAR(50) NOT NULL DEFAULT 'Tanzanian Shilling' AFTER currency_symbol");
        console.log('✅ Added currency_name column to shops table');
      }

      // 3. Ensure business_id and temporary_password exist on users
      if (!(await checkColumn('users', 'business_id'))) {
        await connection.query('ALTER TABLE users ADD COLUMN business_id INT NULL AFTER role');
        await connection.query('ALTER TABLE users ADD INDEX idx_users_business (business_id)');
        console.log('✅ Added business_id column to users table');
      }
      if (!(await checkColumn('users', 'temporary_password'))) {
        await connection.query('ALTER TABLE users ADD COLUMN temporary_password BOOLEAN NOT NULL DEFAULT FALSE AFTER password_hash');
        console.log('✅ Added temporary_password column to users table');
      }

      // 4. Ensure discount and original_transaction_id columns exist on transactions table
      if (!(await checkColumn('transactions', 'subtotal_amount'))) {
        await connection.query('ALTER TABLE transactions ADD COLUMN subtotal_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00 AFTER seller_id');
        console.log('✅ Added subtotal_amount column to transactions table');
      }
      if (!(await checkColumn('transactions', 'discount_amount'))) {
        await connection.query('ALTER TABLE transactions ADD COLUMN discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00 AFTER subtotal_amount');
        console.log('✅ Added discount_amount column to transactions table');
      }
      if (!(await checkColumn('transactions', 'original_transaction_id'))) {
        await connection.query('ALTER TABLE transactions ADD COLUMN original_transaction_id VARCHAR(50) NULL AFTER status');
        await connection.query('ALTER TABLE transactions ADD INDEX idx_transactions_original (original_transaction_id)');
        console.log('✅ Added original_transaction_id column to transactions table');
      }

      // 5. Backfill/Migrate existing records into Business hierarchy if businesses is empty
      const [existingBiz] = await connection.query('SELECT COUNT(*) as count FROM businesses');
      if (existingBiz[0].count === 0) {
        console.log('🔄 Initializing default businesses for existing shops...');
        
        // Business 1: Tech & Electronics
        const [biz1Res] = await connection.query(`
          INSERT INTO businesses (business_code, name, currency_code, currency_symbol, currency_name, status)
          VALUES ('BIZ01', 'Apex Commerce & Tech Group', 'TZS', 'TSh', 'Tanzanian Shilling', 'active')
        `);
        const biz1Id = biz1Res.insertId;

        // Business 2: Fashion & Retail
        const [biz2Res] = await connection.query(`
          INSERT INTO businesses (business_code, name, currency_code, currency_symbol, currency_name, status)
          VALUES ('BIZ02', 'Elena Fashion & Retail Group', 'TZS', 'TSh', 'Tanzanian Shilling', 'active')
        `);
        const biz2Id = biz2Res.insertId;

        // Assign Shop 1 to Business 1, Shop 2 to Business 2
        await connection.query('UPDATE shops SET business_id = ? WHERE id = 1', [biz1Id]);
        await connection.query('UPDATE shops SET business_id = ? WHERE id = 2', [biz2Id]);
        // For any other shops with NULL business_id, attach to biz1Id as fallback
        await connection.query('UPDATE shops SET business_id = ? WHERE business_id IS NULL', [biz1Id]);

        // Link Users:
        // Admin tech -> Business 1 (owns business, shop_id becomes NULL)
        await connection.query("UPDATE users SET business_id = ?, shop_id = NULL WHERE username = 'admin_tech'", [biz1Id]);
        // Admin metro -> Business 2 (owns business, shop_id becomes NULL)
        await connection.query("UPDATE users SET business_id = ?, shop_id = NULL WHERE username = 'admin_metro'", [biz2Id]);
        // General admin fallback:
        await connection.query(`
          UPDATE users u
          JOIN shops s ON u.shop_id = s.id
          SET u.business_id = s.business_id, u.shop_id = NULL
          WHERE u.role = 'admin' AND u.business_id IS NULL
        `);

        // Sellers: assign business_id based on their shop_id
        await connection.query(`
          UPDATE users u
          JOIN shops s ON u.shop_id = s.id
          SET u.business_id = s.business_id
          WHERE u.role = 'seller' AND u.business_id IS NULL
        `);

        console.log('✅ Backfill complete: shops and users migrated into Business hierarchy.');
      }

    } catch (migrationErr) {
      console.warn('Schema migration notice:', migrationErr.message);
    }

    connection.release();
    return true;
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
    return false;
  }
}

export default {
  pool,
  query,
  executeTransaction,
  testConnection
};
