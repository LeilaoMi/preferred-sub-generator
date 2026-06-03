import { generateClashSubscription } from "../generator/clash.js";
import { generateShadowrocketSubscription } from "../generator/shadowrocket.js";
import { generateSingboxSubscription } from "../generator/singbox.js";
import { generateVlessUri } from "../generator/vless.js";
import { jsonResponse, cachedTextResponse } from "../utils/response.js";
import { formatEdgeNodeName } from "../utils/colo.js";
import { readBestIps, readTemplate } from "./kv.js";

const MAX_NODES = 50;

function templateKeyFromUrl(url) {
  const slot = url.searchParams.get("template") || "";
  if (!slot) return "TEMPLATE";
  if (!/^\d{1,2}$/.test(slot)) return "TEMPLATE";
  const n = Number(slot);
  return n >= 1 && n <= 5 ? `TEMPLATE_${n}` : "TEMPLATE";
}

function getLimit(url, total) {
  const requested = Number(url.searchParams.get("n") || total);
  if (!Number.isFinite(requested) || requested <= 0) return total;
  return Math.min(requested, MAX_NODES, total);
}

function normalizeNodes(nodes) {
  return nodes.map((node, index) => ({ ...node, name: formatEdgeNodeName(node, index) }));
}

function generateVlessSubscription(template, nodes) {
  return normalizeNodes(nodes).map((node) => generateVlessUri(template, node)).join("\n");
}

function base64Encode(text) {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(text)));
  }
  return Buffer.from(text, "utf8").toString("base64");
}

export async function handleSub(request, env) {
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") || "vless").toLowerCase();
  const template = await readTemplate(env.SUB_KV, templateKeyFromUrl(url));
  const nodes = (await readBestIps(env.SUB_KV)).slice(0, getLimit(url, MAX_NODES));

  if (nodes.length === 0) {
    return jsonResponse({ error: "No available nodes" }, 503);
  }

  if (type === "vless") {
    return cachedTextResponse(generateVlessSubscription(template, nodes));
  }

  if (type === "v2rayng" || type === "base64") {
    return cachedTextResponse(base64Encode(generateVlessSubscription(template, nodes)));
  }

  if (type === "shadowrocket") {
    return cachedTextResponse(generateShadowrocketSubscription(template, normalizeNodes(nodes)));
  }

  if (type === "clash" || type === "mihomo") {
    return cachedTextResponse(generateClashSubscription(template, normalizeNodes(nodes)), "text/yaml; charset=utf-8");
  }

  if (type === "singbox" || type === "sing-box") {
    return cachedTextResponse(generateSingboxSubscription(template, normalizeNodes(nodes)));
  }

  return jsonResponse({ error: "Unsupported subscription type" }, 400);
}
