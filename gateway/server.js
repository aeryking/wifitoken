import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { calculateCharge, isQuotaExhausted, pricingPeriod } from "./metering.js";

const require = createRequire(import.meta.url);
const mysql = require(process.env.MYSQL2_MODULE || "mysql2/promise");
const port = Number(process.env.PORT || 19080);
const host = process.env.HOST || "127.0.0.1";
const upstreamBase = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const upstreamKey = process.env.DEEPSEEK_API_KEY;
const routerControlToken = process.env.ROUTER_CONTROL_TOKEN;
const bootstrapAdminPassword = process.env.TOKEN_ROUTER_ADMIN_TOKEN;
const publicProxyUrl = process.env.PUBLIC_PROXY_URL || "https://gateway.example.com/v1";
const cookiePath = process.env.COOKIE_PATH || "/";
const database = process.env.WIFITOKEN_DATABASE || "tokenrouter";
const defaultModel = process.env.DEFAULT_MODEL || "deepseek-v4-flash";
const adminHtml = fs.readFileSync(new URL("./admin.html", import.meta.url), "utf8");
if (!upstreamKey || !routerControlToken || !bootstrapAdminPassword || !process.env.MYSQL_HOST) {
  throw new Error("DEEPSEEK_API_KEY, ROUTER_CONTROL_TOKEN, TOKEN_ROUTER_ADMIN_TOKEN and MYSQL_HOST are required");
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 20),
  enableKeepAlive: true,
});

const locks = new Map();
const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_MS = 12 * 3600e3;
function withKeyLock(key, operation) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(key, current);
  return current.finally(() => { if (locks.get(key) === current) locks.delete(key); });
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest(); }
function bearer(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}
function constantEquals(left, right) {
  const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = (await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString("base64url");
  return `scrypt$16384$8$1$${salt}$${hash}`;
}
async function passwordMatches(password, stored) {
  const [kind, n, r, p, salt, expected] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !expected) return false;
  const actual = await scrypt(password, salt, 32, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  const expectedBytes = Buffer.from(expected, "base64url");
  return actual.length === expectedBytes.length && crypto.timingSafeEqual(actual, expectedBytes);
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((item) => item.trim().split("=")).filter((pair) => pair.length === 2));
}
async function principal(req) {
  // Kept only as an emergency server-to-server operation path; browser login
  // uses database users and never receives this bootstrap value.
  if (constantEquals(req.headers["x-router-control-token"], bootstrapAdminPassword)) return { id: 0, username: "emergency", role: "admin", merchant_id: null };
  const raw = cookies(req).tr_admin;
  if (!raw || raw.length < 32) return null;
  const [rows] = await pool.execute(
    `SELECT u.id,u.username,u.role,u.merchant_id,u.status,m.status merchant_status
       FROM login_sessions s JOIN users u ON u.id=s.user_id
       LEFT JOIN merchants m ON m.id=u.merchant_id
      WHERE s.session_hash=? AND s.expires_at>NOW(3) LIMIT 1`, [sha256(raw)],
  );
  const user = rows[0];
  if (!user || user.status !== "active" || (user.role === "merchant" && user.merchant_status !== "active")) return null;
  await pool.execute("UPDATE login_sessions SET last_seen_at=NOW(3),expires_at=DATE_ADD(NOW(3),INTERVAL 12 HOUR) WHERE session_hash=?", [sha256(raw)]);
  return user;
}
async function requirePrincipal(req, res) {
  const user = await principal(req);
  if (!user) { send(res, 401, { error: "authentication_required" }); return null; }
  return user;
}
function requireAdmin(user, res) {
  if (user.role === "admin") return true;
  send(res, 403, { error: "admin_required" }); return false;
}
function tenantWhere(user, alias = "r") {
  return user.role === "merchant" ? { sql: ` AND ${alias}.merchant_id=?`, params: [user.merchant_id] } : { sql: "", params: [] };
}
function adminPage(res) {
  const nonce = crypto.randomBytes(18).toString("base64url");
  const html = adminHtml.replaceAll("__NONCE__", nonce);
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "content-security-policy": `default-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'`,
    "x-frame-options": "DENY", "x-content-type-options": "nosniff",
  });
  res.end(html);
}
async function readJson(req, maxBytes = 4 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}
function validId(value) { return /^[A-Za-z0-9._-]{4,128}$/.test(value); }
function validUsername(value) { return /^[A-Za-z0-9._-]{3,64}$/.test(value); }
function boundedNumber(value, fallback, min, max, name) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw Object.assign(new Error(`invalid ${name}`), { status: 400 });
  }
  return number;
}

