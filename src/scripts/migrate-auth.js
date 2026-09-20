/**
 * Idempotent Database Migration Script for Authentication, Sessions & Security
 * Safely alters tables and adds new tables without data loss.
 */
import { query, pool } from '../config/database.config.js';
import bcrypt from 'bcryptjs';

async function migrate() {
  console.log('🔄 Starting Authentication & Security Hardening Migration...');

  try {
    // 1. Inspect existing columns in users table
    const columns = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
    `);
    const existingCols = new Set(columns.map(c => c.COLUMN_NAME));

    if (!existingCols.has('phone_number')) {
      console.log('➕ Adding phone_number column to users...');
      await query(`ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) NULL UNIQUE COMMENT 'Normalized E.164 phone (+255XXXXXXXXX)' AFTER email`);
    }

    if (!existingCols.has('pin_hash')) {
      console.log('➕ Adding pin_hash column to users...');
      await query(`ALTER TABLE users ADD COLUMN pin_hash VARCHAR(255) NULL COMMENT 'Bcrypt hash of 4-6 digit staff PIN' AFTER password_hash`);
    }

    if (!existingCols.has('profile_image')) {
      console.log('➕ Adding profile_image column to users...');
      await query(`ALTER TABLE users ADD COLUMN profile_image VARCHAR(500) NULL COMMENT 'URL or asset path of profile image' AFTER pin_hash`);
    }

    if (!existingCols.has('failed_login_attempts')) {
      console.log('➕ Adding failed_login_attempts column to users...');
      await query(`ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0 COMMENT 'Counter for brute-force mitigation' AFTER temporary_password`);
    }

    if (!existingCols.has('locked_until')) {
      console.log('➕ Adding locked_until column to users...');
      await query(`ALTER TABLE users ADD COLUMN locked_until DATETIME NULL COMMENT 'Lockout expiration timestamp' AFTER failed_login_attempts`);
    }

    // Check index on phone_number
    const indexes = await query(`
      SHOW INDEX FROM users WHERE Key_name = 'idx_users_phone'
    `);
    if (indexes.length === 0) {
      console.log('➕ Creating index idx_users_phone on users...');
      await query(`CREATE INDEX idx_users_phone ON users (phone_number)`);
    }

    // 2. Create sessions table
    console.log('📦 Ensuring sessions table exists...');
    await query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(64) PRIMARY KEY COMMENT 'Unique cryptographic Session ID',
        user_id INT NOT NULL,
        token_family_id VARCHAR(64) NOT NULL COMMENT 'Tracks refresh token rotation family for reuse detection',
        refresh_token_hash VARCHAR(128) NOT NULL COMMENT 'SHA-256 hash of active refresh token',
        device_name VARCHAR(150) NULL,
        device_id VARCHAR(150) NULL,
        ip_address VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
        revoke_reason VARCHAR(100) NULL,
        expires_at DATETIME NOT NULL,
        last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        INDEX idx_sessions_user (user_id),
        INDEX idx_sessions_family (token_family_id),
        INDEX idx_sessions_token_hash (refresh_token_hash),
        INDEX idx_sessions_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3. Create security_logs table
    console.log('📦 Ensuring security_logs table exists...');
    await query(`
      CREATE TABLE IF NOT EXISTS security_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL COMMENT 'e.g. LOGIN_SUCCESS, LOGIN_FAILED, AUTH_LOCKOUT, TOKEN_REFRESH_REUSE',
        user_id INT NULL,
        identifier VARCHAR(100) NULL COMMENT 'Sanitized phone/username, NEVER passwords or tokens',
        ip_address VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        details JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sec_logs_event (event_type),
        INDEX idx_sec_logs_user (user_id),
        INDEX idx_sec_logs_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4. Create audit_logs table
    console.log('📦 Ensuring audit_logs table exists...');
    await query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        action VARCHAR(100) NOT NULL COMMENT 'e.g. USER_CREATED, USER_UPDATED, PRICE_CHANGED, BUSINESS_CLOSED',
        target_resource VARCHAR(100) NOT NULL,
        target_id VARCHAR(50) NULL,
        shop_id INT NULL,
        business_id INT NULL,
        changes JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_user (user_id),
        INDEX idx_audit_action (action),
        INDEX idx_audit_shop (shop_id),
        INDEX idx_audit_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5. Backfill existing known seed users if missing phone or PIN
    const defaultPinHash = await bcrypt.hash('1234', 10);
    const seedUserMap = {
      'superadmin': { phone: '+255700000001', pin: null },
      'admin_tech': { phone: '+255712100001', pin: defaultPinHash },
      'admin_metro': { phone: '+255712100002', pin: defaultPinHash },
      'seller_alice': { phone: '+255712200001', pin: defaultPinHash },
      'seller_bob': { phone: '+255712200002', pin: defaultPinHash },
      'seller_charlie': { phone: '+255712200003', pin: defaultPinHash }
    };

    for (const [uname, data] of Object.entries(seedUserMap)) {
      await query(
        `UPDATE users 
         SET phone_number = COALESCE(phone_number, ?), 
             pin_hash = COALESCE(pin_hash, ?) 
         WHERE username = ?`,
        [data.phone, data.pin, uname]
      );
    }

    console.log('✅ Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

migrate();
