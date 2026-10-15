import { requireAuthAsync } from "../security/auth.js";
import { checkRateLimit } from "../security/rate-limit.js";
import { jsonResponse } from "../utils/response.js";
import { ensureD1Schema, hashClientIp, hashSalt } from "./speedtest-db.js";

const FEEDBACK_KEY = "IP_FEEDBACK";
// GitHub Actions 借 Globalping 国内三网探针自动实测的结果（scripts/china-probe.js 写入）
const CN_PROBE_KEY = "CN_PROBE_FEEDBACK";
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
    // 表里没有 ok 列（迁移失败）时，失败记录写进去会变成 rtt=0 的"成功"，宁可不写
    const writable = hasOk ? entries : entries.filter((entry) => entry.ok !== false && Number(entry.rtt) > 0);
    if (writable.length === 0) return "d1";
    const statements = writable.map((entry) => env.SPEED_DB
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

// 晚高峰（北京时间 20:00-23:00）是国内线路最差的时候，这段时间的实测更能说明问题
const PEAK_START_HOUR = 20;
const PEAK_END_HOUR = 23;
const DEFAULT_PEAK_WEIGHT = 1.5;
// 实测按时间衰减：半衰期 24 小时，旧结果仍有分量但不再主导，排序不会被单次抖动带跑
const DEFAULT_HALF_LIFE_HOURS = 24;
// 落地机房离国内太远（欧洲、美东等）时排序加罚，延迟低不等于线路好
const NEAR_COLOS = new Set(["HKG", "TPE", "NRT", "HND", "KIX", "ICN", "SIN", "KUL", "BKK", "MNL", "LAX", "SJC", "SFO", "SEA"]);
const FAR_COLO_PENALTY_MS = 80;
const RTT_BUCKET_MS = 20;
// 最近一次成功实测越旧，排序越靠后：每 12 小时 +10ms，最多 +60ms。
// 只靠半衰期不够——只有一条旧记录的 IP 加权平均后 RTT 不变，会一直排在前面。
const AGE_STEP_HOURS = 12;
const AGE_STEP_MS = 10;
const AGE_MAX_PENALTY_MS = 60;

export function agePenalty(ageHours) {
  if (!Number.isFinite(ageHours) || ageHours <= 0) return 0;
  return Math.min(AGE_MAX_PENALTY_MS, Math.floor(ageHours / AGE_STEP_HOURS) * AGE_STEP_MS);
}

export function isPeakHour(at) {
  const ts = Date.parse(at || "");
  if (!Number.isFinite(ts)) return false;
  const hour = (new Date(ts).getUTCHours() + 8) % 24;
  return hour >= PEAK_START_HOUR && hour < PEAK_END_HOUR;
}

// 手机实测（cf-termux-pick 回传）是真实用户线路，比 Globalping 探针更有代表性，分开加权：
// WiFi 就是你自家宽带，权重最高；5G/4G 同运营商但接入网不同，次之；认不出网络类型的按普通样本算
export const PHONE_WEIGHTS = { wifi: 1.5, cellular: 1.2, unknown: 1 };

export function sourceWeight(item) {
  const tag = String(item?.clientHash || "");
  if (!tag.startsWith("phone:")) return 1;
  return PHONE_WEIGHTS[tag.split(":")[1]] ?? 1;
}

export function entryWeight(item, { now, halfLifeHours = DEFAULT_HALF_LIFE_HOURS, peakWeight = DEFAULT_PEAK_WEIGHT } = {}) {
  let weight = sourceWeight(item);
  const ts = Date.parse(item?.at || "");
  if (Number.isFinite(now) && Number.isFinite(ts) && halfLifeHours > 0) {
    const ageHours = Math.max(0, now - ts) / 3600000;
    weight *= Math.pow(0.5, ageHours / halfLifeHours);
  }
  if (isPeakHour(item?.at)) weight *= peakWeight;
  return weight;
}

// 排序分（越小越好）：RTT 按 20ms 分桶（小抖动不换位）+ 远端机房加罚 + 失败率加罚
export function stableRank(score) {
  if (score?.rtt === null || score?.rtt === undefined) return Infinity;
  const rtt = Number(score.rtt);
  if (!Number.isFinite(rtt)) return Infinity;
  const bucket = Math.round(rtt / RTT_BUCKET_MS) * RTT_BUCKET_MS;
  const colo = String(score?.colo || "").toUpperCase();
  const coloPenalty = colo && !NEAR_COLOS.has(colo) ? FAR_COLO_PENALTY_MS : 0;
  const rate = Number(score?.successRate);
  const failPenalty = Number.isFinite(rate) ? Math.round((1 - rate) * 200) : 0;
  return bucket + coloPenalty + failPenalty + agePenalty(Number(score?.ageHours));
}

export function isFarColo(colo) {
  const code = String(colo || "").toUpperCase();
  return Boolean(code) && !NEAR_COLOS.has(code);
}

export function summarizeIpScores(entries, options = {}) {
  const byAddress = new Map();

  for (const item of Array.isArray(entries) ? entries : []) {
    const address = String(item?.address || "");
    if (!address) continue;

    const failed = item?.ok === false;
    const rtt = Number(item?.rtt);
    // 失败探测（ok:false）要计数，但不参与 rtt/speed 平均；无 ok 标记的无效 rtt 直接忽略
    if (!failed && !Number.isFinite(rtt)) continue;
    // rtt<=0 的"成功"是坏数据（旧 D1 表没有 ok 列时，失败记录曾以 rtt=0 写入），不能排到最前
    if (!failed && rtt <= 0) continue;

    let bucket = byAddress.get(address);
    if (!bucket) {
      bucket = { rtt: 0, rttWeight: 0, speed: 0, speedSamples: 0, samples: 0, failed: 0, wOk: 0, wFail: 0, colo: "", coloAt: "", region: "", latest: "" };
      byAddress.set(address, bucket);
    }
    const weight = entryWeight(item, options);
    const at = String(item?.at || "");
    // 落地机房只有 HTTPS 组合测/手机实测才拿得到，取最新一条有机房的记录
    const colo = String(item?.colo || "").toUpperCase();
    if (colo && at >= bucket.coloAt) {
      bucket.colo = colo;
      bucket.coloAt = at;
    }

    if (failed) {
      bucket.failed += 1;
      bucket.wFail += weight;
      continue;
    }

    bucket.samples += 1;
    bucket.wOk += weight;
    bucket.rtt += rtt * weight;
    bucket.rttWeight += weight;

    const speed = Number(item?.speed);
    if (Number.isFinite(speed)) {
      bucket.speed += speed;
      bucket.speedSamples += 1;
    }

    if (at > bucket.latest) {
      bucket.latest = at;
      bucket.region = String(item?.region || "");
    }
  }

  const scores = new Map();
  for (const [address, bucket] of byAddress) {
    const total = bucket.wOk + bucket.wFail;
    const score = {
      rtt: bucket.rttWeight > 0 ? Math.round((bucket.rtt / bucket.rttWeight) * 100) / 100 : null,
      speed: bucket.speedSamples > 0 ? bucket.speed / bucket.speedSamples : null,
      colo: bucket.colo || undefined,
      region: bucket.region || undefined,
      samples: bucket.samples,
      failed: bucket.failed,
      successRate: total > 0 ? Math.round((bucket.wOk / total) * 1000) / 1000 : null,
      // 加权后失败多于成功时判定为不可用，订阅里直接剔除
      unreachable: bucket.wFail > bucket.wOk,
      latest: bucket.latest,
    };
    const latestTs = Date.parse(bucket.latest || "");
    if (Number.isFinite(options.now) && Number.isFinite(latestTs)) {
      score.ageHours = Math.round((Math.max(0, options.now - latestTs) / 3600000) * 10) / 10;
    }
    score.rank = stableRank(score);
    scores.set(address, score);
  }
  return scores;
}

// ?isp=ct|cu|cm：只用对应运营商探针的结果（手机回传等非探针数据照常参与）
export function normalizeIsp(value) {
  const isp = String(value || "").trim().toUpperCase();
  return ["CT", "CU", "CM"].includes(isp) ? isp : null;
}

export function filterEntriesByIsp(entries, isp) {
  const target = normalizeIsp(isp);
  if (!target) return entries;
  return entries.filter((item) => {
    const region = String(item?.region || "").toUpperCase();
    if (!/^CN-(CT|CU|CM)$/.test(region)) return true;
    return region === `CN-${target}`;
  });
}

async function readCnProbeEntries(env, { days, now = Date.now() } = {}) {
  try {
    const raw = await env?.SUB_KV?.get?.(CN_PROBE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    const since = new Date(now - clampDays(days) * 24 * 60 * 60 * 1000).toISOString();
    return Array.isArray(list) ? list.filter((item) => typeof item?.at === "string" && item.at >= since) : [];
  } catch {
    return [];
  }
}

export async function loadIpScores(env, options = {}) {
  const loaded = await loadIpEntries(env, options);
  const storage = loaded.storage;
  // 手机/本机回传 + 国内三网自动实测合并评分
  const all = [...loaded.entries, ...(await readCnProbeEntries(env, options))];
  const entries = filterEntriesByIsp(all, options.isp);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  return { scores: summarizeIpScores(entries, { now }), storage, count: entries.length };
}

function getClientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

function authFailure(auth) {
  return jsonResponse({ error: auth.reason }, auth.reason === "Missing SUB_TOKEN" ? 500 : 401);
}

export async function handleIpFeedbackPost(request, env) {
  const auth = await requireAuthAsync(request, env);
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

  const clientHash = await hashClientIp(getClientIp(request), hashSalt(env));
  const at = new Date().toISOString();
  const entries = raw
    .map((item) => normalizeEntry({ ...item, at, clientHash }))
    .filter(Boolean);

  if (entries.length === 0) return jsonResponse({ error: "No valid measurements" }, 400);

  const storage = await saveIpFeedback(env, entries);

  return jsonResponse({ ok: true, storage, saved: entries.length, rejected: raw.length - entries.length });
}

export async function handleIpFeedbackGet(request, env) {
  const auth = await requireAuthAsync(request, env);
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
