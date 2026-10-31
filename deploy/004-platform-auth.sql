-- Run once after schema.sql, 002-metering.sql, and 003-quota-runtime.sql.
-- Password hashes use Node's scrypt format; no
-- plaintext credentials are stored here.
USE tokenrouter;

CREATE TABLE IF NOT EXISTS merchants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_code VARCHAR(128) NOT NULL UNIQUE,
  merchant_name VARCHAR(160) NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','merchant') NOT NULL,
  merchant_id BIGINT UNSIGNED NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  password_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_users_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  CONSTRAINT chk_merchant_user CHECK ((role='admin' AND merchant_id IS NULL) OR (role='merchant' AND merchant_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS login_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_hash BINARY(32) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sessions_user_expiry (user_id,expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE routers ADD COLUMN merchant_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_routers_merchant (merchant_id),
  ADD CONSTRAINT fk_routers_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id);
