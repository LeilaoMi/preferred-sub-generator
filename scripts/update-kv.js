import fs from "node:fs/promises";
import { parseVlessUri } from "../src/parser/vless.js";
import { formatEdgeNodeName } from "../src/utils/colo.js";
import { getPortsForSecurity } from "../src/utils/ports.js";
import { checkCandidates } from "./lib/check.js";
import { collectCandidates } from "./lib/candidates.js";
import { readKvValue, writeKvValue } from "./lib/kv.js";

const ROOT = new URL("..", import.meta.url);
const MIN_AVAILABLE_TO_OVERWRITE = 20;

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

function buildVersionKey(now) {
  return `BEST_IPS_${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`;
}

export async function buildUpdatePayload({ originalNode, manualText, remoteSources, checkOne, previousBestIps = null, previousTrendHistory = null, now = new Date() }) {
  const templateValue = originalNode.trim();
  const template = parseVlessUri(templateValue);
  const candidates = await collectCandidates({ manualText, remoteSources });
  const checked = await checkCandidates(candidates, getPortsForSecurity(template.security), {
    checkOne,
    checkOptions: {
      host: template.host || template.sni || template.address,
      tlsEnabled: template.security === "tls",
    },
  });
  const nextBestIps = checked.slice(0, 50).map((item, index) => ({
    address: item.address,
    port: item.port,
    name: edgeName(item, index),
    latency: item.latency,
    colo: item.colo,
    edgeVerified: item.edgeVerified,
    source: item.source,
  }));
  const protectedByPrevious = nextBestIps.length < MIN_AVAILABLE_TO_OVERWRITE && Array.isArray(previousBestIps) && previousBestIps.length > 0;
  const bestIps = protectedByPrevious ? previousBestIps : nextBestIps;
  const currentStatus = {
    updatedAt: now.toISOString(),
    available: bestIps.length,
    newAvailable: nextBestIps.length,
    sourceCount: remoteSources.length + 1,
    sourceMode: "cloudflare-edge",
    checked: checked.length,
    averageLatency: averageLatency(bestIps),
    minAvailableToOverwrite: MIN_AVAILABLE_TO_OVERWRITE,
    protectedByPrevious,
    lastError: protectedByPrevious ? `本次可用节点少于 ${MIN_AVAILABLE_TO_OVERWRITE}，已保留上次可用结果` : null,
  };

  return {
    TEMPLATE: templateValue,
    BEST_IPS: JSON.stringify(bestIps, null, 2),
    [buildVersionKey(now)]: JSON.stringify(bestIps, null, 2),
    BEST_IPS_LAST: JSON.stringify(bestIps, null, 2),
    BEST_IPS_LATEST_VERSION: buildVersionKey(now),
    BEST_IPS_TREND: JSON.stringify(buildTrendHistory(previousTrendHistory, currentStatus, now), null, 2),
    LAST_RUN_AT: now.toISOString(),
    LAST_RUN_OK: String(bestIps.length > 0),
    LAST_RUN_AVAILABLE: String(bestIps.length),
    LAST_RUN_NEW_AVAILABLE: String(nextBestIps.length),
    STATUS: JSON.stringify(currentStatus, null, 2),
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

async function notifyWebhook(payload) {
  const url = process.env.UPDATE_WEBHOOK_URL;
  if (!url) return;

  const status = JSON.parse(payload.STATUS);
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "preferred-sub-generator.update",
      updatedAt: status.updatedAt,
      available: status.available,
      newAvailable: status.newAvailable,
      fallbackActive: status.protectedByPrevious,
      lastError: status.lastError,
    }),
  });
}

export async function main() {
  const required = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_NAMESPACE_ID", "CLOUDFLARE_API_TOKEN"];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required env: ${name}`);
  }

  const remoteSources = await readJsonFile("sources/edge/remote.json", []);
  const manualText = await readTextFile("sources/edge/manual.txt");
  const previousBestIps = await readPreviousBestIps();
  const previousTrendHistory = await readPreviousTrendHistory();
  const originalNode = process.env.ORIGINAL_SUB_OR_NODE || await readCurrentTemplate();
  const payload = await buildUpdatePayload({
    originalNode,
    manualText,
    remoteSources,
    previousBestIps,
    previousTrendHistory,
  });

  for (const [key, value] of Object.entries(payload)) {
    await writeKvValue({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      key,
      value,
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
