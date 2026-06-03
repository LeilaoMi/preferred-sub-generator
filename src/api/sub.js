import { generateClashSubscription } from "../generator/clash.js";
import { generateShadowrocketSubscription } from "../generator/shadowrocket.js";
import { generateSingboxSubscription } from "../generator/singbox.js";
import { generateVlessUri } from "../generator/vless.js";
import { isAuthorized } from "../security/auth.js";
import { jsonResponse, textResponse, unauthorizedResponse } from "../utils/response.js";
import { readBestIps, readTemplate } from "./kv.js";

const MAX_NODES = 50;

function getLimit(url, total) {
  const requested = Number(url.searchParams.get("n") || total);
  if (!Number.isFinite(requested) || requested <= 0) return total;
  return Math.min(requested, MAX_NODES, total);
}

function generateVlessSubscription(template, nodes) {
  return nodes.map((node, index) => generateVlessUri(template, { name: `优选-${index + 1}`, ...node })).join("\n");
}

function base64Encode(text) {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(text)));
  }
  return Buffer.from(text, "utf8").toString("base64");
}

export async function handleSub(request, env) {
  if (!isAuthorized(request, env)) return unauthorizedResponse();

  const url = new URL(request.url);
  const type = (url.searchParams.get("type") || "vless").toLowerCase();
  const template = await readTemplate(env.SUB_KV);
  const nodes = (await readBestIps(env.SUB_KV)).slice(0, getLimit(url, MAX_NODES));

  if (nodes.length === 0) {
    return jsonResponse({ error: "No available nodes" }, 503);
  }

  if (type === "vless") {
    return textResponse(generateVlessSubscription(template, nodes));
  }

  if (type === "v2rayng" || type === "base64") {
    return textResponse(base64Encode(generateVlessSubscription(template, nodes)));
  }

  if (type === "shadowrocket") {
    return textResponse(generateShadowrocketSubscription(template, nodes));
  }

  if (type === "clash" || type === "mihomo") {
    return textResponse(generateClashSubscription(template, nodes), "text/yaml; charset=utf-8");
  }

  if (type === "singbox" || type === "sing-box") {
    return textResponse(generateSingboxSubscription(template, nodes));
  }

  return jsonResponse({ error: "Unsupported subscription type" }, 400);
}
