// 国内已验证快照（CN_VERIFIED）：每轮国内三网实测后，把「整体 / 电信 / 联通 / 移动」各自实测 ok 的 IP
// 按稳定排序分存一份。作用：
// 1. 兜底：Globalping 挂了或实测过期，订阅仍输出最后一次正常的国内名单，不会退回美国视角；
// 2. 社区实测池：可选公开为 /cn-verified，新复刻的人没有自己的实测时先用它。
import { filterEntriesByIsp, summarizeIpScores } from "./ip-feedback.js";
import { isMeasuredOk, readRttDropMs } from "./node-filter.js";

export const CN_VERIFIED_KEY = "CN_VERIFIED";
export const CN_COMMUNITY_KEY = "CN_COMMUNITY";
export const SNAPSHOT_ISPS = ["CT", "CU", "CM"];
const SNAPSHOT_MAX = 50;
// 快照最少要有这么多个节点才覆盖旧快照，避免一轮限流把好名单冲掉
export const SNAPSHOT_MIN = 10;

function rankList(entries, portOf, { now, rttDropMs }) {
  const scores = summarizeIpScores(entries, { now });
  const list = [];
  for (const [address, score] of scores) {
    if (!isMeasuredOk(score, rttDropMs)) continue;
    list.push({
      address,
      port: portOf(address),
      rtt: Math.round(score.rtt * 10) / 10,
      colo: score.colo || "",
      successRate: score.successRate,
      rank: score.rank,
    });
  }
  list.sort((a, b) => a.rank - b.rank || a.rtt - b.rtt);
  return list.slice(0, SNAPSHOT_MAX);
}

export function buildVerifiedSnapshot(entries, pool = [], { now = Date.now(), env = {} } = {}) {
  const ports = new Map();
  for (const node of Array.isArray(pool) ? pool : []) {
    if (node?.address && !ports.has(node.address)) ports.set(node.address, Number(node.port) || 443);
  }
  const portOf = (address) => ports.get(address) || 443;
  const rttDropMs = readRttDropMs(env);
  const snapshot = { updatedAt: new Date(now).toISOString(), all: rankList(entries, portOf, { now, rttDropMs }) };
  for (const isp of SNAPSHOT_ISPS) {
    snapshot[isp] = rankList(filterEntriesByIsp(entries, isp), portOf, { now, rttDropMs });
  }
  return snapshot;
}

// 快照里的名单超过这么久没被新实测替换，就不再拿来兜底（默认 7 天）
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

// 新快照够用才替换；各运营商分别判断，某一网这轮没测够就保留它上一轮的名单。
// 每份名单单独记 `${key}At`（名单真正生成的时间），updatedAt 只表示最近一次合并，不再掩盖旧名单。
export function mergeSnapshot(previous, fresh, min = SNAPSHOT_MIN) {
  const stamp = (snap, key) => snap?.[`${key}At`] || snap?.updatedAt || null;
  if (!previous) {
    const out = { ...fresh };
    for (const key of ["all", ...SNAPSHOT_ISPS]) out[`${key}At`] = stamp(fresh, key);
    return out;
  }
  const out = { updatedAt: fresh.updatedAt };
  for (const key of ["all", ...SNAPSHOT_ISPS]) {
    const next = Array.isArray(fresh[key]) ? fresh[key] : [];
    const old = Array.isArray(previous[key]) ? previous[key] : [];
    const useNext = next.length >= min || next.length >= old.length;
    out[key] = useNext ? next : old;
    out[`${key}At`] = useNext ? stamp(fresh, key) : stamp(previous, key);
  }
  return out;
}

export function snapshotList(snapshot, isp, { now = Date.now(), maxAgeMs = SNAPSHOT_MAX_AGE_MS } = {}) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const key = isp && SNAPSHOT_ISPS.includes(isp) ? isp : "all";
  const at = Date.parse(snapshot[`${key}At`] || snapshot.updatedAt || "");
  if (maxAgeMs > 0 && Number.isFinite(at) && now - at > maxAgeMs) return [];
  const list = Array.isArray(snapshot[key]) ? snapshot[key] : [];
  return list.filter((item) => item && typeof item.address === "string" && Number.isFinite(Number(item.rtt)));
}

export async function readSnapshot(kv, key = CN_VERIFIED_KEY) {
  try {
    const raw = await kv?.get?.(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// 订阅兜底：自己的实测 ok 不足 minNodes 时，用快照补进评分表和节点池。
// 快照分数带 stale 标记并加 50 罚分，排在新鲜实测之后；社区快照加 1000，永远排在自己的数据之后。
export function applySnapshotFallback(nodes, scores, snapshotItems, { penalty = 50, source = "cn-snapshot" } = {}) {
  const outNodes = Array.isArray(nodes) ? nodes.slice() : [];
  const outScores = new Map(scores || []);
  const known = new Set(outNodes.map((node) => node.address));
  for (const item of snapshotItems) {
    const current = outScores.get(item.address);
    if (current && (current.unreachable || Number.isFinite(Number(current.rtt)))) continue;
    const rtt = Number(item.rtt);
    outScores.set(item.address, {
      rtt,
      colo: item.colo || undefined,
      samples: 1,
      failed: 0,
      successRate: item.successRate ?? null,
      unreachable: false,
      stale: true,
      rank: (Number.isFinite(Number(item.rank)) ? Number(item.rank) : rtt) + penalty,
    });
    if (!known.has(item.address)) {
      known.add(item.address);
      outNodes.push({ address: item.address, port: Number(item.port) || 443, name: item.address, source });
    }
  }
  return { nodes: outNodes, scores: outScores };
}
