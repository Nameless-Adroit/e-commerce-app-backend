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