async function ensureRouter(routerId) {
  await pool.execute(
    `INSERT INTO routers (router_id,control_token_hash,status,last_seen_at)
     VALUES (?,?,'active',NOW(3)) ON DUPLICATE KEY UPDATE last_seen_at=NOW(3)`,
    [routerId, sha256(routerControlToken)],
  );
}
async function issueCard(routerId, options = {}) {
  const quotaType = options.quota_type === "credit" ? "credit" : "tokens";
  if (options.quota_type != null && !["tokens", "credit"].includes(options.quota_type)) {
    throw Object.assign(new Error("invalid quota_type"), { status: 400 });
  }
  const tokenLimit = quotaType === "tokens"
    ? Math.trunc(boundedNumber(options.token_limit, 1_000_000, 1, 1_000_000_000_000, "token_limit")) : null;
  const creditLimit = quotaType === "credit"
    ? Math.trunc(boundedNumber(options.credit_limit_microunit, 20_000, 1, 1_000_000_000_000, "credit_limit_microunit")) : null;
  const ttlHours = boundedNumber(options.ttl_hours, 24, 1 / 60, 24 * 365, "ttl_hours");
  const secret = `tr_live_${crypto.randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + ttlHours * 3600e3);
  await ensureRouter(routerId);
  await pool.execute(
    `INSERT INTO api_keys
      (key_hash,key_prefix,router_id,status,expires_at,quota_type,token_limit,credit_limit_microunit)
     VALUES (?,?,?,'active',?,?,?,?)`,
    [sha256(secret), secret.slice(0, 16), routerId, expiresAt, quotaType, tokenLimit, creditLimit],
  );
  return { api_key: secret, expires_at: expiresAt.toISOString(), quota_type: quotaType, token_limit: tokenLimit, credit_limit_microunit: creditLimit };
}
async function loadCard(secret) {
  const [rows] = await pool.execute(
    `SELECT id,router_id,status,expires_at,quota_type,token_limit,credit_limit_microunit,
            used_tokens,used_credit_microunit,request_count
       FROM api_keys WHERE key_hash=? LIMIT 1`, [sha256(secret)],
  );
  return rows[0] || null;
}
function quotaError(card) {
  return {
    error: "quota_exhausted", message: "临时 Token 已用完",
    quota_type: card.quota_type, used_tokens: Number(card.used_tokens),
    token_limit: card.token_limit == null ? null : Number(card.token_limit),
    used_credit_microunit: Number(card.used_credit_microunit),
    credit_limit_microunit: card.credit_limit_microunit == null ? null : Number(card.credit_limit_microunit),
  };
}
async function activeCardOrResponse(secret, res) {
  const card = await loadCard(secret);
  if (!card) { send(res, 401, { error: "invalid_api_key" }); return null; }
  if (new Date(card.expires_at).getTime() <= Date.now()) {
    await pool.execute("UPDATE api_keys SET status='expired' WHERE id=? AND status='active'", [card.id]);
    send(res, 401, { error: "expired_api_key" }); return null;
  }
  if (card.status === "exhausted" || isQuotaExhausted(card)) {
    if (card.status === "active") await pool.execute("UPDATE api_keys SET status='exhausted',exhausted_at=NOW(3) WHERE id=?", [card.id]);
    send(res, 402, quotaError(card)); return null;
  }
  if (card.status !== "active") { send(res, 401, { error: `api_key_${card.status}` }); return null; }
  return card;
}
async function priceRule(model, period) {
  const [rows] = await pool.execute(
    `SELECT p.*,m.model_name FROM model_price_rules p JOIN models m ON m.model_id=p.model_id
      WHERE p.model_id=? AND p.period_name=? AND p.effective_from<=NOW(3)
        AND (p.effective_to IS NULL OR p.effective_to>NOW(3))
      ORDER BY p.effective_from DESC LIMIT 1`, [model, period],
  );
  return rows[0] || null;
}
async function recordUsage(card, requestId, model, upstreamStatus, usage, startedAt) {
  if (!usage) return;
  const period = pricingPeriod(startedAt);
  const rule = await priceRule(model, period);
  if (!rule) throw new Error(`no active price rule for ${model}/${period}`);
  const metered = calculateCharge(usage, rule);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [currentRows] = await conn.execute(
      `SELECT quota_type,token_limit,credit_limit_microunit,used_tokens,used_credit_microunit
         FROM api_keys WHERE id=? FOR UPDATE`, [card.id],
    );
    if (!currentRows[0]) throw new Error("api key disappeared during metering");
    const current = currentRows[0];
    const nextTokens = Number(current.used_tokens) + metered.total;
    const nextCredit = Number(current.used_credit_microunit) + metered.chargedMicrounit;
    const exhausted = current.quota_type === "tokens"
      ? nextTokens >= Number(current.token_limit)
      : nextCredit >= Number(current.credit_limit_microunit);
    await conn.execute(
      `INSERT INTO usage_events
       (api_key_id,request_id,model,model_name,input_tokens,output_tokens,pricing_period,
        prompt_cache_hit_tokens,prompt_cache_miss_tokens,charged_microunit,price_rule_id,upstream_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [card.id, requestId, model, rule.model_name, metered.input, metered.output, period,
       metered.hit, metered.miss, metered.chargedMicrounit, rule.id, upstreamStatus],
    );
    await conn.execute(
      `UPDATE api_keys SET request_count=request_count+1,last_used_at=NOW(3),
       used_tokens=?,used_credit_microunit=?,status=?,
       exhausted_at=CASE WHEN ? THEN COALESCE(exhausted_at,NOW(3)) ELSE exhausted_at END
       WHERE id=?`,
      [nextTokens, nextCredit, exhausted ? "exhausted" : "active", exhausted, card.id],
    );
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
function usageFromSse(text) {
  let found = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try { const parsed = JSON.parse(line.slice(6)); if (parsed.usage) found = parsed.usage; } catch {}
  }
  return found;
}

