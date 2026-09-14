import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function initDatabase() {
  console.log('🔄 Initializing MySQL Database for POS & E-Commerce (ES Modules)...');

  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT, 10) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'pos_ecommerce_db';

  let connection;
  try {
    // 1. Connect to MySQL server without specific database first
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      multipleStatements: true
    });

    console.log(`🔌 Connected to MySQL server at ${host}:${port}`);

    // 2. Read schema.sql
    const schemaPath = path.join(__dirname, '../../schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`schema.sql not found at ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    console.log('📜 Executing schema.sql...');

    await connection.query(schemaSql);
    console.log('✅ Database schema created successfully!');

    // 3. Prompt or auto-run seed data
    const seedPath = path.join(__dirname, '../../seed.sql');
    if (fs.existsSync(seedPath)) {
      console.log('🌱 Populating database with seed.sql...');
      const seedSql = fs.readFileSync(seedPath, 'utf8');
      await connection.query(seedSql);
      console.log('✅ Seed data inserted successfully!');
    }

    console.log('\n🎉 Database initialization complete!');
    console.log(`Database '${database}' is ready for use.`);
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
    if (err.code === 'ECONNREFUSED') {
      console.error(`\n⚠️  Make sure your MySQL server (e.g. WAMP, XAMPP, or standalone MySQL) is running on port ${port}`);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

initDatabase();
