import { requireAuth } from "../security/auth.js";
import { checkRateLimit } from "../security/rate-limit.js";
import { jsonResponse } from "../utils/response.js";
import { hashClientIp, insertFeedback, loadFeedback, summarizeFeedback } from "./speedtest-db.js";

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

  const clientIp = getClientIp(request);
  const entry = {
    at: new Date().toISOString(),
    colo,
    ipCountry,
    isp,
    speedMbps: Math.round(speedMbps * 100) / 100,
    clientHash: await hashClientIp(clientIp),
  };

  const storage = await insertFeedback(env, entry);

  return jsonResponse({
    ok: true,
    storage,
    saved: { at: entry.at, colo: entry.colo, ipCountry: entry.ipCountry, isp: entry.isp, speedMbps: entry.speedMbps },
  });
}

export async function handleSpeedtestFeedbackGet(request, env) {
  const auth = requireAuth(request, env);
  if (!auth.authorized) return jsonResponse({ error: auth.reason }, auth.reason === "Missing SUB_TOKEN" ? 500 : 401);

  const url = new URL(request.url);
  const days = url.searchParams.get("days");
  const now = Date.parse(env.FEEDBACK_NOW || "") || Date.now();
  const { entries, storage } = await loadFeedback(env, { days, limit: url.searchParams.get("limit"), now });
  const summary = summarizeFeedback(entries, { days, now, storage });

  return jsonResponse({ summary, storage, feedback: entries });
}
