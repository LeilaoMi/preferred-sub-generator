import fs from "node:fs/promises";
import { parseVlessUri } from "../src/parser/vless.js";
import { formatEdgeNodeName } from "../src/utils/colo.js";
import { getPortsForSecurity } from "../src/utils/ports.js";
import { checkCandidates } from "./lib/check.js";
import { collectCandidatesWithHealth } from "./lib/candidates.js";
import { deleteKvValue, readKvValue, writeKvValue } from "./lib/kv.js";

const ROOT = new URL("..", import.meta.url);
const MIN_AVAILABLE_TO_OVERWRITE = 20;
const DEFAULT_VERSION_RETENTION = 30;

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
  now = new Date(),
  requireCfRay = true,
  allowTcpOnly = false,
  maxSourceBytes,
  versionRetention = DEFAULT_VERSION_RETENTION,
} = {}) {
  const templateValue = originalNode.trim();
  const template = parseVlessUri(templateValue);
  const { candidates, sourceHealth } = await collectCandidatesWithHealth({ manualText, remoteSources, fetchImpl, maxSourceBytes });
  const checked = await checkCandidates(candidates, getPortsForSecurity(template.security), {
    checkOne,
    checkOptions: {
      host: template.host || template.sni || template.address,
      tlsEnabled: template.security === "tls",
    },
    requireCfRay,
    allowTcpOnly,
  });
  const nextBestIps = checked.slice(0, 50).map((item, index) => ({
    address: item.address,
    port: item.port,
    name: edgeName(item, index),
    latency: item.latency,
    speed: item.speed == null ? null : (Number.isFinite(Number(item.speed)) ? Number(item.speed) : null),
    colo: item.colo,
    edgeVerified: item.edgeVerified,
    source: item.source,
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

async function notifyWebhook(payload) {
  const url = process.env.UPDATE_WEBHOOK_URL;
  if (!url) return;

  const status = JSON.parse(payload.STATUS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "preferred-sub-generator.update",
        updatedAt: status.updatedAt,
        available: status.available,
        newAvailable: status.newAvailable,
        fallbackActive: status.protectedByPrevious,
        consecutiveFallbacks: status.consecutiveFallbacks,
        lastSuccessfulRefreshAt: status.lastSuccessfulRefreshAt,
        lastError: status.lastError,
      }),
    });
    if (!response.ok) console.warn(`Webhook notification failed: ${response.status}`);
  } catch (error) {
    console.warn(`Webhook notification failed: ${error.message}`);
  }
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

  await notifyWebhook(payload);
  console.log(`KV updated: ${Object.keys(payload).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
