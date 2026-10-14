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

  // 故障自愈状态（借鉴 IonRh/Cloudflare-BestIP 的思路）：
  // 检查隔离名单规模，判断是否需要干预
  let quarantineCount = 0;
  let quarantineRatio = 0;
  try {
    const qRaw = await env.SUB_KV.get("IP_QUARANTINE");
    if (qRaw) {
      const q = JSON.parse(qRaw);
      const now = Date.now();
      const COOLDOWN = 24 * 60 * 60 * 1000;
      quarantineCount = Object.values(q).filter(
        (e) => e.quarantinedAt && now - e.quarantinedAt < COOLDOWN
      ).length;
      quarantineRatio = bestIpsCount > 0 ? quarantineCount / bestIpsCount : 0;
    }
  } catch {
    // 忽略
  }

  // VLESS_* 已改为可选（首页用户粘贴节点 / edgetunnel 占位模板），健康只看 IP 池
  // 是否有可用数据；configOk/configWarnings 保留为 /full 的参考信息
  const ok = bestIpsCount > 0;
  // 自愈建议：隔离率超过 30% 时提示可能需要手动干预
  const needsAttention = quarantineRatio > 0.3;
  return {
    ok, kv: true, configOk, configWarnings, bestIpsCount,
    quarantine: { count: quarantineCount, ratio: Math.round(quarantineRatio * 100) / 100 },
    ...(needsAttention ? { warning: "high_quarantine_ratio", message: "隔离率过高，建议检查上游数据源或手动触发更新" } : {}),
  };
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
