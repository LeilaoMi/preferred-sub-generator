import { generateClashSubscription } from "../generator/clash.js";
import { generateShadowrocketSubscription } from "../generator/shadowrocket.js";
import { generateSingboxSubscription } from "../generator/singbox.js";
import { generateVlessUri } from "../generator/vless.js";
import { requireReadAuth } from "../security/auth.js";
import { jsonResponse, privateTextResponse, unauthorizedResponse } from "../utils/response.js";
import { formatEdgeNodeName } from "../utils/colo.js";
import { readBestIps, readTemplate } from "./kv.js";

const MAX_NODES = 50;

const EDGE_PROBE_UUID = "00000000-0000-4000-8000-000000000000";

function isEdgetunnelProbe(url, request) {
  const uuid = (url.searchParams.get("uuid") || "").toLowerCase();
  const ua = (request.headers.get("user-agent") || "").toLowerCase();
  return url.searchParams.get("host") === "example.com"
    && uuid === EDGE_PROBE_UUID
    && ua.includes("edgetunnel");
}

function templateKeyFromUrl(url) {
  const slot = url.searchParams.get("slot") || url.searchParams.get("template") || "";
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


function errorPayload(code, message) {
  return { ok: false, code, message, error: message };
}

function subscriptionHeaders(filename) {
  return { "Content-Disposition": `inline; filename="${filename}"` };
}
function base64Encode(text) {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(text)));
  }
  return Buffer.from(text, "utf8").toString("base64");
}

function wrapText(text, width) {
  if (!Number.isFinite(width) || width <= 0) return text;
  return text.match(new RegExp(`.{1,${width}}`, "g"))?.join("\n") || text;
}

export async function handleSub(request, env) {
  const url = new URL(request.url);
  const edgeProbe = isEdgetunnelProbe(url, request);

  const auth = edgeProbe ? { authorized: true } : requireReadAuth(request, env);
  if (!auth.authorized) return unauthorizedResponse();

  const type = edgeProbe ? "base64" : (url.searchParams.get("type") || "vless").toLowerCase();
  const template = await readTemplate(env.SUB_KV, templateKeyFromUrl(url));
  const nodes = (await readBestIps(env.SUB_KV)).slice(0, getLimit(url, MAX_NODES));

  if (nodes.length === 0) {
    return jsonResponse(errorPayload("NO_AVAILABLE_NODES", "No available nodes"), 503);
  }

  if (edgeProbe) {
    const probeTemplate = { ...template, uuid: EDGE_PROBE_UUID, host: "example.com", sni: "example.com", path: "/" };
    return privateTextResponse(base64Encode(generateVlessSubscription(probeTemplate, nodes)), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-edge.txt"));
  }

  if (type === "vless") {
    return privateTextResponse(generateVlessSubscription(template, nodes), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub.txt"));
  }

  if (type === "v2rayng" || type === "base64") {
    const wrap = Number(url.searchParams.get("wrap") || 0);
    const encoded = wrapText(base64Encode(generateVlessSubscription(template, nodes)), wrap);
    return privateTextResponse(encoded, "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-base64.txt"));
  }

  if (type === "shadowrocket") {
    return privateTextResponse(generateShadowrocketSubscription(template, normalizeNodes(nodes)), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-shadowrocket.txt"));
  }

  if (type === "clash" || type === "mihomo") {
    return privateTextResponse(generateClashSubscription(template, normalizeNodes(nodes)), "text/yaml; charset=utf-8", subscriptionHeaders("preferred-sub.yaml"));
  }

  if (type === "singbox" || type === "sing-box") {
    return privateTextResponse(generateSingboxSubscription(template, normalizeNodes(nodes)), "application/json; charset=utf-8", subscriptionHeaders("preferred-sub.json"));
  }

  return jsonResponse(errorPayload("UNSUPPORTED_SUBSCRIPTION_TYPE", "Unsupported subscription type"), 400);
}
