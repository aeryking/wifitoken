export const MICROS_PER_CNY = 1_000_000;

export function pricingPeriod(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour").value);
  const minute = Number(parts.find((part) => part.type === "minute").value);
  const current = hour * 60 + minute;
  return (current >= 9 * 60 && current < 12 * 60) ||
    (current >= 14 * 60 && current < 18 * 60) ? "peak" : "valley";
}

export function normalizeUsage(usage = {}) {
  const input = Math.max(0, Number(usage.prompt_tokens || 0));
  const hit = Math.max(0, Number(usage.prompt_cache_hit_tokens || 0));
  const explicitMiss = Number(usage.prompt_cache_miss_tokens);
  const miss = Number.isFinite(explicitMiss) ? Math.max(0, explicitMiss) : Math.max(0, input - hit);
  const output = Math.max(0, Number(usage.completion_tokens || 0));
  return { input, output, total: Math.max(0, Number(usage.total_tokens || input + output)), hit, miss };
}

export function calculateCharge(usage, rule) {
  const normalized = normalizeUsage(usage);
  const weighted = normalized.hit * Number(rule.cache_hit_microunit_per_million) +
    normalized.miss * Number(rule.cache_miss_microunit_per_million) +
    normalized.output * Number(rule.output_microunit_per_million);
  return { ...normalized, chargedMicrounit: Math.max(0, Math.round(weighted / 1_000_000)) };
}

export function isQuotaExhausted(card) {
  if (card.quota_type === "credit") {
    return Number(card.used_credit_microunit) >= Number(card.credit_limit_microunit);
  }
  return Number(card.used_tokens) >= Number(card.token_limit);
}
