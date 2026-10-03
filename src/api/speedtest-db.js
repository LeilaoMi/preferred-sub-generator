const FEEDBACK_KEY = "SPEED_FEEDBACK";
const KV_MAX_ENTRIES = 500;
const DEFAULT_LIMIT = 100;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

const D1_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS speed_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  colo TEXT,
  ip_country TEXT,
  isp TEXT,
  speed_mbps REAL NOT NULL,
  client_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_speed_feedback_created_at ON speed_feedback (created_at);
CREATE INDEX IF NOT EXISTS idx_speed_feedback_colo ON speed_feedback (colo);
`;

const ensuredDbs = new WeakSet();

async function ensureD1Schema(db) {
  if (ensuredDbs.has(db)) return;
  await db.exec(D1_SCHEMA_SQL);
  ensuredDbs.add(db);
}

export function clampOptions({ days, limit } = {}) {
  const parsedDays = Number(days);
  const parsedLimit = Number(limit);
  return {
    days: Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(Math.floor(parsedDays), MAX_DAYS) : DEFAULT_DAYS,
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 1000) : DEFAULT_LIMIT,
  };
}

export async function hashClientIp(ip) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(ip || "unknown")));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function isD1(env) {
  return Boolean(env?.SPEED_DB);
}

export async function insertFeedback(env, entry) {
  if (isD1(env)) {
    await ensureD1Schema(env.SPEED_DB);
    await env.SPEED_DB
      .prepare("INSERT INTO speed_feedback (created_at, colo, ip_country, isp, speed_mbps, client_hash) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(entry.at, entry.colo, entry.ipCountry, entry.isp, entry.speedMbps, entry.clientHash || null)
      .run();
    return "d1";
  }

  const existing = await env.SUB_KV.get(FEEDBACK_KEY);
  let list = [];
  if (existing) {
    try { list = JSON.parse(existing); } catch { list = []; }
  }
  if (!Array.isArray(list)) list = [];
  list.unshift({ ...entry, ip: undefined });
  await env.SUB_KV.put(FEEDBACK_KEY, JSON.stringify(list.slice(0, KV_MAX_ENTRIES), null, 2));
  return "kv";
}

export async function loadFeedback(env, { days, limit, now = Date.now() } = {}) {
  const options = clampOptions({ days, limit });
  const since = new Date(now - options.days * 24 * 60 * 60 * 1000).toISOString();

  if (isD1(env)) {
    await ensureD1Schema(env.SPEED_DB);
    const result = await env.SPEED_DB
      .prepare("SELECT created_at, colo, ip_country, isp, speed_mbps, client_hash FROM speed_feedback WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?")
      .bind(since, options.limit)
      .all();
    const entries = (result?.results || []).map((row) => ({
      at: row.created_at,
      colo: row.colo || "",
      ipCountry: row.ip_country || "",
      isp: row.isp || "",
      speedMbps: row.speed_mbps,
      clientHash: row.client_hash || null,
    }));
    return { entries, storage: "d1" };
  }

  const existing = await env.SUB_KV.get(FEEDBACK_KEY);
  let list = [];
  if (existing) {
    try { list = JSON.parse(existing); } catch { list = []; }
  }
  if (!Array.isArray(list)) list = [];
  const entries = list
    .filter((item) => typeof item?.at === "string" && item.at >= since)
    .slice(0, options.limit);
  return { entries, storage: "kv" };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function dayKey(iso) {
  return String(iso || "").slice(0, 10);
}

export function summarizeFeedback(entries, { now = Date.now(), days, storage = "kv" } = {}) {
  const options = clampOptions({ days });
  const list = Array.isArray(entries) ? entries : [];
  const speeds = list.map((item) => Number(item?.speedMbps)).filter((value) => Number.isFinite(value));

  const trend = [];
  const byDay = new Map();
  const coloCounts = new Map();
  const coloSpeeds = new Map();

  for (const item of list) {
    const key = dayKey(item?.at);
    if (!key) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(Number(item.speedMbps));

    const colo = String(item?.colo || "UNKNOWN").toUpperCase();
    coloCounts.set(colo, (coloCounts.get(colo) || 0) + 1);
    if (Number.isFinite(Number(item.speedMbps))) {
      if (!coloSpeeds.has(colo)) coloSpeeds.set(colo, []);
      coloSpeeds.get(colo).push(Number(item.speedMbps));
    }
  }

  for (let offset = options.days - 1; offset >= 0; offset -= 1) {
    const key = new Date(now - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const values = (byDay.get(key) || []).filter((value) => Number.isFinite(value));
    trend.push({
      date: key,
      count: (byDay.get(key) || []).length,
      averageSpeedMbps: values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      maxSpeedMbps: values.length > 0 ? Math.max(...values) : null,
    });
  }

  const summary = speeds.length > 0
    ? {
        count: list.length,
        averageSpeedMbps: round(speeds.reduce((sum, value) => sum + value, 0) / speeds.length),
        maxSpeedMbps: Math.max(...speeds),
        coloBreakdown: Object.fromEntries([...coloCounts.entries()].sort((a, b) => b[1] - a[1])),
      }
    : { count: list.length, coloBreakdown: {} };

  summary.coloSummary = [...coloCounts.entries()]
    .map(([colo, count]) => {
      const values = coloSpeeds.get(colo) || [];
      return {
        colo,
        count,
        averageSpeedMbps: values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      };
    })
    .sort((a, b) => b.count - a.count);
  summary.trend = trend;
  summary.storage = storage;
  return summary;
}
