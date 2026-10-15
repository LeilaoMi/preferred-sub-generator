import { generateClashSubscription } from "../generator/clash.js";
import { generateShadowrocketSubscription } from "../generator/shadowrocket.js";
import { generateSingboxSubscription } from "../generator/singbox.js";
import { generateVlessUri } from "../generator/vless.js";
import { generateSurgeSubscription } from "../generator/surge.js";
import { generateLoonSubscription } from "../generator/loon.js";
import { generateStashSubscription } from "../generator/stash.js";
import { requireReadAuth } from "../security/auth.js";
import { jsonResponse, privateTextResponse, unauthorizedResponse } from "../utils/response.js";
import { formatEdgeNodeName } from "../utils/colo.js";
import { loadIpScores, normalizeIsp } from "./ip-feedback.js";
import { applySnapshotFallback, CN_COMMUNITY_KEY, CN_VERIFIED_KEY, readSnapshot, snapshotList } from "./cn-verified.js";
import { applyHostRotation, readHostHealth, rotationEnabled } from "./host-health.js";
import { getNodeConfig, getNodeConfigFromUrl, nodeConfigToTemplate, validateNodeConfig } from "../config/nodes.js";
import { readBestIps, readBestIpsV6, readPendingCnIps } from "./kv.js";
import { filterNodesByColo, isMeasuredOk, parseColoFilter, readMinNodes, readRttDropMs, sampleNodes, selectVerifiedNodes, withPreferredPort } from "./node-filter.js";
import { getPreferredPortOrder, NON_TLS_PORTS } from "../utils/ports.js";

const MAX_NODES = 50;
// 探测旁路给 edgetunnel 的节点上限
const PROBE_MAX_NODES = 30;

const EDGE_PROBE_UUID = "00000000-0000-4000-8000-000000000000";
const EDGE_TEMPLATE = Object.freeze({
  uuid: EDGE_PROBE_UUID,
  host: "example.com",
  sni: "example.com",
  path: "/",
  port: 443,
  type: "ws",
  security: "tls",
});

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
  // Stash 的 UA 形如 "Stash/2.x Clash/1.x"，必须先于 clash 判断
  if (ua.includes("stash")) return "stash";
  if (ua.includes("clash") || ua.includes("mihomo")) return "clash";
  if (ua.includes("sing-box") || ua.includes("singbox")) return "sing-box";
  if (ua.includes("surge")) return "surge";
  if (ua.includes("loon")) return "loon";
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

// 子域名决定运营商：ct./cu./cm.<你的域名>（也认 dx/lt/yd）。edgetunnel 的 sub:// 会丢掉 ?参数但保留子域名，
// 所以给 Pages 项目多绑几个子域名，就能在 edgetunnel 里分别填三网订阅。
const HOST_ISP = { ct: "CT", dx: "CT", cu: "CU", lt: "CU", cm: "CM", yd: "CM" };
export function ispFromHost(hostname) {
  const label = String(hostname || "").toLowerCase().split(".")[0];
  return HOST_ISP[label] || null;
}

async function readDefaultIsp(kv) {
  try {
    const state = JSON.parse((await kv?.get?.("CN_PROBE_STATE")) || "{}");
    return normalizeIsp(state.defaultIsp);
  } catch {
    return null;
  }
}

// edgetunnel 拉 sub:// 时：非 2xx 会被它变成 127.0.0.1:1234 假节点，而且请求没有超时。
// 所以探测旁路永远返回 200，并缓存 5 分钟；生成失败时退回国内快照。
const EDGE_CACHE_SECONDS = 300;

