import assert from "node:assert/strict";
import test from "node:test";
import { calculateCharge, isQuotaExhausted, normalizeUsage, pricingPeriod } from "./metering.js";

test("normalizes missing cache-miss field", () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 100, prompt_cache_hit_tokens: 30, completion_tokens: 20 }),
    { input: 100, output: 20, total: 120, hit: 30, miss: 70 });
});
test("calculates valley charge in micro-CNY", () => {
  const result = calculateCharge({ prompt_tokens: 1000, prompt_cache_hit_tokens: 500, prompt_cache_miss_tokens: 500, completion_tokens: 500 }, {
    cache_hit_microunit_per_million: 20000, cache_miss_microunit_per_million: 1000000, output_microunit_per_million: 2000000,
  });
  assert.equal(result.chargedMicrounit, 1510);
});
test("uses Beijing peak boundaries with an exclusive end", () => {
  assert.equal(pricingPeriod(new Date("2026-01-01T01:00:00Z")), "peak");
  assert.equal(pricingPeriod(new Date("2026-01-01T04:00:00Z")), "valley");
  assert.equal(pricingPeriod(new Date("2026-01-01T06:00:00Z")), "peak");
  assert.equal(pricingPeriod(new Date("2026-01-01T10:00:00Z")), "valley");
});
test("recognizes token and credit exhaustion", () => {
  assert.equal(isQuotaExhausted({ quota_type: "tokens", used_tokens: 1000, token_limit: 1000 }), true);
  assert.equal(isQuotaExhausted({ quota_type: "credit", used_credit_microunit: 19999, credit_limit_microunit: 20000 }), false);
});
