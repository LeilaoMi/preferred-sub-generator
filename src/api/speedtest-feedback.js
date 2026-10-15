import { requireAuthAsync } from "../security/auth.js";
import { checkRateLimit } from "../security/rate-limit.js";
import { jsonResponse } from "../utils/response.js";
import { hashClientIp, insertFeedback, isD1, loadFeedback, summarizeFeedback } from "./speedtest-db.js";

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

  // 没绑 D1 时回退 KV 会每次写一次 KV；匿名请求能把全账号每天 1000 次免费写额度刷光，
  // 连带 Actions 写 KV 失败。所以 KV 回退只接受管理 token，匿名回传直接跳过。
  if (!isD1(env)) {
    const auth = await requireAuthAsync(request, env);
    if (!auth.authorized) {
      return jsonResponse({ ok: true, storage: "skipped", note: "未绑定 D1，匿名测速结果不落库" }, 202);
    }
  }
  const storage = await insertFeedback(env, entry);

  return jsonResponse({
    ok: true,
    storage,
    saved: { at: entry.at, colo: entry.colo, ipCountry: entry.ipCountry, isp: entry.isp, speedMbps: entry.speedMbps },
  });
}

export async function handleSpeedtestFeedbackGet(request, env) {
  const auth = await requireAuthAsync(request, env);
  if (!auth.authorized) return jsonResponse({ error: auth.reason }, auth.reason === "Missing SUB_TOKEN" ? 500 : 401);

  const url = new URL(request.url);
  const days = url.searchParams.get("days");
  const now = Date.parse(env.FEEDBACK_NOW || "") || Date.now();
  const { entries, storage } = await loadFeedback(env, { days, limit: url.searchParams.get("limit"), now });
  const summary = summarizeFeedback(entries, { days, now, storage });

  return jsonResponse({ summary, storage, feedback: entries });
}
