import { requireAuth } from "../security/auth.js";
import { checkRateLimit } from "../security/rate-limit.js";
import { jsonResponse } from "../utils/response.js";
import { ensureD1Schema, hashClientIp } from "./speedtest-db.js";

const FEEDBACK_KEY = "IP_FEEDBACK";
const KV_MAX_ENTRIES = 500;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
const MAX_ROWS = 1000;
const MAX_RESULTS = 200;

const D1_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ip_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    address TEXT NOT NULL,
    port INTEGER,
    colo TEXT,
    region TEXT,
    rtt_ms REAL NOT NULL,
    speed_mbps REAL,
    client_hash TEXT,
    ok INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ip_feedback_created_at ON ip_feedback (created_at)",
  "CREATE INDEX IF NOT EXISTS idx_ip_feedback_address ON ip_feedback (address)",
];

const ensuredIpDbs = new WeakSet();
const ipSchemaState = new WeakMap();

async function ensureIpSchema(db) {
  const cached = ipSchemaState.get(db);
  if (cached) return cached;
  await ensureD1Schema(db, D1_SCHEMA_STATEMENTS, ensuredIpDbs);
  let hasOk = true;
  try {
    // 旧表没有 ok 列，这里做一次幂等迁移
    const result = await db.prepare("ALTER TABLE ip_feedback ADD COLUMN ok INTEGER").run();
    const message = String(result?.error || "");
    hasOk = result?.success === false ? /duplicate column/i.test(message) : true;
  } catch (error) {
    // 只有「列已存在」才算迁移成功，其它错误降级为不写 ok 列
    hasOk = /duplicate column/i.test(String(error?.message || error));
  }
  const state = { hasOk };
  ipSchemaState.set(db, state);
  return state;
}

function insertStatement(hasOk) {
  return hasOk
    ? "INSERT INTO ip_feedback (created_at, address, port, colo, region, rtt_ms, speed_mbps, client_hash, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    : "INSERT INTO ip_feedback (created_at, address, port, colo, region, rtt_ms, speed_mbps, client_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
}

function selectStatement(hasOk) {
  const okColumn = hasOk ? ", ok" : "";
  return `SELECT created_at, address, port, colo, region, rtt_ms, speed_mbps, client_hash${okColumn} FROM ip_feedback WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`;
}

function clampDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_DAYS;
  return Math.min(Math.floor(days), MAX_DAYS);
}

function isD1(env) {
  return Boolean(env?.SPEED_DB);
}

function normalizeEntry(item) {
  const address = String(item?.address || "").trim();
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(address)) return null;
  if (!/[0-9]/.test(address)) return null;

  const rawOk = item?.ok;
  const ok = rawOk === undefined || rawOk === null ? undefined : Boolean(rawOk);
  const rtt = Number(item?.rtt);
  // ok:false 表示该 IP 在探测中不可用（连不上、或对该 zone 返回非 2xx），rtt 允许缺失
  if (ok !== false && (!Number.isFinite(rtt) || rtt < 0 || rtt > 60000)) return null;

  const port = Number(item?.port);
  const speed = Number(item?.speed);
  return {
    at: typeof item?.at === "string" && item.at ? item.at : new Date().toISOString(),
    address,
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : null,
    colo: String(item?.colo || "").trim().toUpperCase().slice(0, 8),
    region: String(item?.region || "").trim().slice(0, 8),
    rtt: Number.isFinite(rtt) && rtt >= 0 ? Math.round(rtt * 10) / 10 : null,
    speed: Number.isFinite(speed) && speed >= 0 && speed <= 100000 ? Math.round(speed * 100) / 100 : null,
    clientHash: typeof item?.clientHash === "string" ? item.clientHash.slice(0, 32) : null,
    ok,
  };
}

export async function saveIpFeedback(env, entries) {
  if (isD1(env)) {
    const { hasOk } = await ensureIpSchema(env.SPEED_DB);
    const statement = insertStatement(hasOk);
    const statements = entries.map((entry) => env.SPEED_DB
      .prepare(statement)
      .bind(
        entry.at,
        entry.address,
        entry.port,
        entry.colo,
        entry.region,
        entry.rtt ?? 0,
        entry.speed,
        entry.clientHash || null,
        ...(hasOk ? [entry.ok === undefined ? null : entry.ok ? 1 : 0] : []),
      ));
    await env.SPEED_DB.batch(statements);
    return "d1";
  }

  const list = await readKvEntries(env);
  list.unshift(...entries);
  await env.SUB_KV.put(FEEDBACK_KEY, JSON.stringify(list.slice(0, KV_MAX_ENTRIES)));
  return "kv";
}

async function readKvEntries(env) {
  const existing = await env.SUB_KV.get(FEEDBACK_KEY);
  if (!existing) return [];
  let list = [];
  try { list = JSON.parse(existing); } catch { list = []; }
  return Array.isArray(list) ? list : [];
}

