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

export async function buildUpdatePayload({ originalNode, manualText, remoteSources, checkOne, previousBestIps = null, now = new Date() }) {
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

  return {
    TEMPLATE: templateValue,
    BEST_IPS: JSON.stringify(bestIps, null, 2),
    STATUS: JSON.stringify(
      {
        updatedAt: now.toISOString(),
        available: bestIps.length,
        newAvailable: nextBestIps.length,
        sourceCount: remoteSources.length + 1,
        sourceMode: "cloudflare-edge",
        checked: checked.length,
        minAvailableToOverwrite: MIN_AVAILABLE_TO_OVERWRITE,
        protectedByPrevious,
        lastError: protectedByPrevious ? `本次可用节点少于 ${MIN_AVAILABLE_TO_OVERWRITE}，已保留上次可用结果` : null,
      },
      null,
      2,
    ),
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

export async function main() {
  const required = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_NAMESPACE_ID", "CLOUDFLARE_API_TOKEN"];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required env: ${name}`);
  }

  const remoteSources = await readJsonFile("sources/edge/remote.json", []);
  const manualText = await readTextFile("sources/edge/manual.txt");
  const previousBestIps = await readPreviousBestIps();
  const originalNode = process.env.ORIGINAL_SUB_OR_NODE || await readCurrentTemplate();
  const payload = await buildUpdatePayload({
    originalNode,
    manualText,
    remoteSources,
    previousBestIps,
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

  console.log(`KV updated: ${Object.keys(payload).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
