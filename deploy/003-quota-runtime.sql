USE tokenrouter;

ALTER TABLE api_keys
  MODIFY COLUMN status ENUM('active','revoked','expired','exhausted') NOT NULL DEFAULT 'active',
  ADD COLUMN exhausted_at DATETIME(3) NULL;

ALTER TABLE usage_events
  ADD COLUMN upstream_status SMALLINT UNSIGNED NULL;
