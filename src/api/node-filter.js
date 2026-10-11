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

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// P2-11: 多维加权评分的默认权重；默认行为接近旧排序（rtt 主导、speed 次之），避免线上突变
const SCORE_DEFAULTS = {
  wS: 1.0, // 带宽权重
  wC: 0.5, // 已知落点（用户实测出 colo）加成权重
  wR: 2.0, // 延迟惩罚权重
  wJ: 1.0, // 抖动惩罚权重
  rttDropMs: 1000, // P1-9: rtt 只做淘汰门槛，超过直接丢弃
  speedRefMbps: 100, // 带宽归一化基准
  jitterRefMs: 500, // 抖动归一化基准
};

function readNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function readScoreOptions(env = {}) {
  return {
    wS: readNumber(env.SUB_SCORE_W_SPEED, SCORE_DEFAULTS.wS),
    wC: readNumber(env.SUB_SCORE_W_COLO, SCORE_DEFAULTS.wC),
    wR: readNumber(env.SUB_SCORE_W_RTT, SCORE_DEFAULTS.wR),
    wJ: readNumber(env.SUB_SCORE_W_JITTER, SCORE_DEFAULTS.wJ),
    rttDropMs: readNumber(env.SUB_RTT_DROP_MS, SCORE_DEFAULTS.rttDropMs),
    speedRefMbps: SCORE_DEFAULTS.speedRefMbps,
    jitterRefMs: SCORE_DEFAULTS.jitterRefMs,
  };
}

function resolveScoreOptions(options = {}) {
  const resolved = readScoreOptions(options.env || {});
  for (const key of ["wS", "wC", "wR", "wJ", "rttDropMs"]) {
    if (options[key] != null && Number.isFinite(Number(options[key])) && Number(options[key]) >= 0) {
      resolved[key] = Number(options[key]);
    }
  }
  return resolved;
}

// P2-11: score = (wS*speedNorm + wC*coloBonus + base) / (1 + wR*rttNorm + wJ*jitterNorm)
// 各维度归一化到 0~1；base=0.1 保证无带宽数据时 rtt 仍能区分排序（否则分子全 0 退化为原序）
const SCORE_BASE = 0.1;

export function computeNodeScore(node, score, options = {}) {
  const opts = resolveScoreOptions(options);
  const speed = Number(score?.speed);
  const speedNorm = Number.isFinite(speed) && speed > 0 ? Math.min(speed / opts.speedRefMbps, 1) : 0;
  const coloBonus = score?.colo ? 1 : 0;
  const rtt = Number(score?.rtt);
  const rttNorm = Number.isFinite(rtt) && rtt > 0 ? Math.min(rtt / opts.rttDropMs, 1) : 1;
  const jitter = Number(node?.jitter);
  const jitterNorm = Number.isFinite(jitter) && jitter > 0 ? Math.min(jitter / opts.jitterRefMs, 1) : 0;
  return (opts.wS * speedNorm + opts.wC * coloBonus + SCORE_BASE) / (1 + opts.wR * rttNorm + opts.wJ * jitterNorm);
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

export function rankNodesByScore(nodes, scores, options = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (!scores || scores.size === 0) return list;
  const opts = resolveScoreOptions(options);

  // 实测判定为不可用的 IP 直接剔除；若全部不可用则保留原列表（避免订阅被清空）
  const filtered = list.filter((node) => scores.get(node?.address)?.unreachable !== true);
  const base = filtered.length > 0 ? filtered : list;

  const measured = [];
  const rest = [];
  base.forEach((node, index) => {
    const score = scores.get(node?.address);
    const rtt = Number(score?.rtt);
    // P1-9: rtt 只做淘汰门槛，不参与主排序
    if (score && !score.unreachable && Number.isFinite(rtt) && rtt <= opts.rttDropMs) {
      measured.push({ node, index, score, value: computeNodeScore(node, score, opts) });
    } else {
      rest.push(node);
    }
  });

  if (measured.length === 0) return base;

  // P2-11: 加权评分降序；分数相同时保持原序（稳定）
  measured.sort((a, b) => b.value - a.value || (a.index - b.index));

  return [
    ...measured.map(({ node, score }) => decorateMeasured(node, score)),
    ...rest,
  ];
}

export function sampleWeight(node, score, options = {}) {
  if (!score || score.unreachable) return 1;
  // P2-11: 抽样与排名共用同一评分公式；权重恒 >=1，保证 Efraimidis–Spirakis 结构不变
  return 1 + 3 * computeNodeScore(node, score, options);
}

export function sampleNodes(nodes, { limit, scores, random = Math.random, scoreOptions } = {}) {
  const list = Array.isArray(nodes) ? nodes : [];

  // 与排名模式相同口径：本地实测判死的剔除；若全部判死则保留全量，避免订阅被清空
  let base = list;
  if (scores && scores.size > 0) {
    const filtered = list.filter((node) => scores.get(node?.address)?.unreachable !== true);
    if (filtered.length > 0) base = filtered;
  }

  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Number(limit), base.length)
    : base.length;

  // Efraimidis–Spirakis 加权不放回抽样：key = random^(1/weight)，权重越高越容易排前面。
  // 本地实测只抬高被抽中的概率，不决定入选资格——实测是加权参考，不是排行榜。
  const keyed = base.map((node) => {
    const score = scores?.get(node?.address);
    const weight = sampleWeight(node, score, scoreOptions);
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
