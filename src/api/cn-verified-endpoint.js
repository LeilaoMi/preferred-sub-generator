import { jsonResponse } from "../utils/response.js";
import { CN_VERIFIED_KEY, readSnapshot } from "./cn-verified.js";

// GET /cn-verified：社区实测池（默认关闭）。
// 打开方式：GitHub 变量 PUBLIC_CN_VERIFIED=1（china-probe 写进 CN_PROBE_STATE），或 Pages 环境变量同名。
// 只输出 IP、端口、国内延迟、成功率、落地机房，不含任何域名、UUID、token。
export async function handleCnVerified(request, env) {
  let enabled = env.PUBLIC_CN_VERIFIED === "1";
  if (!enabled) {
    try {
      const state = JSON.parse((await env.SUB_KV?.get?.("CN_PROBE_STATE")) || "{}");
      enabled = state.publicVerified === true;
    } catch {
      enabled = false;
    }
  }
  if (!enabled) return jsonResponse({ ok: false, error: "cn-verified is not public on this instance" }, 404);
  const snapshot = await readSnapshot(env.SUB_KV, CN_VERIFIED_KEY);
  if (!snapshot) return jsonResponse({ ok: false, error: "no data yet" }, 503);
  const strip = (list) => (Array.isArray(list) ? list : []).map(({ address, port, rtt, colo, successRate }) => ({ address, port, rtt, colo, successRate }));
  const response = jsonResponse({ updatedAt: snapshot.updatedAt, all: strip(snapshot.all), CT: strip(snapshot.CT), CU: strip(snapshot.CU), CM: strip(snapshot.CM) });
  response.headers.set("Cache-Control", "public, max-age=600");
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
