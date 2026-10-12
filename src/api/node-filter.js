const MAX_COLO_FILTER = 10;

export function parseColoFilter(value, request) {
  const requested = String(value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_COLO_FILTER);
  if (requested.length === 0) return { requested: [], colos: [] };

  const colos = new Set();
  for (const item of requested) {
    if (item === "AUTO") {
      const own = String(request?.cf?.colo || "").trim().toUpperCase();
      if (own) colos.add(own);
      continue;
    }
    colos.add(item);
  }
  return { requested, colos: [...colos] };
}

function nodeColos(node) {
  return [node?.userColo, node?.colo]
    .filter(Boolean)
    .map((item) => String(item).trim().toUpperCase());
}

export function filterNodesByColo(nodes, colos) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (!Array.isArray(colos) || colos.length === 0) {
    return { nodes: list, filtered: false, matched: false, fallback: false, matchedCount: list.length };
  }

  const wanted = new Set(colos);
  const matched = list.filter((node) => nodeColos(node).some((colo) => wanted.has(colo)));
  if (matched.length === 0) {
    return { nodes: list, filtered: true, matched: false, fallback: true, matchedCount: 0 };
  }
  return { nodes: matched, filtered: true, matched: true, fallback: false, matchedCount: matched.length };
}

// P2-11（2026-10-12 重设计，已删除）：多维加权评分公式
// score = (wS·带宽 + wC·落点加成 + 0.1) / (1 + wR·延迟 + wJ·抖动)
// 删除原因：公式试图用"美国扫描机的数据"回答"哪个节点对 Leo 最快"，
// 这是 demo 数据冒充真实信号（Karpathy：对 demo 免疫）。
// 唯一真实信号是 Leo 本机的实测（probe-ips.js → ip-feedback）。
// 新模型：实测 ok 的按实测 RTT 排序；没测过的只保证"活着"，不排名。
// 5 个 SUB_SCORE_W_* 权重旋钮一并删除（DHH：偏好设置是逃避艰难决定）。

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// 有稳定排序分（RTT 分桶 + 远端机房/失败率加罚）时按它排，没有时按 RTT；分数相同保持原序
function byRank(a, b) {
  const ra = Number(a.score?.rank);
  const rb = Number(b.score?.rank);
  if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
  if (Number.isFinite(ra) && Number.isFinite(rb)) return 0;
  return a.rtt - b.rtt;
}

// 实测 RTT 淘汰门槛：超过这个值的节点对 Leo 的线路基本不可用。
// 这是约束（ToiCF：每个关键数字都要能说出为什么），不是偏好。
const DEFAULT_RTT_DROP_MS = 1000;

