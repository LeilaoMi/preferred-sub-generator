import { generateClashSubscription } from "../generator/clash.js";
import { generateShadowrocketSubscription } from "../generator/shadowrocket.js";
import { generateSingboxSubscription } from "../generator/singbox.js";
import { generateVlessUri } from "../generator/vless.js";
import { requireReadAuth } from "../security/auth.js";
import { jsonResponse, privateTextResponse, unauthorizedResponse } from "../utils/response.js";
import { formatEdgeNodeName } from "../utils/colo.js";
import { loadIpScores } from "./ip-feedback.js";
import { readBestIps, readTemplate } from "./kv.js";
import { filterNodesByColo, parseColoFilter, rankNodesByScore, sampleNodes, withPreferredPort } from "./node-filter.js";

const MAX_NODES = 50;
// 探测旁路给 edgetunnel 的数量：够轮换、够轻，16-30 是经验区间
const PROBE_MAX_NODES = 30;

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

function normalizeNodes(nodes, options) {
  return nodes.map((node, index) => ({ ...node, name: formatEdgeNodeName(node, index, options) }));
}

function generateVlessSubscription(template, nodes, options) {
  return normalizeNodes(nodes, options).map((node) => generateVlessUri(template, node)).join("\n");
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
  const sampleMode = url.searchParams.get("mode") === "sample";
  const template = await readTemplate(env.SUB_KV, templateKeyFromUrl(url));
  const { colos } = parseColoFilter(url.searchParams.get("colo"), request);
  let nodes = await readBestIps(env.SUB_KV);
  let scores = null;
  if (url.searchParams.get("rank") !== "off") {
    ({ scores } = await loadIpScores(env));
    if (!sampleMode) nodes = rankNodesByScore(nodes, scores);
  }
  // edgetunnel 探测旁路拼的 URL 不带 mode 参数，但它要的正是"每次来都换一批 IP"的效果，
  // 所以探测直接走抽样（普通订阅不带 mode=sample 时仍维持旧的固定榜，可随时回滚）。
  const probeSampling = edgeProbe || sampleMode;
  if (probeSampling) {
    // 抽样模式：池内先按落点分桶，再加权随机抽（实测只加权、不排名）。
    // 端口统一走 443 优先：从国内运营商实测看，非标准端口（2053/2083/2087 等）
    // 建连超时的概率明显高于 443，端口分散反而拉低了整批节点的可用率；
    // IP 层面的多样性（每次抽不同的 30 个 IP）已经足够做故障隔离。
    nodes = sampleNodes(filterNodesByColo(nodes, colos).nodes, {
      limit: getLimit(url, edgeProbe ? PROBE_MAX_NODES : MAX_NODES),
      scores,
    }).map((node) => withPreferredPort(node));
  } else {
    nodes = filterNodesByColo(nodes, colos).nodes.slice(0, getLimit(url, MAX_NODES));
  }
  const nameOptions = probeSampling ? { hideLatency: true } : undefined;
  const generatorOptions = { autoTest: sampleMode };

  if (nodes.length === 0) {
    return jsonResponse(errorPayload("NO_AVAILABLE_NODES", "No available nodes"), 503);
  }

  if (edgeProbe) {
    const probeTemplate = { ...template, uuid: EDGE_PROBE_UUID, host: "example.com", sni: "example.com", path: "/" };
    return privateTextResponse(base64Encode(generateVlessSubscription(probeTemplate, nodes, nameOptions)), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-edge.txt"));
  }

  if (type === "vless") {
    return privateTextResponse(generateVlessSubscription(template, nodes, nameOptions), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub.txt"));
  }

  if (type === "v2rayng" || type === "base64") {
    const wrap = Number(url.searchParams.get("wrap") || 0);
    const encoded = wrapText(base64Encode(generateVlessSubscription(template, nodes, nameOptions)), wrap);
    return privateTextResponse(encoded, "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-base64.txt"));
  }

  if (type === "shadowrocket") {
    return privateTextResponse(generateShadowrocketSubscription(template, normalizeNodes(nodes, nameOptions)), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-shadowrocket.txt"));
  }

  if (type === "clash" || type === "mihomo") {
    return privateTextResponse(generateClashSubscription(template, normalizeNodes(nodes, nameOptions), generatorOptions), "text/yaml; charset=utf-8", subscriptionHeaders("preferred-sub.yaml"));
  }

  if (type === "singbox" || type === "sing-box") {
    return privateTextResponse(generateSingboxSubscription(template, normalizeNodes(nodes, nameOptions), generatorOptions), "application/json; charset=utf-8", subscriptionHeaders("preferred-sub.json"));
  }

  return jsonResponse(errorPayload("UNSUPPORTED_SUBSCRIPTION_TYPE", "Unsupported subscription type"), 400);
}
