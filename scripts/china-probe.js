#!/usr/bin/env node
// 国内视角自动实测（无需手机）：借 Globalping（jsDelivr 开源全球探针网络）在中国大陆
// 电信 / 联通 / 移动三网家宽与机房探针上，对过审池 IP 做 TCP 443 握手测量。
// 结果写入 KV 键 CN_PROBE_FEEDBACK，订阅排序与手机 probe-ips.js 回传的数据合并使用。
//
// 局限：只测 TCP 握手（RTT + 丢包），测不到 SNI 阻断；国内本机 probe-ips.js 仍是最准的补充。
import { applyInstanceConfig } from "./lib/instance-config.js";
import { readKvValue, writeKvValue } from "./lib/kv.js";
import { buildVerifiedSnapshot, CN_COMMUNITY_KEY, CN_VERIFIED_KEY, mergeSnapshot } from "../src/api/cn-verified.js";

export const CN_PROBE_KEY = "CN_PROBE_FEEDBACK";
const STATE_KEY = "CN_PROBE_STATE";
const API = "https://api.globalping.io/v1/measurements";
// 三网各取 1 个探针；magic 语法：国家 + 运营商网络名
export const ISP_LOCATIONS = [
  { magic: "CN+Chinanet", limit: 1 },
  { magic: "CN+China Unicom", limit: 1 },
  { magic: "CN+China Mobile", limit: 1 },
];
const KEEP_MS = 3 * 24 * 3600 * 1000;
const MAX_ENTRIES = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function ispLabel(network) {
  const n = String(network || "").toLowerCase();
  if (n.includes("unicom") || n.includes("china169")) return "CU";
  if (n.includes("mobile") || n.includes("cmnet")) return "CM";
  if (n.includes("chinanet") || n.includes("telecom")) return "CT";
  return "CN";
}

// 一个探针结果 -> 一条反馈；丢包超过 1/3 或没回包都算失败
export function resultToEntry(target, result, at) {
  const stats = result?.result?.stats;
  const status = result?.result?.status;
  const total = Number(stats?.total) || 0;
  const rcv = Number(stats?.rcv) || 0;
  const ok = status === "finished" && total > 0 && rcv / total >= 2 / 3 && Number.isFinite(Number(stats?.avg));
  return {
    at,
    address: target.address,
    port: target.port,
    colo: "",
    region: `CN-${ispLabel(result?.probe?.network)}`,
    rtt: ok ? Math.round(Number(stats.avg) * 10) / 10 : null,
    speed: null,
    clientHash: "globalping",
    ok,
  };
}

async function createMeasurement(target, { fetchImpl, token }) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(API, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "ping",
      target: target.address,
      measurementOptions: { protocol: "TCP", port: target.port, packets: 3 },
      locations: ISP_LOCATIONS,
    }),
  });
  if (response.status === 429) return { rateLimited: true };
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) return { error: `${response.status} ${data?.error?.message || ""}`.trim() };
  return { id: data.id };
}

async function waitMeasurement(id, { fetchImpl, timeoutMs = 30000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1500);
    const response = await fetchImpl(`${API}/${id}`);
    const data = await response.json().catch(() => ({}));
    if (data.status && data.status !== "in-progress") return data;
  }
  return null;
}

// 选目标：手动置顶 + 上次国内 ok 的（保持新鲜）优先，其余按游标轮转，保证整池定期都被测到
export function pickTargets(pool, previousEntries, cursor, budget) {
  const okBefore = new Set(previousEntries.filter((e) => e.ok).map((e) => e.address));
  const seen = new Set();
  const out = [];
  const push = (node) => {
    if (out.length >= budget || seen.has(node.address)) return;
    seen.add(node.address);
    out.push({ address: node.address, port: Number(node.port) || 443 });
  };
  const ipOnly = pool.filter((n) => /^[0-9a-fA-F:.]+$/.test(String(n?.address || "")));
  ipOnly.filter((n) => n.source === "edge-manual").forEach(push);
  const keepFresh = Math.floor(budget / 3);
  ipOnly.filter((n) => okBefore.has(n.address)).slice(0, keepFresh).forEach(push);
  const start = ipOnly.length ? cursor % ipOnly.length : 0;
  const rotated = [...ipOnly.slice(start), ...ipOnly.slice(0, start)];
  let advanced = 0;
  for (const node of rotated) {
    if (out.length >= budget) break;
    advanced += 1;
    push(node);
  }
  return { targets: out, nextCursor: ipOnly.length ? (start + advanced) % ipOnly.length : 0 };
}

export function mergeEntries(previous, fresh, now = Date.now()) {
  const since = new Date(now - KEEP_MS).toISOString();
  return [...fresh, ...previous].filter((e) => typeof e?.at === "string" && e.at >= since).slice(0, MAX_ENTRIES);
}

// 社区实测池：从别人公开的 /cn-verified 拉国内已验证 IP。
// 用途一：放进本轮待测池优先验证；用途二：存成 CN_COMMUNITY，订阅在自己实测不足时兜底。
export async function fetchCommunityPool(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetchImpl(url, { signal: controller.signal, headers: { "User-Agent": "preferred-sub-generator" } });
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || !Array.isArray(data.all)) return null;
    const clean = (list) => (Array.isArray(list) ? list : [])
      .filter((item) => /^[0-9.]+$/.test(String(item?.address || "")) && Number.isFinite(Number(item?.rtt)))
      .slice(0, 50)
      .map((item) => ({ address: item.address, port: Number(item.port) || 443, rtt: Number(item.rtt), colo: String(item.colo || "").slice(0, 4), successRate: item.successRate ?? null }));
    return { updatedAt: data.updatedAt || null, source: url, all: clean(data.all), CT: clean(data.CT), CU: clean(data.CU), CM: clean(data.CM) };
  } catch {
    return null;
  }
}

