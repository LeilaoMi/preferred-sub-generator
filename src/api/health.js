import { jsonResponse } from "../utils/response.js";

async function exists(kv, key) {
  const value = await kv.get(key);
  return Boolean(value);
}

export async function handleHealth(request, env) {
  const templateExists = await exists(env.SUB_KV, "TEMPLATE");
  const bestIpsRaw = await env.SUB_KV.get("BEST_IPS");
  let bestIpsCount = 0;

  try {
    const parsed = JSON.parse(bestIpsRaw || "[]");
    bestIpsCount = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    bestIpsCount = 0;
  }

  const ok = templateExists && bestIpsCount > 0;
  return jsonResponse({
    ok,
    kv: true,
    templateExists,
    bestIpsCount,
  }, ok ? 200 : 503);
}