export async function loadIpEntries(env, { days, now = Date.now() } = {}) {
  const windowDays = clampDays(days);
  const since = new Date(now - windowDays * 24 * 60 * 60 * 1000).toISOString();

  if (isD1(env)) {
    const { hasOk } = await ensureIpSchema(env.SPEED_DB);
    const result = await env.SPEED_DB
      .prepare(selectStatement(hasOk))
      .bind(since, MAX_ROWS)
      .all();
    const entries = (result?.results || []).map((row) => ({
      at: row.created_at,
      address: row.address,
      port: row.port,
      colo: row.colo || "",
      region: row.region || "",
      rtt: row.rtt_ms,
      speed: row.speed_mbps,
      clientHash: row.client_hash || null,
      ok: hasOk && row.ok !== null && row.ok !== undefined ? Boolean(row.ok) : undefined,
    }));
    return { entries, storage: "d1" };
  }

  const list = await readKvEntries(env);
  const entries = list.filter((item) => typeof item?.at === "string" && item.at >= since).slice(0, MAX_ROWS);
  return { entries, storage: "kv" };
}

export function summarizeIpScores(entries) {
  const byAddress = new Map();

  for (const item of Array.isArray(entries) ? entries : []) {
    const address = String(item?.address || "");
    if (!address) continue;

    const failed = item?.ok === false;
    const rtt = Number(item?.rtt);
    // 失败探测（ok:false）要计数，但不参与 rtt/speed 平均；无 ok 标记的无效 rtt 直接忽略
    if (!failed && !Number.isFinite(rtt)) continue;

    let bucket = byAddress.get(address);
    if (!bucket) {
      bucket = { rtt: 0, speed: 0, speedSamples: 0, samples: 0, failed: 0, colo: "", region: "", latest: "" };
      byAddress.set(address, bucket);
    }

    if (failed) {
      bucket.failed += 1;
      continue;
    }

    bucket.samples += 1;
    bucket.rtt += rtt;

    const speed = Number(item?.speed);
    if (Number.isFinite(speed)) {
      bucket.speed += speed;
      bucket.speedSamples += 1;
    }

    const at = String(item?.at || "");
    if (at > bucket.latest) {
      bucket.latest = at;
      bucket.colo = String(item?.colo || "").toUpperCase();
      bucket.region = String(item?.region || "");
    }
  }

  const scores = new Map();
  for (const [address, bucket] of byAddress) {
    scores.set(address, {
      rtt: bucket.samples > 0 ? bucket.rtt / bucket.samples : null,
      speed: bucket.speedSamples > 0 ? bucket.speed / bucket.speedSamples : null,
      colo: bucket.colo || undefined,
      region: bucket.region || undefined,
      samples: bucket.samples,
      failed: bucket.failed,
      // 实测失败次数多于成功次数时判定为不可用，订阅里直接剔除
      unreachable: bucket.failed > bucket.samples,
      latest: bucket.latest,
    });
  }
  return scores;
}

export async function loadIpScores(env, options = {}) {
  const { entries, storage } = await loadIpEntries(env, options);
  return { scores: summarizeIpScores(entries), storage, count: entries.length };
}

function getClientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

function authFailure(auth) {
  return jsonResponse({ error: auth.reason }, auth.reason === "Missing SUB_TOKEN" ? 500 : 401);
}

export async function handleIpFeedbackPost(request, env) {
  const auth = requireAuth(request, env);
  if (!auth.authorized) return authFailure(auth);

  const rate = checkRateLimit(request);
  if (!rate.allowed) return jsonResponse({ error: rate.error }, rate.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const raw = Array.isArray(body?.results) ? body.results : (Array.isArray(body) ? body : null);
  if (!raw || raw.length === 0) return jsonResponse({ error: "results must be a non-empty array" }, 400);
  if (raw.length > MAX_RESULTS) return jsonResponse({ error: `Too many results (max ${MAX_RESULTS})` }, 400);

  const clientHash = await hashClientIp(getClientIp(request));
  const at = new Date().toISOString();
  const entries = raw
    .map((item) => normalizeEntry({ ...item, at, clientHash }))
    .filter(Boolean);

  if (entries.length === 0) return jsonResponse({ error: "No valid measurements" }, 400);

  const storage = await saveIpFeedback(env, entries);

  return jsonResponse({ ok: true, storage, saved: entries.length, rejected: raw.length - entries.length });
}

export async function handleIpFeedbackGet(request, env) {
  const auth = requireAuth(request, env);
  if (!auth.authorized) return authFailure(auth);

  const url = new URL(request.url);
  const days = url.searchParams.get("days");
  const now = Date.parse(env.IP_FEEDBACK_NOW || "") || Date.now();
  const { scores, storage, count } = await loadIpScores(env, { days, now });

  return jsonResponse({
    storage,
    count,
    days: clampDays(days),
    scores: Object.fromEntries(scores),
  });
}
