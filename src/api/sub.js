import { generateClashSubscription } from "../generator/clash.js";
import { generateShadowrocketSubscription } from "../generator/shadowrocket.js";
import { generateSingboxSubscription } from "../generator/singbox.js";
import { generateVlessUri } from "../generator/vless.js";
import { requireReadAuth } from "../security/auth.js";
import { jsonResponse, privateTextResponse, unauthorizedResponse } from "../utils/response.js";
import { formatEdgeNodeName } from "../utils/colo.js";
import { loadIpScores } from "./ip-feedback.js";
import { getNodeConfig, nodeConfigToTemplate, validateNodeConfig } from "../config/nodes.js";
import { readBestIps, readBestIpsV6 } from "./kv.js";
import { filterNodesByColo, parseColoFilter, rankNodesByScore, sampleNodes, withPreferredPort } from "./node-filter.js";
import { getPreferredPortOrder } from "../utils/ports.js";

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
  // P1-4: Subscription-Userinfo 让客户端订阅页显示流量/到期信息，而非空白（私用场景填象征值）
  const expire = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  return {
    "Content-Disposition": `inline; filename="${filename}"`,
    "Subscription-Userinfo": `upload=0; download=107374182400; total=107374182400; expire=${expire}`,
  };
}

// P1-5: type 缺省时按客户端 UA 推断格式；显式 ?type= 优先
export function inferTypeFromUa(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return null;
  if (ua.includes("clash") || ua.includes("mihomo")) return "clash";
  if (ua.includes("sing-box") || ua.includes("singbox")) return "sing-box";
  if (ua.includes("surge")) return "clash"; // 无原生 surge 分支，最接近的是 clash
  if (ua.includes("shadowrocket")) return "shadowrocket";
  if (ua.includes("v2rayng") || ua.includes("v2ray")) return "v2rayng";
  return null;
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

  const auth = edgeProbe ? { authorized: true } : await requireReadAuth(request, env);
  if (!auth.authorized) return unauthorizedResponse();

  const explicitType = url.searchParams.get("type");
  const type = edgeProbe ? "base64" : (explicitType || inferTypeFromUa(request.headers.get("user-agent")) || "vless").toLowerCase();
  const sampleMode = url.searchParams.get("mode") === "sample";
  // 节点参数来自环境变量（对标竞品离散配置），不再读 KV 模板
  let nodeConfig;
  try {
    nodeConfig = getNodeConfig(env);
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
  const configWarnings = validateNodeConfig(nodeConfig);
  if (configWarnings.some((w) => w.level === "error")) {
    return jsonResponse({ error: configWarnings.find((w) => w.level === "error").message }, 500);
  }
  const template = nodeConfigToTemplate(nodeConfig);
  const { colos } = parseColoFilter(url.searchParams.get("colo"), request);
  let nodes = await readBestIps(env.SUB_KV);
  let scores = null;
  if (url.searchParams.get("rank") !== "off") {
    ({ scores } = await loadIpScores(env));
    if (!sampleMode) nodes = rankNodesByScore(nodes, scores, { env });
  }
  // edgetunnel 探测旁路拼的 URL 不带 mode 参数，但它要的正是"每次来都换一批 IP"的效果，
  // 所以探测直接走抽样（普通订阅不带 mode=sample 时仍维持旧的固定榜，可随时回滚）。
  const probeSampling = edgeProbe || sampleMode;
  // P1-3: SUB_PREFERRED_PORTS 可覆盖端口顺序
  const portOrder = getPreferredPortOrder(env);
  if (probeSampling) {
    // 抽样模式：池内先按落点分桶，再加权随机抽（实测只加权、不排名）。
    // 端口统一走 443 优先：从国内运营商实测看，非标准端口（2053/2083/2087 等）
    // 建连超时的概率明显高于 443，端口分散反而拉低了整批节点的可用率；
    // IP 层面的多样性（每次抽不同的 30 个 IP）已经足够做故障隔离。
    nodes = sampleNodes(filterNodesByColo(nodes, colos).nodes, {
      limit: getLimit(url, edgeProbe ? PROBE_MAX_NODES : MAX_NODES),
      scores,
      scoreOptions: { env },
    }).map((node) => withPreferredPort(node, portOrder));
  } else {
    nodes = filterNodesByColo(nodes, colos).nodes.slice(0, getLimit(url, MAX_NODES));
  }
  // P2-6: ?ip6=1 追加未实测 IPv6（不占 limit 名额、不进排名抽样；探测旁路不混入）
  if (!edgeProbe && url.searchParams.get("ip6") === "1") {
    const v6Nodes = await readBestIpsV6(env.SUB_KV);
    nodes = [...nodes, ...v6Nodes.map((node) => withPreferredPort({ ...node, name: `[IPv6] ${node.name || node.address}` }, portOrder))];
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
