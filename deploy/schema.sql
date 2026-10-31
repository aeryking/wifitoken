CREATE DATABASE IF NOT EXISTS tokenrouter CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
USE tokenrouter;

CREATE TABLE IF NOT EXISTS routers (
  router_id VARCHAR(128) PRIMARY KEY,
  control_token_hash BINARY(32) NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  config_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  key_hash BINARY(32) NOT NULL UNIQUE,
  key_prefix VARCHAR(20) NOT NULL,
  router_id VARCHAR(128) NOT NULL,
  status ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,
  request_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_router_status (router_id,status),
  INDEX idx_expiry (expires_at),
  CONSTRAINT fk_api_keys_router FOREIGN KEY (router_id) REFERENCES routers(router_id)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  api_key_id BIGINT UNSIGNED NOT NULL,
  request_id CHAR(36) NOT NULL,
  model VARCHAR(80) NOT NULL,
  input_tokens BIGINT UNSIGNED NULL,
  output_tokens BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_request (request_id),
  INDEX idx_key_time (api_key_id,created_at),
  CONSTRAINT fk_usage_key FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);