async function edgeSnapshotResponse(env, isp) {
  let items = [];
  try {
    items = snapshotList(await readSnapshot(env.SUB_KV, CN_VERIFIED_KEY).catch(() => null), isp);
  } catch {
    items = [];
  }
  const nodes = dropTlsPortMismatch(items.slice(0, PROBE_MAX_NODES), EDGE_TEMPLATE);
  return privateTextResponse(base64Encode(generateVlessSubscription(EDGE_TEMPLATE, nodes)), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-edge.txt"));
}

export async function handleSub(request, env) {
  const url = new URL(request.url);
  if (!isEdgetunnelProbe(url, request)) return buildSub(request, env, url, false);

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const edgeIsp = ispFromHost(url.hostname) || normalizeIsp(env.SUB_DEFAULT_ISP);
  const cacheKey = new Request(`${url.origin}/__edge-cache/sub?isp=${edgeIsp || ""}`);
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch {
      // 缓存不可用时直接生成
    }
  }
  let response;
  try {
    response = await buildSub(request, env, url, true);
  } catch (error) {
    console.log(`edge sub failed: ${error?.message || error}`);
    response = null;
  }
  if (!response || !response.ok) {
    response = await edgeSnapshotResponse(env, edgeIsp);
  }
  if (cache && response.ok) {
    try {
      const cached = new Response(response.clone().body, response);
      cached.headers.set("Cache-Control", `public, max-age=${EDGE_CACHE_SECONDS}`);
      await cache.put(cacheKey, cached);
    } catch {
      // 忽略缓存写入失败
    }
  }
  return response;
}

