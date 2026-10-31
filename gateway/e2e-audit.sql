USE wifitoken;

SELECT quota_type,status,COUNT(*) AS cards,SUM(request_count) AS requests,
       SUM(used_tokens) AS tokens,SUM(used_credit_microunit) AS charged_microunit
  FROM api_keys WHERE router_id LIKE 'E2E-%' GROUP BY quota_type,status ORDER BY quota_type;

SELECT COUNT(*) AS cards,
       SUM(status<>'exhausted') AS not_exhausted,
       SUM(quota_type='tokens' AND used_tokens<token_limit) AS premature_token_exhaustion,
       SUM(quota_type='credit' AND used_credit_microunit<credit_limit_microunit) AS premature_credit_exhaustion,
       SUM(OCTET_LENGTH(key_hash)<>32) AS invalid_hashes
  FROM api_keys WHERE router_id LIKE 'E2E-%';

SELECT COUNT(*) AS usage_events,COUNT(DISTINCT ue.request_id) AS unique_request_ids,
       SUM(ue.prompt_cache_hit_tokens) AS cache_hit_tokens,
       SUM(ue.prompt_cache_miss_tokens) AS cache_miss_tokens,
       SUM(ue.output_tokens) AS output_tokens,SUM(ue.charged_microunit) AS charged_microunit,
       GROUP_CONCAT(DISTINCT ue.pricing_period ORDER BY ue.pricing_period) AS pricing_periods
  FROM usage_events ue JOIN api_keys k ON k.id=ue.api_key_id WHERE k.router_id LIKE 'E2E-%';
