import fs from "node:fs/promises";
import { parseVlessUri } from "../src/parser/vless.js";
import { formatEdgeNodeName } from "../src/utils/colo.js";
import { getPortsForSecurity } from "../src/utils/ports.js";
import { checkCandidates } from "./lib/check.js";
import { collectCandidatesWithHealth, isIPv6 } from "./lib/candidates.js";
import { downloadSpeed } from "./lib/speed.js";
import { runAlertStage } from "./lib/alert.js";
import { deleteKvValue, readKvValue, writeKvValue } from "./lib/kv.js";

const ROOT = new URL("..", import.meta.url);
const MIN_AVAILABLE_TO_OVERWRITE = 20;
const DEFAULT_VERSION_RETENTION = 30;
// KV 里存的是"过审池"而不是发给所有人的固定前 50 名；订阅端从池里抽样，池要够大才有轮换空间
const MAX_POOL_NODES = 300;
// P2-6: 未实测 IPv6 独立池上限
const MAX_V6_NODES = 100;
// P2-10: GHA 带宽抽测参数（只测 Top N，不对全池测）
const BANDWIDTH_TOP_N = 30;
const BANDWIDTH_BYTES = 1000000;
const BANDWIDTH_CONCURRENCY = 2;
const BANDWIDTH_TIMEOUT_MS = 15000;

