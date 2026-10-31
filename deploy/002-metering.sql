USE tokenrouter;

CREATE TABLE IF NOT EXISTS models (
  model_id VARCHAR(80) PRIMARY KEY,
  model_name VARCHAR(160) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS model_price_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  model_id VARCHAR(80) NOT NULL,
  period_name ENUM('valley','peak') NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  cache_hit_microunit_per_million BIGINT UNSIGNED NOT NULL,
  cache_miss_microunit_per_million BIGINT UNSIGNED NOT NULL,
  output_microunit_per_million BIGINT UNSIGNED NOT NULL,
  effective_from DATETIME(3) NOT NULL,
  effective_to DATETIME(3) NULL,
  UNIQUE KEY uq_price_period (model_id,period_name,start_time,effective_from),
  CONSTRAINT fk_price_model FOREIGN KEY (model_id) REFERENCES models(model_id)
);

ALTER TABLE api_keys
  ADD COLUMN quota_type ENUM('tokens','credit') NOT NULL DEFAULT 'tokens',
  ADD COLUMN token_limit BIGINT UNSIGNED NULL,
  ADD COLUMN credit_limit_microunit BIGINT UNSIGNED NULL,
  ADD COLUMN used_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN used_credit_microunit BIGINT UNSIGNED NOT NULL DEFAULT 0;

ALTER TABLE usage_events
  ADD COLUMN model_name VARCHAR(160) NULL,
  ADD COLUMN pricing_period ENUM('valley','peak') NULL,
  ADD COLUMN prompt_cache_hit_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN prompt_cache_miss_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN charged_microunit BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN price_rule_id BIGINT UNSIGNED NULL;

INSERT INTO models (model_id,model_name,provider,currency,enabled)
VALUES ('deepseek-v4-flash','DeepSeek V4 Flash','DeepSeek','CNY',1)
ON DUPLICATE KEY UPDATE model_name=VALUES(model_name),enabled=VALUES(enabled);

-- 历史测试配置示例，不代表当前官方价格。实际接入前须核实并配置。
INSERT INTO model_price_rules (model_id,period_name,timezone,start_time,end_time,cache_hit_microunit_per_million,cache_miss_microunit_per_million,output_microunit_per_million,effective_from)
SELECT 'deepseek-v4-flash','valley','Asia/Shanghai','00:00:00','23:59:59',20000,1000000,2000000,NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM model_price_rules WHERE model_id='deepseek-v4-flash' AND period_name='valley' AND effective_to IS NULL);

-- 峰时段采用 2 倍规则（09:00-12:00、14:00-18:00）；是否启用由运营配置决定，历史用量始终保存命中的规则快照。
INSERT INTO model_price_rules (model_id,period_name,timezone,start_time,end_time,cache_hit_microunit_per_million,cache_miss_microunit_per_million,output_microunit_per_million,effective_from)
SELECT 'deepseek-v4-flash','peak','Asia/Shanghai','09:00:00','12:00:00',40000,2000000,4000000,NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM model_price_rules WHERE model_id='deepseek-v4-flash' AND period_name='peak' AND start_time='09:00:00' AND effective_to IS NULL);
INSERT INTO model_price_rules (model_id,period_name,timezone,start_time,end_time,cache_hit_microunit_per_million,cache_miss_microunit_per_million,output_microunit_per_million,effective_from)
SELECT 'deepseek-v4-flash','peak','Asia/Shanghai','14:00:00','18:00:00',40000,2000000,4000000,NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM model_price_rules WHERE model_id='deepseek-v4-flash' AND period_name='peak' AND start_time='14:00:00' AND effective_to IS NULL);
