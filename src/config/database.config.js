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
export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log(`✅ Connected successfully to MySQL Database (${process.env.DB_NAME || 'pos_ecommerce_db'})`);

    // Ensure discount columns exist on transactions table
    try {
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'transactions' AND COLUMN_NAME IN ('subtotal_amount', 'discount_amount')
      `, [process.env.DB_NAME || 'pos_ecommerce_db']);

      const colNames = cols.map(c => c.COLUMN_NAME.toLowerCase());
      if (!colNames.includes('subtotal_amount')) {
        await connection.query('ALTER TABLE transactions ADD COLUMN subtotal_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00 AFTER seller_id');
        console.log('✅ Added subtotal_amount column to transactions table');
      }
      if (!colNames.includes('discount_amount')) {
        await connection.query('ALTER TABLE transactions ADD COLUMN discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00 AFTER subtotal_amount');
        console.log('✅ Added discount_amount column to transactions table');
      }

      // Ensure currency columns exist on shops table
      const [shopCols] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'shops' AND COLUMN_NAME IN ('currency_code', 'currency_symbol', 'currency_name')
      `, [process.env.DB_NAME || 'pos_ecommerce_db']);

      const shopColNames = shopCols.map(c => c.COLUMN_NAME.toLowerCase());
      if (!shopColNames.includes('currency_code')) {
        await connection.query("ALTER TABLE shops ADD COLUMN currency_code VARCHAR(10) NOT NULL DEFAULT 'TZS' AFTER phone");
        console.log('✅ Added currency_code column to shops table');
      }
      if (!shopColNames.includes('currency_symbol')) {
        await connection.query("ALTER TABLE shops ADD COLUMN currency_symbol VARCHAR(10) NOT NULL DEFAULT 'TSh' AFTER currency_code");
        console.log('✅ Added currency_symbol column to shops table');
      }
      if (!shopColNames.includes('currency_name')) {
        await connection.query("ALTER TABLE shops ADD COLUMN currency_name VARCHAR(50) NOT NULL DEFAULT 'Tanzanian Shilling' AFTER currency_symbol");
        console.log('✅ Added currency_name column to shops table');
      }
    } catch (migrationErr) {
      // Table may not exist yet if database hasn't been initialized
      console.warn('Schema check notice:', migrationErr.message);
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
