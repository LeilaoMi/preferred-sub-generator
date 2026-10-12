// 域名体检（CN_HOST_HEALTH）：从国内电信 / 联通 / 移动探针直接 HTTPS 访问你的域名，
// 判断它在每个运营商下有没有被 DNS 污染、SNI 阻断（连接被重置）。
// 起因（2026-10-13 实测）：移动网络对 ccwu.cc 子域名 6 次里 5 次 ECONNRESET，同网络 speed.cloudflare.com 全通。
// 这种封锁跟 IP 无关，优选 IP 救不了，只能换域名。
import { SNAPSHOT_ISPS } from "./cn-verified.js";
import { normalizeIsp } from "./ip-feedback.js";

export const HOST_HEALTH_KEY = "CN_HOST_HEALTH";
const HISTORY_MAX = 12;
const BLOCKED_RATE = 0.34;
const UNSTABLE_RATE = 0.8;
const MIN_SAMPLES = 3;
export const MAX_CHECK_HOSTS = 20;

function cleanHost(value) {
  const host = String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : "";
}

// 测哪些域名：CHECK_HOSTS（逗号/空格分隔）> VLESS_HOST > VLESS_SNI > 订阅自己的域名（SUB_DOMAIN 或 <Pages 项目>.pages.dev）
export function resolveCheckHosts(env = {}) {
  const explicit = String(env.CHECK_HOSTS || "").split(/[\s,]+/).map(cleanHost).filter(Boolean);
  const fallback = [env.VLESS_HOST, env.VLESS_SNI].map(cleanHost).filter((h) => h && h !== "speed.cloudflare.com");
  const own = [cleanHost(env.SUB_DOMAIN), env.PAGES_PROJECT ? cleanHost(`${env.PAGES_PROJECT}.pages.dev`) : ""].filter(Boolean);
  const list = explicit.length ? explicit : fallback.length ? fallback : own;
  return [...new Set(list)].slice(0, MAX_CHECK_HOSTS);
}

export function judgeHistory(history = []) {
  const list = Array.isArray(history) ? history : [];
  const ok = list.filter((h) => h.ok).length;
  const samples = list.length;
  const rate = samples ? ok / samples : null;
  let state = "unknown";
  if (samples >= MIN_SAMPLES || (samples > 0 && ok === 0 && samples >= 2)) {
    state = rate < BLOCKED_RATE ? "blocked" : rate < UNSTABLE_RATE ? "unstable" : "ok";
  } else if (samples > 0) {
    state = ok === samples ? "ok" : "unstable";
  }
  const latest = list[0] || null;
  return {
    state,
    samples,
    okRate: rate === null ? null : Math.round(rate * 100) / 100,
    colo: list.find((h) => h.ok && h.colo)?.colo || "",
    ms: latest?.ok ? latest.ms ?? null : null,
    lastError: list.find((h) => !h.ok)?.error || null,
  };
}

// 把这一轮的结果并入历史（每个域名每个运营商保留最近 12 次）
export function mergeHostHealth(previous, freshResults, at, config = previous?.config) {
  const hosts = { ...(previous?.hosts || {}) };
  for (const result of freshResults) {
    const current = hosts[result.host] || {};
    const ispHistory = Array.isArray(current[result.isp]) ? current[result.isp] : [];
    hosts[result.host] = {
      ...current,
      [result.isp]: [{ at, ok: result.ok, colo: result.colo || "", ms: result.ms ?? null, error: result.error || null }, ...ispHistory].slice(0, HISTORY_MAX),
    };
  }
  return { checkedAt: at, config: config || undefined, hosts };
}

export function summarizeHostHealth(health, onlyHosts = null) {
  const out = [];
  const allow = onlyHosts ? new Set(onlyHosts) : null;
  for (const [host, byIsp] of Object.entries(health?.hosts || {})) {
    if (allow && !allow.has(host)) continue;
    const isps = {};
    for (const isp of SNAPSHOT_ISPS) isps[isp] = judgeHistory(byIsp?.[isp]);
    const blockedIsps = SNAPSHOT_ISPS.filter((isp) => isps[isp].state === "blocked");
    out.push({ host, blockedIsps, isps });
  }
  return out;
}

export function healthyHosts(health, isp, candidates) {
  const target = normalizeIsp(isp);
  const summary = summarizeHostHealth(health, candidates);
  const known = new Map(summary.map((item) => [item.host, item]));
  return candidates.filter((host) => {
    const item = known.get(host);
    if (!item) return true; // 没测过的不判死
    if (target) return item.isps[target].state !== "blocked";
    return item.blockedIsps.length < SNAPSHOT_ISPS.length;
  });
}

export async function readHostHealth(kv) {
  try {
    const raw = await kv?.get?.(HOST_HEALTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// SUB_ROTATE_HOSTS=1（GitHub 变量，由体检脚本写进 KV 的 config）：订阅里的节点轮流使用
// CHECK_HOSTS 中、对当前运营商没被墙的域名做 host/sni。
// 前提：CHECK_HOSTS 里的域名都绑在同一个 edgetunnel / Worker 上（比如 1-10.xxx 负载均衡）。
// 节点原本的 host 不在 CHECK_HOSTS 里时什么都不改，避免把节点改坏。
export function rotationEnabled(health, env = {}) {
  return env.SUB_ROTATE_HOSTS === "1" || health?.config?.rotate === true;
}

export function applyHostRotation(nodes, template, health, { isp, env = {} } = {}) {
  const fromEnv = String(env.CHECK_HOSTS || "").split(/[\s,]+/).map(cleanHost).filter(Boolean);
  const candidates = fromEnv.length ? fromEnv : (Array.isArray(health?.config?.hosts) ? health.config.hosts.map(cleanHost).filter(Boolean) : []);
  const current = cleanHost(template?.host || template?.sni);
  if (!candidates.length || !candidates.includes(current)) return nodes;
  const usable = healthyHosts(health, isp, candidates);
  if (!usable.length) return nodes;
  return nodes.map((node, index) => {
    const host = usable[index % usable.length];
    return { ...node, host, sni: host };
  });
}
