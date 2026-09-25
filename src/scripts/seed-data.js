import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function seedDatabase() {
  console.log('🌱 Starting database seeding routine (ES Modules)...');

  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT, 10) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'pos_ecommerce_db';

  let connection;
  try {
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      multipleStatements: true
    });

    const seedPath = path.join(__dirname, '../../seed.sql');
    if (!fs.existsSync(seedPath)) {
      throw new Error(`seed.sql not found at ${seedPath}`);
    }

    // 1. Discover existing tables in the database
    const [tableRows] = await connection.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = ?
    `, [database]);
    const existingTables = new Set(tableRows.map(r => r.TABLE_NAME));

    // 2. Safely clear data from existing tables
    const tablesToClean = [
      'daily_reports', 'inventory_logs', 'transaction_items', 'transactions',
      'products', 'sessions', 'security_logs', 'users', 'shops', 'businesses'
    ];

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const tbl of tablesToClean) {
      if (existingTables.has(tbl)) {
        await connection.query(`TRUNCATE TABLE \`${tbl}\``);
      }
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    const seedSql = fs.readFileSync(seedPath, 'utf8');
    console.log('📦 Executing seed.sql statements...');

    await connection.query(seedSql);
    console.log('✅ Seeding completed successfully!');
    console.log('\nDefault credentials:');
    console.log('--------------------------------------------------');
    console.log('👑 Super Admin : superadmin / SuperAdmin123!');
    console.log('🏪 Shop 1 Admin: admin_tech / Admin123!');
    console.log('🏪 Shop 2 Admin: admin_metro / Admin123!');
    console.log('🛒 Shop 1 Seller: seller_alice / Seller123!');
    console.log('🛒 Shop 2 Seller: seller_charlie / Seller123!');
    console.log('--------------------------------------------------');
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

seedDatabase();
