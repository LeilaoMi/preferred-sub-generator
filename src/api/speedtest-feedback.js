import { requireAuth } from "../security/auth.js";
import { checkRateLimit } from "../security/rate-limit.js";
import { jsonResponse } from "../utils/response.js";

const FEEDBACK_KEY = "SPEED_FEEDBACK";
const MAX_FEEDBACK = 100;

function getClientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

export async function handleSpeedtestFeedbackPost(request, env) {
  const rate = checkRateLimit(request);
  if (!rate.allowed) return jsonResponse({ error: rate.error }, rate.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const speedMbps = Number(body?.speedMbps);
  const colo = String(body?.colo || "").trim().toUpperCase().slice(0, 8);
  const ipCountry = String(body?.ipCountry || request.cf?.country || "").trim().slice(0, 8);
  const isp = String(body?.isp || request.cf?.asOrganization || "").trim().slice(0, 40);

  if (!Number.isFinite(speedMbps) || speedMbps < 0 || speedMbps > 10000) {
    return jsonResponse({ error: "Invalid speedMbps" }, 400);
  }

  const entry = {
    at: new Date().toISOString(),
    colo,
    ipCountry,
    isp,
    speedMbps: Math.round(speedMbps * 100) / 100,
    ip: getClientIp(request),
  };

  const existing = await env.SUB_KV.get(FEEDBACK_KEY);
  let list = [];
  if (existing) {
    try { list = JSON.parse(existing); } catch { list = []; }
  }
  if (!Array.isArray(list)) list = [];
  list.unshift(entry);
  list = list.slice(0, MAX_FEEDBACK);
  await env.SUB_KV.put(FEEDBACK_KEY, JSON.stringify(list, null, 2));

  return jsonResponse({ ok: true, saved: entry });
}

export async function handleSpeedtestFeedbackGet(request, env) {
  const auth = requireAuth(request, env);
  if (!auth.authorized) return jsonResponse({ error: auth.reason }, auth.reason === "Missing SUB_TOKEN" ? 500 : 401);

  const value = await env.SUB_KV.get(FEEDBACK_KEY);
  const list = value ? JSON.parse(value) : [];

  const speeds = list.map((x) => x.speedMbps).filter((x) => Number.isFinite(x));
  const summary = speeds.length > 0 ? {
    count: list.length,
    averageSpeedMbps: Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length * 100) / 100,
    maxSpeedMbps: Math.max(...speeds),
    coloBreakdown: list.reduce((acc, x) => { acc[x.colo] = (acc[x.colo] || 0) + 1; return acc; }, {}),
  } : { count: 0 };

  return jsonResponse({ summary, feedback: list });
}