async function buildSub(request, env, url, edgeProbe) {
  const auth = edgeProbe ? { authorized: true } : await requireReadAuth(request, env);
  if (!auth.authorized) return unauthorizedResponse();

  const explicitType = url.searchParams.get("type");
  const type = edgeProbe ? "base64" : (explicitType || inferTypeFromUa(request.headers.get("user-agent")) || "vless").toLowerCase();
  const explicitMode = url.searchParams.get("mode");
  // 2026-10-12：mode 只支持 sample。cidr 已删除（实测证伪），显式拒绝比静默忽略诚实。
  if (explicitMode && explicitMode !== "sample") {
    return jsonResponse(errorPayload("UNSUPPORTED_MODE", `Unsupported mode: ${explicitMode}. Supported: sample`), 400);
  }
  const sampleMode = explicitMode === "sample";
  // 节点参数：URL 查询参数优先（无状态，对标其他订阅器），环境变量兜底。
  // edgetunnel 探测直接用占位模板，不需要真实节点配置（edgetunnel 只提取 IP，节点信息用它自己的）。
  let template;
  if (edgeProbe) {
    template = EDGE_TEMPLATE;
  } else {
    let nodeConfig = getNodeConfigFromUrl(url);
    // 公开模式（未设 SUB_PUBLIC=0、匿名访问）下绝不回退到服务端模板（KV TEMPLATE / VLESS_*），
    // 否则任何人不带参数访问 /sub 就能拿到真实 UUID、域名和路径。
    const serverTemplateAllowed = !auth.public;
    // KV 热替换（借鉴 baiyujun/cloudflare-top200-fixed-subscription 的思路，MIT）：
    // KV 里有 TEMPLATE 时优先用，不用改环境变量、不用重部署
    if (!nodeConfig && serverTemplateAllowed && env.SUB_KV) {
      try {
        const { readTemplate } = await import("./kv.js");
        const kvTemplate = await readTemplate(env.SUB_KV).catch(() => null);
        if (kvTemplate && kvTemplate.uuid) {
          nodeConfig = {
            uuid: kvTemplate.uuid,
            sni: kvTemplate.sni || "",
            host: kvTemplate.host || "",
            path: kvTemplate.path || "",
            port: Number(kvTemplate.port) || 443,
            type: kvTemplate.type || "ws",
            security: kvTemplate.security || "tls",
          };
        }
      } catch {
        // KV 读取失败，继续走环境变量
      }
    }
    if (!nodeConfig && !serverTemplateAllowed) {
      return jsonResponse({ error: "公开模式下请在订阅 URL 中携带 uuid/sni/host 等节点参数；服务端模板只对带只读 token 的请求生效（需设 SUB_PUBLIC=0）" }, 400);
    }
    if (!nodeConfig) {
      try {
        nodeConfig = getNodeConfig(env);
      } catch (error) {
        return jsonResponse({ error: "缺少节点配置：请在订阅 URL 中携带 uuid/sni/host 等参数，或配置 VLESS_* 环境变量，或在 KV 中设置 TEMPLATE" }, 400);
      }
    }
    const configWarnings = validateNodeConfig(nodeConfig);
    if (configWarnings.some((w) => w.level === "error")) {
      return jsonResponse({ error: configWarnings.find((w) => w.level === "error").message }, 500);
    }
    template = nodeConfigToTemplate(nodeConfig);
    // 所有生成器都只会写 WebSocket 传输；其他传输（grpc/tcp/xhttp）明确拒绝，免得生成连不上的配置
    const transport = String(template.type || "ws").toLowerCase();
    if (transport !== "ws") {
      return jsonResponse(errorPayload("UNSUPPORTED_TRANSPORT", `只支持 ws 传输，当前节点是 ${transport}`), 400);
    }
  }
  const { colos } = parseColoFilter(url.searchParams.get("colo"), request);
  // 2026-10-12 重设计：删除 mode=cidr（Karing 真实链路验证失败，已证伪）。
  // 采样不解决"IP 是否服务你的域名"问题，删掉比留着诚实。
  let nodes;
  let scores = null;
  try {
    nodes = await readBestIps(env.SUB_KV);
  } catch (error) {
    console.log(`readBestIps failed: ${error?.message || error}`);
    nodes = [];
  }
  const rankOff = url.searchParams.get("rank") === "off";
  // ?isp=ct|cu|cm 分运营商订阅：只用该运营商探针的国内实测排序；缺省为三网综合
  // edgetunnel 的 sub:// 只取域名（url.origin），带不了 ?isp=，所以默认运营商也可用 GitHub 变量 SUB_DEFAULT_ISP 设置
  // （china-probe 写进 CN_PROBE_STATE.defaultIsp），或 Pages 环境变量同名。
  const ispParam = String(url.searchParams.get("isp") || "").toLowerCase();
  const isp = ispParam === "all" ? null : normalizeIsp(ispParam) || ispFromHost(url.hostname) || normalizeIsp(env.SUB_DEFAULT_ISP) || (rankOff ? null : await readDefaultIsp(env.SUB_KV));
  if (!rankOff) {
    // 选节点只认最近 SUB_VERIFIED_DAYS 天（默认 3）的国内实测，太旧的实测不代表现在的线路
    try {
      ({ scores } = await loadIpScores(env, { days: env.SUB_VERIFIED_DAYS || 3, isp }));
    } catch (error) {
      console.log(`loadIpScores failed: ${error?.message || error}`);
      scores = null;
    }
    // 待验证反代池里国内实测 ok 的才并入（不在 BEST_IPS 里的）
    if (!sampleMode && scores && scores.size > 0) {
      const dropMs = readRttDropMs(env);
      const known = new Set(nodes.map((node) => node.address));
      const pending = (await readPendingCnIps(env.SUB_KV).catch(() => []))
        .filter((node) => !known.has(node.address) && isMeasuredOk(scores.get(node.address), dropMs))
        .map(({ pendingCn, ...node }) => ({ ...node, name: node.address, source: node.source }));
      nodes = [...nodes, ...pending];
    }
    // 兜底：新鲜的国内实测 ok 不够 SUB_MIN_NODES 时，先用自己最后一次正常的国内快照，再用社区实测池
    if (!sampleMode) {
      const dropMs = readRttDropMs(env);
      const floor = readMinNodes(env);
      const countOk = () => nodes.filter((node) => isMeasuredOk(scores?.get(node.address), dropMs)).length;
      if (countOk() < floor) {
        ({ nodes, scores } = applySnapshotFallback(nodes, scores, snapshotList(await readSnapshot(env.SUB_KV, CN_VERIFIED_KEY), isp), { penalty: 50, source: "cn-snapshot" }));
      }
      if (countOk() < floor) {
        ({ nodes, scores } = applySnapshotFallback(nodes, scores, snapshotList(await readSnapshot(env.SUB_KV, CN_COMMUNITY_KEY).catch(() => null), isp), { penalty: 1000, source: "cn-community" }));
      }
    }
  }
  // P1-3: SUB_PREFERRED_PORTS 可覆盖端口顺序
  const portOrder = getPreferredPortOrder(env);
  // 先过滤（TLS 端口不匹配）再截断，避免坏节点占满名额后返回空
  const colosFiltered = dropTlsPortMismatch(
    filterNodesByColo(nodes, colos).nodes.map((node) => withPreferredPort(node, portOrder)),
    template,
  );
  const limit = getLimit(url, edgeProbe ? PROBE_MAX_NODES : MAX_NODES);
  if (sampleMode) {
    // 显式 mode=sample 才随机抽样（可选玩法，不再是 edgetunnel 的默认行为）
    nodes = sampleNodes(colosFiltered, { limit, scores, env });
  } else if (rankOff) {
    nodes = colosFiltered.slice(0, limit);
  } else {
    // 默认（含 edgetunnel 探测）：固定输出 国内实测 ok > 手动置顶 > 过审池补齐，每次结果一致
    nodes = selectVerifiedNodes(colosFiltered, scores, { limit, env });
  }
  // P2-6: ?ip6=1 追加未实测 IPv6（不占 limit 名额、不进排名抽样；探测旁路不混入）
  if (!edgeProbe && url.searchParams.get("ip6") === "1") {
    const v6Nodes = await readBestIpsV6(env.SUB_KV);
    nodes = [...nodes, ...v6Nodes.map((node) => withPreferredPort({ ...node, name: `[IPv6] ${node.name || node.address}` }, portOrder))];
  }
  // 多域名轮换（可选，SUB_ROTATE_HOSTS=1）：节点的 host/sni 只用该运营商国内体检没被墙的域名
  if (!edgeProbe) {
    const health = await readHostHealth(env.SUB_KV).catch(() => null);
    if (rotationEnabled(health, env)) nodes = applyHostRotation(nodes, template, health, { isp, env });
  }
  const generatorOptions = { autoTest: true };
  // 2026-10-12：url-test 常开。服务器只保证"节点活着"，最终选择交给客户端实测——
  // 客户端在 Leo 的线路上测，比服务器在美国测诚实。

  if (nodes.length === 0) {
    return jsonResponse(errorPayload("NO_AVAILABLE_NODES", "No available nodes"), 503);
  }

  if (edgeProbe) {
    return privateTextResponse(base64Encode(generateVlessSubscription(template, nodes)), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-edge.txt"));
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
    return privateTextResponse(generateClashSubscription(template, normalizeNodes(nodes), generatorOptions), "text/yaml; charset=utf-8", subscriptionHeaders("preferred-sub.yaml"));
  }

  if (type === "singbox-outbounds") {
    return privateTextResponse(generateSingboxSubscription(template, normalizeNodes(nodes), { ...generatorOptions, outboundsOnly: true }), "application/json; charset=utf-8", subscriptionHeaders("preferred-sub-outbounds.json"));
  }

  if (type === "singbox" || type === "sing-box") {
    return privateTextResponse(generateSingboxSubscription(template, normalizeNodes(nodes), generatorOptions), "application/json; charset=utf-8", subscriptionHeaders("preferred-sub.json"));
  }

  if (type === "surge") {
    return privateTextResponse(generateSurgeSubscription(template, normalizeNodes(nodes), generatorOptions), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-surge.conf"));
  }

  if (type === "loon") {
    return privateTextResponse(generateLoonSubscription(template, normalizeNodes(nodes), generatorOptions), "text/plain; charset=utf-8", subscriptionHeaders("preferred-sub-loon.conf"));
  }

  if (type === "stash") {
    return privateTextResponse(generateStashSubscription(template, normalizeNodes(nodes), generatorOptions), "text/yaml; charset=utf-8", subscriptionHeaders("preferred-sub-stash.yaml"));
  }

  return jsonResponse(errorPayload("UNSUPPORTED_SUBSCRIPTION_TYPE", "Unsupported subscription type"), 400);
}

export function dropTlsPortMismatch(nodes, template) {
  if (String(template?.security || "tls") !== "tls") return nodes;
  const bad = new Set(NON_TLS_PORTS);
  return nodes.filter((node) => !bad.has(Number(node?.port)));
}