// 用全部国内实测重算快照，够用才覆盖（scripts/china-host-check.js 也调用）
export async function refreshSnapshot({ kv, fetchImpl, entries, pool, now = Date.now() }) {
  const raw = await readKvValue({ ...kv, key: CN_VERIFIED_KEY, fetchImpl });
  let previous = null;
  try { previous = raw ? JSON.parse(raw) : null; } catch { previous = null; }
  const snapshot = mergeSnapshot(previous, buildVerifiedSnapshot(entries, pool, { now }));
  await writeKvValue({ ...kv, key: CN_VERIFIED_KEY, value: JSON.stringify(snapshot), fetchImpl });
  return snapshot;
}

export async function runChinaProbe({ kv, fetchImpl = fetch, token = "", budget = 60, concurrency = 4, now = new Date(), communityUrl = "", publicVerified = false, defaultIsp = "" }) {
  const read = async (key) => {
    const raw = await readKvValue({ ...kv, key, fetchImpl });
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const community = await fetchCommunityPool(communityUrl, { fetchImpl });
  if (community) {
    await writeKvValue({ ...kv, key: CN_COMMUNITY_KEY, value: JSON.stringify(community), fetchImpl });
    console.log(`社区实测池 ${community.all.length} 个（${communityUrl}）`);
  }
  const pool = [
    ...((await read("BEST_IPS")) || []),
    ...((await read("CN_PENDING_IPS")) || []),
    // 社区验证过的 IP 当作手动置顶优先测，测通了才算自己的
    ...(community?.all || []).map((item) => ({ address: item.address, port: item.port, source: "edge-manual" })),
  ];
  const previous = (await read(CN_PROBE_KEY)) || [];
  const state = (await read(STATE_KEY)) || {};
  const { targets, nextCursor } = pickTargets(pool, previous, Number(state.cursor) || 0, budget);
  console.log(`池 ${pool.length} 个，本轮国内三网实测 ${targets.length} 个`);

  const fresh = [];
  let rateLimited = false;
  let index = 0;
  const at = now.toISOString();
  async function worker() {
    while (index < targets.length && !rateLimited) {
      const target = targets[index++];
      const created = await createMeasurement(target, { fetchImpl, token });
      if (created.rateLimited) { rateLimited = true; break; }
      if (!created.id) { console.log(`  ${target.address} 创建失败 ${created.error}`); continue; }
      const result = await waitMeasurement(created.id, { fetchImpl });
      if (!result) continue;
      for (const probeResult of result.results || []) fresh.push(resultToEntry(target, probeResult, at));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (rateLimited) console.log("Globalping 额度用完，本轮提前结束（已测结果照常写入）");

  const okCount = fresh.filter((e) => e.ok).length;
  console.log(`得到 ${fresh.length} 条三网结果，可用 ${okCount}`);
  let verified = null;
  if (fresh.length > 0) {
    const merged = mergeEntries(previous, fresh, now.getTime());
    await writeKvValue({ ...kv, key: CN_PROBE_KEY, value: JSON.stringify(merged), fetchImpl });
    const snapshot = await refreshSnapshot({ kv, fetchImpl, entries: merged, pool, now: now.getTime() });
    verified = { all: snapshot.all.length, CT: snapshot.CT.length, CU: snapshot.CU.length, CM: snapshot.CM.length };
    console.log(`国内已验证快照：综合 ${verified.all} / 电信 ${verified.CT} / 联通 ${verified.CU} / 移动 ${verified.CM}`);
  }
  await writeKvValue({ ...kv, key: STATE_KEY, value: JSON.stringify({ publicVerified, defaultIsp: ["CT", "CU", "CM"].includes(String(defaultIsp).toUpperCase()) ? String(defaultIsp).toUpperCase() : null, cursor: nextCursor, lastRunAt: at, tested: targets.length, results: fresh.length, ok: okCount, rateLimited, verified: verified ?? state.verified ?? null, community: community ? community.all.length : null }), fetchImpl });
  return { tested: targets.length, results: fresh.length, ok: okCount, rateLimited, verified };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyInstanceConfig();
  const kv = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  };
  const token = process.env.GLOBALPING_TOKEN || "";
  // 匿名额度约 250 次/小时（每个 IP 用 3 次），有 token 时可放大
  const budget = Number(process.env.CN_PROBE_BUDGET) || (token ? 150 : 60);
  // 社区实测池默认关闭；填 COMMUNITY_POOL_URL（如 https://yxdy.woniu.bee.al/cn-verified）才拉取
  const communityUrl = process.env.COMMUNITY_POOL_URL || "";
  // PUBLIC_CN_VERIFIED=1：公开 /cn-verified，把你的国内已验证 IP 分享给复刻者（只有 IP、延迟、机房，不含域名）
  const publicVerified = process.env.PUBLIC_CN_VERIFIED === "1";
  // SUB_DEFAULT_ISP=CT|CU|CM：edgetunnel 拉订阅时默认按这个运营商排序（它的 sub:// 带不了 ?isp=）
  const defaultIsp = process.env.SUB_DEFAULT_ISP || "";
  runChinaProbe({ kv, token, budget, communityUrl, publicVerified, defaultIsp }).catch((error) => {
    console.error(`失败: ${error.message}`);
    process.exitCode = 1;
  });
}
