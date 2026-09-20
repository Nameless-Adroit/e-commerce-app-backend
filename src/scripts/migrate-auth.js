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
      await query(`ALTER TABLE users ADD COLUMN pin_hash VARCHAR(255) NULL COMMENT 'Bcrypt hash of 6-digit staff PIN' AFTER phone_number`);
    }

    if (!existingCols.has('profile_image')) {
      console.log('➕ Adding profile_image column to users...');
      await query(`ALTER TABLE users ADD COLUMN profile_image VARCHAR(500) NULL COMMENT 'URL or asset path of profile image' AFTER pin_hash`);
    }

    if (!existingCols.has('temporary_pin')) {
      console.log('➕ Adding temporary_pin column to users...');
      await query(`ALTER TABLE users ADD COLUMN temporary_pin BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Flags if user must change PIN on first login' AFTER profile_image`);
    }

    // Migrate old temporary_password values to temporary_pin if it existed
    if (existingCols.has('temporary_password')) {
      console.log('🔄 Migrating temporary_password to temporary_pin...');
      await query(`UPDATE users SET temporary_pin = temporary_password`);
      console.log('🗑️ Dropping legacy temporary_password column...');
      await query(`ALTER TABLE users DROP COLUMN temporary_password`);
    }

    // Drop legacy password_hash column if it exists
    if (existingCols.has('password_hash')) {
      console.log('🗑️ Dropping legacy password_hash column from users...');
      await query(`ALTER TABLE users DROP COLUMN password_hash`);
    }

    if (!existingCols.has('failed_login_attempts')) {
      console.log('➕ Adding failed_login_attempts column to users...');
      await query(`ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0 COMMENT 'Counter for brute-force mitigation' AFTER temporary_pin`);
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

    // 5. Create shop_requests table
    console.log('📦 Ensuring shop_requests table exists...');
    await query(`
      CREATE TABLE IF NOT EXISTS shop_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_id INT NOT NULL,
        requested_by_user_id INT NOT NULL,
        shop_code VARCHAR(20) NOT NULL,
        name VARCHAR(100) NOT NULL,
        address VARCHAR(255) NULL,
        phone VARCHAR(20) NULL,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        admin_notes TEXT NULL,
        super_admin_notes TEXT NULL,
        reviewed_by_user_id INT NULL,
        created_shop_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME NULL,
        CONSTRAINT fk_shop_req_business FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE,
        CONSTRAINT fk_shop_req_user FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE CASCADE,
        INDEX idx_shop_req_status (status),
        INDEX idx_shop_req_business (business_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 6. Standardize all seed users with 6-digit PIN (123456), full name, and verified phone numbers
    const pin6DigitHash = await bcrypt.hash('123456', 10);
    const seedUserMap = {
      'superadmin': { full_name: 'Alexander Cross', phone: '+255700000001', pin: pin6DigitHash, temp_pin: 0 },
      'admin_tech': { full_name: 'Marcus Vance', phone: '+255712100001', pin: pin6DigitHash, temp_pin: 0 },
      'admin_metro': { full_name: 'Elena Rostova', phone: '+255712100002', pin: pin6DigitHash, temp_pin: 0 },
      'seller_alice': { full_name: 'Alice Morgan', phone: '+255712200001', pin: pin6DigitHash, temp_pin: 0 },
      'seller_bob': { full_name: 'Bob Kendrick', phone: '+255712200002', pin: pin6DigitHash, temp_pin: 0 },
      'seller_charlie': { full_name: 'Charlie Dupont', phone: '+255712200003', pin: pin6DigitHash, temp_pin: 0 }
    };

    for (const [uname, data] of Object.entries(seedUserMap)) {
      await query(
        `UPDATE users 
         SET full_name = ?,
             phone_number = ?, 
             pin_hash = ?,
             temporary_pin = ?
         WHERE username = ?`,
        [data.full_name, data.phone, data.pin, data.temp_pin, uname]
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