// P2-6: IPv6 候选不进 check（GHA 无 v6 出口，测了也全超时），单独收进未实测池
function buildV6Pool(v6Candidates) {
  const seen = new Set();
  const nodes = [];
  for (const candidate of v6Candidates) {
    const port = candidate.port || 443;
    const key = `${candidate.address}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push({
      address: candidate.address,
      port,
      ports: [port],
      name: "",
      latency: null,
      speed: null,
      colo: "",
      edgeVerified: false,
      source: candidate.source,
      untested6: true,
    });
  }
  return nodes.slice(0, MAX_V6_NODES).map((node, index) => ({ ...node, name: edgeName(node, index) }));
}

// P2-10: 优先用本轮实测带宽，其次保留候选自带 speed（CSV），都没有则 null
function pickSpeed(item) {
  const measured = Number(item.measuredSpeed);
  if (Number.isFinite(measured) && measured > 0) return measured;
  if (item.speed == null) return null;
  const fallback = Number(item.speed);
  return Number.isFinite(fallback) ? fallback : null;
}

// P2-10: 对入池 Top N 做带宽抽测；成功则记 measuredSpeed，失败不阻断（保留原有 speed）
async function measureTopBandwidth(nodes, { servername, downloadSpeedImpl = downloadSpeed }) {
  const targets = nodes.slice(0, BANDWIDTH_TOP_N);
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const node = targets[cursor];
      cursor += 1;
      try {
        const speed = await downloadSpeedImpl(node.address, node.port, {
          servername,
          bytes: BANDWIDTH_BYTES,
          timeoutMs: BANDWIDTH_TIMEOUT_MS,
        });
        if (Number.isFinite(speed) && speed > 0) node.measuredSpeed = speed;
      } catch {
        // 失败不阻断：保留原有 speed
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BANDWIDTH_CONCURRENCY, targets.length) }, worker));
  return nodes;
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(new URL(path, ROOT), "utf8"));
  } catch {
    return fallback;
  }
}

async function readTextFile(path, fallback = "") {
  try {
    return await fs.readFile(new URL(path, ROOT), "utf8");
  } catch {
    return fallback;
  }
}

function edgeName(item, index) {
  return formatEdgeNodeName(item, index);
}

// 检查结果是 (地址 × 端口) 的平铺列表；按地址聚合为一条池记录，记下全部通过端口，
// 首选端口优先 443（国内对非 443 的 CF 端口更不友好），其次取测到的最优那条。
export function aggregateCheckedResults(checked) {
  const byAddress = new Map();
  for (const item of Array.isArray(checked) ? checked : []) {
    if (!item?.address) continue;
    const group = byAddress.get(item.address);
    if (group) group.push(item);
    else byAddress.set(item.address, [item]);
  }

  return [...byAddress.values()].map((results) => {
    const ports = [...new Set(results.map((item) => Number(item.port)).filter((port) => Number.isFinite(port) && port > 0))]
      .sort((a, b) => (a === 443 ? -1 : b === 443 ? 1 : a - b));
    const preferred = results.find((item) => Number(item.port) === ports[0]) || results[0];
    return {
      address: preferred.address,
      port: ports[0] ?? preferred.port,
      ports,
      latency: preferred.latency,
      speed: preferred.speed ?? null,
      colo: preferred.colo || results.find((item) => item.colo)?.colo || "",
      edgeVerified: results.some((item) => item.edgeVerified),
      source: preferred.source || results[0]?.source,
      // P1-8: 抖动透传（优选端口的采样值，缺失时取任一可用值）
      jitter: preferred.jitter ?? results.find((item) => item.jitter != null)?.jitter ?? null,
    };
  });
}

function buildTrendHistory(previousHistory, current, now) {
  const history = Array.isArray(previousHistory) ? previousHistory : [];
  return [
    ...history,
    {
      date: now.toISOString(),
      available: current.available,
      newAvailable: current.newAvailable,
      averageLatency: current.averageLatency,
      fallbackActive: current.protectedByPrevious,
    },
  ].slice(-7);
}

function averageLatency(items) {
  const values = items.map((item) => item.latency).filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function averageSpeed(items) {
  const values = items.map((item) => item.speed).filter((value) => value != null && Number.isFinite(Number(value)));
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + Number(value), 0) / values.length);
}

function buildVersionKey(now) {
  return `BEST_IPS_${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`;
}

function buildVersionIndex(previousIndex, versionKey, versionRetention = DEFAULT_VERSION_RETENTION) {
  const existing = Array.isArray(previousIndex) ? previousIndex.filter((key) => typeof key === "string") : [];
  const versions = [versionKey, ...existing.filter((key) => key !== versionKey)];
  const keep = Number.isFinite(versionRetention) && versionRetention > 0 ? versionRetention : DEFAULT_VERSION_RETENTION;
  return {
    versions: versions.slice(0, keep),
    expired: versions.slice(keep),
  };
}

function previousFallbackCount(previousStatus) {
  const count = Number(previousStatus?.consecutiveFallbacks || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export async function buildUpdatePayload({
  originalNode,
  manualText,
  remoteSources,
  previousBestIps = [],
  previousStatus = {},
  previousTrend = [],
  previousVersionIndex = [],
  checkOne,
  fetchImpl,
  downloadSpeedImpl,
  now = new Date(),
  requireCfRay = true,
  allowTcpOnly = false,
  maxSourceBytes,
  versionRetention = DEFAULT_VERSION_RETENTION,
  poolLimit = MAX_POOL_NODES,
} = {}) {
  const templateValue = originalNode.trim();
  const template = parseVlessUri(templateValue);
  const { candidates: allCandidates, sourceHealth } = await collectCandidatesWithHealth({ manualText, remoteSources, fetchImpl, maxSourceBytes });
  // P2-6: IPv6 单独分流，不进 check
  const v6Candidates = [];
  const candidates = [];
  for (const candidate of allCandidates) {
    (isIPv6(candidate.address) ? v6Candidates : candidates).push(candidate);
  }
  const v6Pool = buildV6Pool(v6Candidates);
  const checkParams = {
    host: template.host || template.sni || template.address,
    tlsEnabled: template.security === "tls",
  };
  const checked = await checkCandidates(candidates, getPortsForSecurity(template.security, process.env), {
    checkOne,
    checkOptions: checkParams,
    requireCfRay,
    allowTcpOnly,
  });
  const aggregated = aggregateCheckedResults(checked).slice(0, poolLimit);
  // P1-8: 第二轮抖动采样——只对入池候选的优选端口测 3 次，不对全量候选 3 倍探测
  const jitterSamples = await checkCandidates(
    aggregated.map((item) => ({ address: item.address, port: item.port, source: item.source })),
    [],
    { checkOne, checkOptions: checkParams, requireCfRay, allowTcpOnly, jitterSamples: 3, concurrency: 10 },
  );
  const jitterByAddress = new Map(jitterSamples.map((item) => [item.address, item.jitter ?? null]));
  // P2-10: 带宽抽测（Top 30），结果写回 measuredSpeed；失败不阻断
  await measureTopBandwidth(aggregated, { servername: checkParams.host, downloadSpeedImpl });
  const nextBestIps = aggregated.map((item, index) => ({
    address: item.address,
    port: item.port,
    ports: item.ports,
    name: edgeName(item, index),
    latency: item.latency,
    speed: pickSpeed(item),
    colo: item.colo,
    edgeVerified: item.edgeVerified,
    source: item.source,
    jitter: jitterByAddress.has(item.address) ? jitterByAddress.get(item.address) : null,
  }));
  const protectedByPrevious = nextBestIps.length < MIN_AVAILABLE_TO_OVERWRITE && Array.isArray(previousBestIps) && previousBestIps.length > 0;
  const bestIps = protectedByPrevious ? previousBestIps : nextBestIps;
  const versionKey = buildVersionKey(now);
  const versionIndex = buildVersionIndex(previousVersionIndex, versionKey, versionRetention);
  const currentStatus = {
    updatedAt: now.toISOString(),
    available: bestIps.length,
    newAvailable: nextBestIps.length,
    lastRawAvailable: nextBestIps.length,
    lastSuccessfulRefreshAt: protectedByPrevious ? (previousStatus?.lastSuccessfulRefreshAt || null) : now.toISOString(),
    consecutiveFallbacks: protectedByPrevious ? previousFallbackCount(previousStatus) + 1 : 0,
    sourceCount: remoteSources.length + 1,
    sourceMode: "cloudflare-edge",
    sourceHealth,
    requireCfRay,
    allowTcpOnly,
    checked: checked.length,
    speedtestLocation: "GitHub Actions (US)",
    speedtestLocationNote: "colo/latency/speed 均为美国机房测速结果，国内实际接入节点地区以本地为准（CF Anycast 就近分配）",
    averageLatency: averageLatency(bestIps),
    averageLatencyNewScan: averageLatency(nextBestIps),
    averageSpeed: averageSpeed(bestIps),
    averageSpeedNewScan: averageSpeed(nextBestIps),
    minAvailableToOverwrite: MIN_AVAILABLE_TO_OVERWRITE,
    protectedByPrevious,
    lastError: protectedByPrevious ? `本次可用节点少于 ${MIN_AVAILABLE_TO_OVERWRITE}，已保留上次可用结果` : null,
  };

  return {
    TEMPLATE: templateValue,
    BEST_IPS: JSON.stringify(bestIps, null, 2),
    BEST_IPS_V6: JSON.stringify(v6Pool, null, 2),
    [versionKey]: JSON.stringify(bestIps, null, 2),
    BEST_IPS_LAST: JSON.stringify(bestIps, null, 2),
    BEST_IPS_LATEST_VERSION: versionKey,
    BEST_IPS_VERSION_INDEX: JSON.stringify(versionIndex.versions, null, 2),
    BEST_IPS_EXPIRED_VERSIONS: JSON.stringify(versionIndex.expired, null, 2),
    BEST_IPS_TREND: JSON.stringify(buildTrendHistory(previousTrend, currentStatus, now), null, 2),
    LAST_RUN_AT: now.toISOString(),
    LAST_RUN_OK: String(bestIps.length > 0),
    LAST_RUN_AVAILABLE: String(bestIps.length),
    LAST_RUN_NEW_AVAILABLE: String(nextBestIps.length),
    STATUS: JSON.stringify(currentStatus, null, 2),
    SOURCE_HEALTH: JSON.stringify(sourceHealth, null, 2),
  };
}

async function readCurrentTemplate() {
  const value = await readKvValue({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    key: "TEMPLATE",
  });
  if (!value) throw new Error("Missing TEMPLATE. Please save a VLESS template from the web page first.");
  return value.trim();
}

async function readPreviousBestIps() {
  const value = await readKvValue({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    key: "BEST_IPS",
  });
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readPreviousTrendHistory() {
  const value = await readKvValue({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    key: "BEST_IPS_TREND",
  });
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readPreviousStatus() {
  const value = await readKvValue({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    key: "STATUS",
  });
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function readPreviousVersionIndex() {
  const value = await readKvValue({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    key: "BEST_IPS_VERSION_INDEX",
  });
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function postWebhook(body) {
  const url = process.env.UPDATE_WEBHOOK_URL;
  if (!url) return false;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) console.warn(`Webhook notification failed: ${response.status}`);
    return response.ok;
  } catch (error) {
    console.warn(`Webhook notification failed: ${error.message}`);
    return false;
  }
}

async function readPreviousAlertState() {
  const value = await readKvValue({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    key: "ALERT_STATE",
  });
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function numberEnv(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : undefined;
}

export async function main() {
  const required = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_NAMESPACE_ID", "CLOUDFLARE_API_TOKEN"];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required env: ${name}`);
  }

  const remoteSources = await readJsonFile("sources/edge/remote.json", []);
  const manualText = await readTextFile("sources/edge/manual.txt");
  const previousBestIps = await readPreviousBestIps();
  const previousTrend = await readPreviousTrendHistory();
  const previousStatus = await readPreviousStatus();
  const previousVersionIndex = await readPreviousVersionIndex();
  const previousAlertState = await readPreviousAlertState();
  const originalNode = process.env.ORIGINAL_SUB_OR_NODE || await readCurrentTemplate();
  const env = {
    REQUIRE_CF_RAY: process.env.REQUIRE_CF_RAY || "1",
    ALLOW_TCP_ONLY: process.env.ALLOW_TCP_ONLY || "0",
    SOURCE_MAX_BYTES: process.env.SOURCE_MAX_BYTES || "",
    VERSION_RETENTION: process.env.VERSION_RETENTION || "",
  };
  const payload = await buildUpdatePayload({
    originalNode,
    manualText,
    remoteSources,
    previousBestIps,
    previousStatus,
    previousTrend,
    previousVersionIndex,
    requireCfRay: env.REQUIRE_CF_RAY !== "0",
    allowTcpOnly: env.ALLOW_TCP_ONLY === "1",
    maxSourceBytes: Number(env.SOURCE_MAX_BYTES) || undefined,
    versionRetention: Number(env.VERSION_RETENTION) || undefined,
  });

  const expiredVersions = JSON.parse(payload.BEST_IPS_EXPIRED_VERSIONS);
  delete payload.BEST_IPS_EXPIRED_VERSIONS;

  for (const [key, value] of Object.entries(payload)) {
    await writeKvValue({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      key,
      value,
    });
  }

  for (const key of expiredVersions) {
    await deleteKvValue({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      key,
    });
  }

  const alert = await runAlertStage({
    status: JSON.parse(payload.STATUS),
    previousStatus,
    previousAlertState,
    repeatHours: numberEnv("ALERT_REPEAT_HOURS"),
    fallbackThreshold: numberEnv("ALERT_FALLBACK_THRESHOLD"),
    minAvailable: numberEnv("ALERT_MIN_AVAILABLE"),
    dropRatio: numberEnv("ALERT_DROP_RATIO"),
    always: process.env.UPDATE_WEBHOOK_ALWAYS === "1",
    notify: postWebhook,
    saveState: (state) => writeKvValue({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      key: "ALERT_STATE",
      value: JSON.stringify(state, null, 2),
    }),
  });

  console.log(`KV updated: ${Object.keys(payload).join(", ")}`);
  console.log(`Alert: level=${alert.level} notified=${alert.notified} type=${alert.alertType}`);
}

export async function reportRunFailure(error) {
  await postWebhook({
    event: "preferred-sub-generator.alert",
    alertType: "run-failed",
    level: "critical",
    reasons: ["run-failed"],
    error: error?.message || String(error),
    failedAt: new Date().toISOString(),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (error) => {
    console.error(error.message);
    try {
      await reportRunFailure(error);
    } catch {
      // 通知失败不影响退出码
    }
    process.exit(1);
  });
}
