import { requireAuthAsync } from "../security/auth.js";
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

  // VLESS_* 已改为可选（首页用户粘贴节点 / edgetunnel 占位模板），健康只看 IP 池
  // 是否有可用数据；configOk/configWarnings 保留为 /full 的参考信息
  const ok = bestIpsCount > 0;
  return { ok, kv: true, configOk, configWarnings, bestIpsCount };
}

export async function handleHealth(request, env) {
  const url = new URL(request.url);
  const details = await readHealthDetails(env);

  if (url.pathname.endsWith("/full")) {
    const auth = await requireAuthAsync(request, env);
    if (!auth.authorized) return unauthorizedResponse();
    return jsonResponse(details, details.ok ? 200 : 503);
  }

  return jsonResponse({ ok: details.ok }, details.ok ? 200 : 503);
}