export function readRttDropMs(env = {}) {
  const n = Number(env.SUB_RTT_DROP_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RTT_DROP_MS;
}

function resolveRttDropMs(options = {}) {
  if (options.rttDropMs != null && Number.isFinite(Number(options.rttDropMs)) && Number(options.rttDropMs) > 0) {
    return Number(options.rttDropMs);
  }
  return readRttDropMs(options.env || {});
}

// 一条实测记录算"可用"的唯一标准：没判死、RTT 有限、没超过淘汰门槛
export function isMeasuredOk(score, rttDropMs) {
  if (!score || score.unreachable) return false;
  const rtt = Number(score?.rtt);
  return Number.isFinite(rtt) && rtt > 0 && rtt <= rttDropMs;
}

export function decorateMeasured(node, score) {
  const rtt = Number(score?.rtt);
  if (!score || score.unreachable || !Number.isFinite(rtt)) return node;
  return {
    ...node,
    userRtt: round(rtt, 1),
    userColo: score.colo || undefined,
    userSpeed: score.speed != null && Number.isFinite(Number(score.speed)) ? round(Number(score.speed), 2) : undefined,
    userSamples: Number.isFinite(Number(score.samples)) ? Number(score.samples) : undefined,
  };
}

// 两池模型（2026-10-12）：
// 池 A：Leo 实测 ok 的节点，按实测 RTT 升序——这是唯一真实信号，快者先。
// 池 B：其余过审节点（6 小时内验证活着），保持池顺序——不假装知道快慢。
// 实测判死的直接剔除；若全部判死则保留原列表（订阅不断流）。
export function orderNodesByMeasurement(nodes, scores, options = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const rttDropMs = resolveRttDropMs(options);

  const alive = list.filter((node) => scores?.get(node?.address)?.unreachable !== true);
  const base = alive.length > 0 ? alive : list;

  const measured = [];
  const rest = [];
  base.forEach((node) => {
    const score = scores?.get(node?.address);
    if (isMeasuredOk(score, rttDropMs)) {
      measured.push({ node, score, rtt: Number(score.rtt) });
    } else {
      rest.push(node);
    }
  });

  // 实测 RTT 升序；RTT 相同保持原序（稳定）
  measured.sort(byRank);

  return [
    ...measured.map(({ node, score }) => decorateMeasured(node, score)),
    ...rest,
  ];
}

// 旧名保留为别名，测试与外部调用过渡用（下个版本删除）
export const rankNodesByScore = orderNodesByMeasurement;

// 抽样权重：有 Leo 实测的 3，没测过的 1。
// 实测只抬高被抽中的概率，不决定入选资格——加权参考，不是排行榜。
export function sampleWeight(score, rttDropMs) {
  return isMeasuredOk(score, rttDropMs) ? 3 : 1;
}

export function sampleNodes(nodes, { limit, scores, random = Math.random, rttDropMs, env } = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const dropMs = rttDropMs ?? readRttDropMs(env || {});

  // 与排序模式相同口径：本地实测判死的剔除；若全部判死则保留全量，避免订阅被清空
  let base = list;
  if (scores && scores.size > 0) {
    const filtered = list.filter((node) => scores.get(node?.address)?.unreachable !== true);
    if (filtered.length > 0) base = filtered;
  }

  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Number(limit), base.length)
    : base.length;

  // Efraimidis–Spirakis 加权不放回抽样：key = random^(1/weight)，权重越高越容易排前面
  const keyed = base.map((node) => {
    const score = scores?.get(node?.address);
    const weight = sampleWeight(score, dropMs);
    const draw = Number(random());
    const safe = Number.isFinite(draw) ? Math.min(Math.max(draw, Number.EPSILON), 1 - Number.EPSILON) : 0.5;
    return { node: decorateMeasured(node, score), key: Math.pow(safe, 1 / weight) };
  });

  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, cap).map((entry) => entry.node);
}

export function preferredPort(node, portOrder) {
  const ports = Array.isArray(node?.ports)
    ? node.ports.map(Number).filter((port) => Number.isFinite(port) && port > 0)
    : [];
  // P1-3: 默认 443 优先；SUB_PREFERRED_PORTS 覆盖时按给定顺序选
  const order = Array.isArray(portOrder) && portOrder.length > 0 ? portOrder : [443];
  for (const preferred of order) {
    if (ports.includes(preferred)) return preferred;
  }
  if (node?.port != null && Number.isFinite(Number(node.port))) return Number(node.port);
  return ports[0] ?? null;
}

export function withPreferredPort(node, portOrder) {
  const port = preferredPort(node, portOrder);
  return port == null ? node : { ...node, port };
}

// 国内视角稳定输出（2026-10-12，对齐 cmliu 的"固定名单"思路）：
// 1. 国内本机实测 ok 的节点，按实测 RTT 升序——唯一真实信号；
// 2. 手动置顶节点（sources/edge/manual.txt，你自己确认能用的 IP/域名）；
// 3. 前两类不足 minNodes 时，才用过审池按固定顺序补齐（确定性，不随机）。
// 每次拉取结果相同，edgetunnel 不会每次换一批没验证过的 IP。
const DEFAULT_MIN_NODES = 10;
const PINNED_SOURCES = new Set(["edge-manual", "pinned"]);

export function readMinNodes(env = {}) {
  const n = Number(env.SUB_MIN_NODES);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MIN_NODES;
}

export function selectVerifiedNodes(nodes, scores, { limit, minNodes, env = {}, rttDropMs } = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const dropMs = rttDropMs ?? readRttDropMs(env);
  const floor = minNodes ?? readMinNodes(env);
  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : list.length;

  const isDead = (node) => scores?.get(node?.address)?.unreachable === true;
  const measured = [];
  const pinned = [];
  const rest = [];
  for (const node of list) {
    if (isDead(node)) continue;
    const score = scores?.get(node?.address);
    if (isMeasuredOk(score, dropMs)) measured.push({ node, rtt: Number(score.rtt), score });
    else if (PINNED_SOURCES.has(node?.source)) pinned.push(node);
    else rest.push(node);
  }
  measured.sort(byRank);

  const verified = [...measured.map(({ node, score }) => decorateMeasured(node, score)), ...pinned];
  const filler = verified.length < floor ? rest.slice(0, floor - verified.length) : [];
  let result = [...verified, ...filler];
  // 全部被判死时保留原列表，订阅不断流
  if (result.length === 0) result = list.slice();
  return result.slice(0, cap);
}
