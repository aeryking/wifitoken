import assert from "node:assert/strict";

const origin = process.env.TEST_BASE_URL;
if (!origin) throw new Error("TEST_BASE_URL is required; only run against an authorized test deployment");
const controlToken = process.env.TOKEN_ROUTER_ADMIN_TOKEN;
if (!controlToken) throw new Error("TOKEN_ROUTER_ADMIN_TOKEN is required");
const runId = Date.now().toString(36);

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(120_000), ...options });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { response, body };
}

async function issue(routerId, quotaType, count) {
  const limits = quotaType === "tokens" ? { token_limit: 1000 } : { credit_limit_microunit: 20000 };
  const { response, body } = await jsonFetch("/admin/cards", {
    method: "POST", headers: { "content-type": "application/json", "x-router-control-token": controlToken },
    body: JSON.stringify({ router_id: routerId, count, quota_type: quotaType, ttl_hours: 24, ...limits }),
  });
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.cards.length, count);
  return body.cards;
}

function parseSse(text) {
  let content = ""; let usage = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const item = JSON.parse(line.slice(6));
    content += item.choices?.[0]?.delta?.content || "";
    if (item.usage) usage = item.usage;
  }
  return { content, usage };
}

async function completion(key, messages, { stream = false, long = false } = {}) {
  const response = await fetch(`${origin}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(180_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-v4-flash", messages, stream,
      max_tokens: long ? 1200 : 280, temperature: 0.2,
      thinking: { type: "disabled" },
    }),
  });
  const text = await response.text();
  if (response.status !== 200) {
    let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: response.status, body };
  }
  const parsed = stream ? parseSse(text) : JSON.parse(text);
  const usage = stream ? parsed.usage : parsed.usage;
  const content = stream ? parsed.content : parsed.choices?.[0]?.message?.content || "";
  assert.ok(usage?.total_tokens > 0, "successful request must include usage");
  return { status: 200, usage, content };
}

async function exhaustCard(card, index, quotaType) {
  const messages = [{ role: "system", content: "你是配额测试助手。严格按用户要求输出，不要使用 Markdown。" }];
  let successes = 0; let lastUsage = null;
  for (let round = 1; round <= (quotaType === "tokens" ? 20 : 30); round += 1) {
    messages.push({
      role: "user",
      content: quotaType === "tokens"
        ? `这是多轮测试 ${index}-${round}。请用约180个汉字继续一个虚构故事。`
        : `这是多轮测试 ${index}-${round}。请用约900个汉字写一段虚构故事，长度必须接近要求。`,
    });
    const result = await completion(card.api_key, messages.slice(-7), { stream: index === 0 && round === 1, long: quotaType === "credit" });
    if (result.status === 402) {
      assert.equal(result.body.error, "quota_exhausted");
      assert.ok(successes >= 2, "must be a multi-turn session");
      if (quotaType === "tokens") assert.ok(result.body.used_tokens >= result.body.token_limit, "token card exhausted too early");
      else assert.ok(result.body.used_credit_microunit >= result.body.credit_limit_microunit, "credit card exhausted too early");
      return { successes, rejection: result.body, lastUsage };
    }
    assert.equal(result.status, 200, JSON.stringify(result.body));
    successes += 1; lastUsage = result.usage;
    messages.push({ role: "assistant", content: result.content || "已完成本轮。" });
  }
  throw new Error(`${quotaType} card ${index} did not exhaust within the safety limit`);
}

const missing = await jsonFetch("/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
assert.equal(missing.response.status, 401);

const tokenCards = await issue(`E2E-TOKEN-${runId}`, "tokens", 5);
const creditCards = await issue(`E2E-CREDIT-${runId}`, "credit", 5);
const results = [];
for (let i = 0; i < tokenCards.length; i += 1) results.push({ type: "tokens", index: i, ...(await exhaustCard(tokenCards[i], i, "tokens")) });
for (let i = 0; i < creditCards.length; i += 1) results.push({ type: "credit", index: i, ...(await exhaustCard(creditCards[i], i, "credit")) });

for (const [index, card] of [...tokenCards, ...creditCards].entries()) {
  const again = await completion(card.api_key, [{ role: "user", content: "额度用完后不应再调用。" }]);
  assert.equal(again.status, 402, `card ${index} must remain exhausted`);
}

const summary = results.map(({ type, index, successes, rejection }) => ({
  type, card: index + 1, successful_rounds: successes,
  used_tokens: rejection.used_tokens, used_credit_microunit: rejection.used_credit_microunit,
  limit: type === "tokens" ? rejection.token_limit : rejection.credit_limit_microunit,
  next_request_status: 402,
}));
console.log(JSON.stringify({ ok: true, run_id: runId, cards: summary }, null, 2));
