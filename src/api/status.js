import { jsonResponse } from "../utils/response.js";
import { readStatus } from "./kv.js";
import { readHostHealth, summarizeHostHealth } from "./host-health.js";
import { requireReadAuth } from "../security/auth.js";

const STALE_MS = 12 * 60 * 60 * 1000;
const UNHEALTHY_MS = 24 * 60 * 60 * 1000;

function ageMs(updatedAt, now) {
  const ts = Date.parse(updatedAt || "");
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, now - ts);
}

// 匿名访问 /status 时隐藏真实节点域名（只显示 a***.example.com），带只读 token（?t= 或 Bearer）才显示全名
export function maskHost(host) {
  const value = String(host || "");
  const parts = value.split(".");
  if (parts.length < 2) return "***";
  const head = parts[0];
  const tail = parts.slice(-2).join(".");
  return `${head.slice(0, 1)}***.${tail}`;
}

export async function handleStatus(request, env) {
  let showHosts = false;
  try {
    const auth = await requireReadAuth(request, env);
    showHosts = auth.authorized && auth.public === false;
  } catch {
    showHosts = false;
  }
  const status = await readStatus(env.SUB_KV);
  let cnProbe = null;
  try {
    const raw = await env.SUB_KV?.get?.("CN_PROBE_STATE");
    if (raw) {
      const parsed = JSON.parse(raw);
      cnProbe = { lastRunAt: parsed.lastRunAt || null, tested: parsed.tested ?? null, results: parsed.results ?? null, ok: parsed.ok ?? null, rateLimited: Boolean(parsed.rateLimited), verified: parsed.verified ?? null, publicVerified: Boolean(parsed.publicVerified) };
    }
  } catch {
    cnProbe = null;
  }
  // 国内域名体检（china-host.yml）：每个域名在电信 / 联通 / 移动下的状态 ok | unstable | blocked | unknown
  let cnHosts = null;
  try {
    const health = await readHostHealth(env.SUB_KV);
    if (health) {
      cnHosts = {
        checkedAt: health.checkedAt || null,
        rotate: Boolean(health.config?.rotate),
        hosts: summarizeHostHealth(health, health.config?.hosts || null).map((item) => ({
          host: showHosts ? item.host : maskHost(item.host),
          blockedIsps: item.blockedIsps,
          CT: item.isps.CT.state,
          CU: item.isps.CU.state,
          CM: item.isps.CM.state,
        })),
      };
    }
  } catch {
    cnHosts = null;
  }
  const fallbackActive = Boolean(status.protectedByPrevious);
  const lastError = status.lastError || null;
  const now = Date.parse(env.STATUS_NOW || "") || Date.now();
  const age = ageMs(status.updatedAt, now);
  const stale = age !== null && age > STALE_MS;
  const unhealthy = age !== null && age > UNHEALTHY_MS;
  const semanticStatus = lastError ? (fallbackActive ? "fallback" : "error") : unhealthy ? "unhealthy" : stale ? "stale" : "ok";

  return jsonResponse({
    updatedAt: status.updatedAt || null,
    available: status.available || 0,
    newAvailable: status.newAvailable || 0,
    sourceCount: status.sourceCount || 0,
    checked: status.checked || 0,
    fallbackActive,
    lastError,
    stale,
    unhealthy,
    ageSeconds: age === null ? null : Math.round(age / 1000),
    speedtestLocation: status.speedtestLocation || null,
    speedTestNote: status.speedTestNote || null,
    averageSpeed: status.averageSpeed ?? null,
    averageLatency: status.averageLatency ?? null,
    status: semanticStatus,
    // 国内三网自动实测（china-probe.yml）最近一轮概况
    cnProbe,
    cnHosts,
  });
}