async function proxyCompletion(req, res, url, card) {
  const startedAt = new Date();
  const body = await readJson(req);
  const model = String(body.model || defaultModel);
  if (model !== defaultModel) return send(res, 400, { error: "unsupported_model", allowed_model: defaultModel });
  if (!Array.isArray(body.messages) || body.messages.length === 0) return send(res, 400, { error: "messages_required" });
  if (body.stream) body.stream_options = { ...(body.stream_options || {}), include_usage: true };
  // The metering ID is server-generated. A client-controlled idempotency key
  // must never be able to collide with an existing usage event and roll back billing.
  const requestId = crypto.randomUUID();
  const upstream = await fetch(`${upstreamBase}${url.pathname}${url.search}`, {
    method: "POST", headers: { authorization: `Bearer ${upstreamKey}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const contentType = upstream.headers.get("content-type") || "application/json";
  res.writeHead(upstream.status, { "content-type": contentType, "cache-control": "no-store", "x-request-id": requestId });
  const chunks = [];
  if (upstream.body) for await (const chunk of upstream.body) { const buffer = Buffer.from(chunk); chunks.push(buffer); res.write(buffer); }
  res.end();
  if (!upstream.ok) return;
  const responseText = Buffer.concat(chunks).toString("utf8");
  let usage = null;
  try { usage = body.stream ? usageFromSse(responseText) : JSON.parse(responseText).usage; } catch {}
  await recordUsage(card, requestId, model, upstream.status, usage, startedAt);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://token-router.local");
    if (req.method === "GET" && url.pathname === "/health") {
      await pool.query("SELECT 1"); return send(res, 200, { ok: true, database: true });
    }
    if (req.method === "GET" && ["/admin", "/admin/"].includes(url.pathname)) return adminPage(res);
    if (req.method === "POST" && url.pathname === "/v1/admin/login") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!/^[A-Za-z0-9._-]{3,64}$/.test(username) || password.length < 8) return send(res, 401, { error: "login_failed" });
      const [rows] = await pool.execute("SELECT id,username,password_hash,role,merchant_id,status FROM users WHERE username=? LIMIT 1", [username]);
      const user = rows[0];
      if (!user || user.status !== "active" || !(await passwordMatches(password, user.password_hash))) return send(res, 401, { error: "login_failed" });
      const sessionId = crypto.randomBytes(32).toString("base64url");
      await pool.execute("INSERT INTO login_sessions (session_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(3),INTERVAL 12 HOUR))", [sha256(sessionId), user.id]);
      return send(res, 200, { ok: true, username: user.username, role: user.role }, { "set-cookie": `tr_admin=${sessionId}; Path=${cookiePath}; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` });
    }
    if (req.method === "POST" && url.pathname === "/v1/admin/logout") {
      const sessionId = cookies(req).tr_admin; if (sessionId) await pool.execute("DELETE FROM login_sessions WHERE session_hash=?", [sha256(sessionId)]);
      return send(res, 200, { ok: true }, { "set-cookie": `tr_admin=; Path=${cookiePath}; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/summary") {
      const user = await requirePrincipal(req, res); if (!user) return;
      await pool.execute("UPDATE api_keys SET status='expired' WHERE status='active' AND expires_at<=NOW(3)");
      const scope = tenantWhere(user);
      const [rows] = await pool.query(
        `SELECT COUNT(*) total_cards,SUM(k.status='active') active_cards,SUM(k.status='exhausted') exhausted_cards,
                COALESCE(SUM(k.used_tokens),0) used_tokens,COALESCE(SUM(k.used_credit_microunit),0) used_credit_microunit
           FROM api_keys k JOIN routers r ON r.router_id=k.router_id WHERE 1=1${scope.sql}`,
        scope.params,
      );
      return send(res, 200, { ...rows[0], viewer: { username: user.username, role: user.role } });
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/cards") {
      const user = await requirePrincipal(req, res); if (!user) return;
      const page = Math.trunc(boundedNumber(url.searchParams.get("page"), 1, 1, 1_000_000, "page"));
      const pageSize = Math.trunc(boundedNumber(url.searchParams.get("page_size"), 20, 1, 100, "page_size"));
      const query = String(url.searchParams.get("query") || "").slice(0, 128);
      const status = String(url.searchParams.get("status") || "all");
      const quotaType = String(url.searchParams.get("quota_type") || "all");
      if (!["all", "active", "exhausted", "revoked", "expired"].includes(status)) throw Object.assign(new Error("invalid status"), { status: 400 });
      if (!["all", "tokens", "credit"].includes(quotaType)) throw Object.assign(new Error("invalid quota_type"), { status: 400 });
      const where = ["(?='' OR k.router_id LIKE CONCAT('%',?,'%') OR k.key_prefix LIKE CONCAT('%',?,'%'))", "(?='all' OR k.status=?)", "(?='all' OR k.quota_type=?)"];
      const params = [query, query, query, status, status, quotaType, quotaType];
      const scope = tenantWhere(user);
      const [countRows] = await pool.execute(`SELECT COUNT(*) total FROM api_keys k JOIN routers r ON r.router_id=k.router_id WHERE ${where.join(" AND ")}${scope.sql}`, [...params, ...scope.params]);
      const [rows] = await pool.execute(
        `SELECT k.id,k.key_prefix,k.router_id,k.status,k.quota_type,k.token_limit,k.credit_limit_microunit,
                k.used_tokens,k.used_credit_microunit,k.request_count,k.expires_at,k.created_at,k.last_used_at,k.exhausted_at
           FROM api_keys k JOIN routers r ON r.router_id=k.router_id WHERE ${where.join(" AND ")}${scope.sql} ORDER BY k.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        [...params, ...scope.params],
      );
      return send(res, 200, { page, page_size: pageSize, total: Number(countRows[0].total), cards: rows });
    }
    const revokeMatch = url.pathname.match(/^\/v1\/admin\/cards\/(\d+)\/revoke$/);
    if (req.method === "POST" && revokeMatch) {
      const user = await requirePrincipal(req, res); if (!user || !requireAdmin(user, res)) return;
      const [result] = await pool.execute("UPDATE api_keys SET status='revoked' WHERE id=? AND status='active'", [revokeMatch[1]]);
      return result.affectedRows ? send(res, 200, { ok: true }) : send(res, 409, { error: "card_not_active" });
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/users") {
      const user = await requirePrincipal(req, res); if (!user || !requireAdmin(user, res)) return;
      const [rows] = await pool.query(
        `SELECT u.id,u.username,u.role,u.status,u.created_at,m.merchant_code,m.merchant_name
           FROM users u LEFT JOIN merchants m ON m.id=u.merchant_id ORDER BY u.id DESC`,
      );
      return send(res, 200, { users: rows });
    }
    if (req.method === "POST" && url.pathname === "/v1/admin/merchants") {
      const user = await requirePrincipal(req, res); if (!user || !requireAdmin(user, res)) return;
      const body = await readJson(req);
      const merchantCode = String(body.merchant_code || "").trim();
      const merchantName = String(body.merchant_name || "").trim().slice(0, 160);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!validId(merchantCode) || !merchantName || !validUsername(username) || password.length < 12) return send(res, 400, { error: "invalid_merchant_or_user" });
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [created] = await conn.execute("INSERT INTO merchants (merchant_code,merchant_name) VALUES (?,?)", [merchantCode, merchantName]);
        await conn.execute("INSERT INTO users (username,password_hash,role,merchant_id) VALUES (?,?,'merchant',?)", [username, await passwordHash(password), created.insertId]);
        await conn.commit();
        return send(res, 201, { ok: true, merchant_id: created.insertId, username });
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    }
    const assignMatch = url.pathname.match(/^\/v1\/admin\/routers\/([A-Za-z0-9._-]{4,128})\/merchant$/);
    if (req.method === "POST" && assignMatch) {
      const user = await requirePrincipal(req, res); if (!user || !requireAdmin(user, res)) return;
      const body = await readJson(req); const merchantCode = String(body.merchant_code || "").trim();
      const [merchants] = await pool.execute("SELECT id FROM merchants WHERE merchant_code=? AND status='active' LIMIT 1", [merchantCode]);
      if (!merchants[0]) return send(res, 404, { error: "merchant_not_found" });
      const [result] = await pool.execute("UPDATE routers SET merchant_id=? WHERE router_id=?", [merchants[0].id, assignMatch[1]]);
      return result.affectedRows ? send(res, 200, { ok: true }) : send(res, 404, { error: "router_not_found" });
    }
    if (req.method === "POST" && url.pathname === "/v1/admin/me/password") {
      const user = await requirePrincipal(req, res); if (!user) return;
      const body = await readJson(req); const oldPassword = String(body.old_password || ""); const newPassword = String(body.new_password || "");
      if (newPassword.length < 12) return send(res, 400, { error: "password_too_short" });
      const [rows] = await pool.execute("SELECT password_hash FROM users WHERE id=? LIMIT 1", [user.id]);
      if (!rows[0] || !(await passwordMatches(oldPassword, rows[0].password_hash))) return send(res, 401, { error: "password_incorrect" });
      await pool.execute("UPDATE users SET password_hash=?,password_changed_at=NOW(3) WHERE id=?", [await passwordHash(newPassword), user.id]);
      await pool.execute("DELETE FROM login_sessions WHERE user_id=?", [user.id]);
      return send(res, 200, { ok: true }, { "set-cookie": `tr_admin=; Path=${cookiePath}; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
    }
    if (req.method === "POST" && url.pathname === "/v1/router/config") {
      if (req.headers["x-router-control-token"] !== routerControlToken) return send(res, 401, { error: "router_authentication_failed" });
      const body = await readJson(req); const routerId = String(body.router_id || "");
      if (!validId(routerId)) return send(res, 400, { error: "invalid_router_id" });
      const card = await issueCard(routerId, body);
      return send(res, 200, { base_url: publicProxyUrl, ...card, model: defaultModel });
    }
    if (req.method === "POST" && url.pathname === "/v1/admin/cards") {
      const user = await requirePrincipal(req, res); if (!user || !requireAdmin(user, res)) return;
      const body = await readJson(req); const routerId = String(body.router_id || "");
      const count = Math.trunc(boundedNumber(body.count, 1, 1, 100, "count"));
      if (!validId(routerId)) return send(res, 400, { error: "invalid_router_id" });
      const cards = []; for (let i = 0; i < count; i += 1) cards.push(await issueCard(routerId, body));
      return send(res, 201, { cards });
    }
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") return send(res, 404, { error: "not_found" });
    const secret = bearer(req); if (!secret) return send(res, 401, { error: "missing_api_key" });
    return await withKeyLock(sha256(secret).toString("hex"), async () => {
      const card = await activeCardOrResponse(secret, res); if (!card) return;
      await proxyCompletion(req, res, url, card);
    });
  } catch (error) {
    console.error("request failed", error?.message || error);
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : "internal_server_error" });
    else res.end();
  }
});

async function start() {
  // The legacy secret is only used once to seed the first local admin account.
  // It remains an emergency server-to-server header, never a browser session.
  const [rows] = await pool.query("SELECT COUNT(*) total FROM users");
  if (Number(rows[0].total) === 0) {
    await pool.execute("INSERT INTO users (username,password_hash,role) VALUES ('admin',?,'admin')", [await passwordHash(bootstrapAdminPassword)]);
    console.log("TokenRouter seeded initial admin user");
  }
  server.listen(port, host, () => console.log(`TokenRouter gateway listening on ${host}:${port}`));
}
start().catch((error) => { console.error("startup failed", error?.message || error); process.exit(1); });
