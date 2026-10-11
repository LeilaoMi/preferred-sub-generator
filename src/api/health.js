import { requireAuth } from "../security/auth.js";
import { jsonResponse, unauthorizedResponse } from "../utils/response.js";
import { getNodeConfig, validateNodeConfig } from "../config/nodes.js";

async function readHealthDetails(env) {
  let configOk = false;
  let configWarnings = [];
  try {
    const config = getNodeConfig(env);
    configWarnings = validateNodeConfig(config);
    configOk = !configWarnings.some((w) => w.level === "error");
  } catch {
    configOk = false;
  }
  const bestIpsRaw = await env.SUB_KV.get("BEST_IPS");
  let bestIpsCount = 0;

  try {
    const parsed = JSON.parse(bestIpsRaw || "[]");
    bestIpsCount = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    bestIpsCount = 0;
  }

  const ok = configOk && bestIpsCount > 0;
  return { ok, kv: true, configOk, configWarnings, bestIpsCount };
}

export async function handleHealth(request, env) {
  const url = new URL(request.url);
  const details = await readHealthDetails(env);

  if (url.pathname.endsWith("/full")) {
    const auth = requireAuth(request, env);
    if (!auth.authorized) return unauthorizedResponse();
    return jsonResponse(details, details.ok ? 200 : 503);
  }

  return jsonResponse({ ok: details.ok }, details.ok ? 200 : 503);
}
