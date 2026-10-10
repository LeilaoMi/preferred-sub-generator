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

export function rankNodesByScore(nodes, scores) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (!scores || scores.size === 0) return list;

  // 实测判定为不可用的 IP 直接剔除；若全部不可用则保留原列表（避免订阅被清空）
  const filtered = list.filter((node) => scores.get(node?.address)?.unreachable !== true);
  const base = filtered.length > 0 ? filtered : list;

  const measured = [];
  const rest = [];
  base.forEach((node, index) => {
    const score = scores.get(node?.address);
    const rtt = Number(score?.rtt);
    if (score && !score.unreachable && Number.isFinite(rtt)) {
      measured.push({ node, index, score, rtt });
    } else {
      rest.push(node);
    }
  });

  if (measured.length === 0) return base;

  measured.sort((a, b) => a.rtt - b.rtt
    || (Number(b.score.speed || 0) - Number(a.score.speed || 0))
    || (a.index - b.index));

  return [
    ...measured.map(({ node, score }) => decorateMeasured(node, score)),
    ...rest,
  ];
}

export function sampleWeight(node, score) {
  let weight = 1;
  if (score && !score.unreachable) {
    const rtt = Number(score.rtt);
    if (Number.isFinite(rtt)) weight += Math.min(2, 150 / Math.max(rtt, 30));
    const speed = Number(score.speed);
    if (Number.isFinite(speed)) weight += Math.min(1, speed / 25);
  }
  return weight;
}

export function sampleNodes(nodes, { limit, scores, random = Math.random } = {}) {
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
    const weight = sampleWeight(node, score);
    const draw = Number(random());
    const safe = Number.isFinite(draw) ? Math.min(Math.max(draw, Number.EPSILON), 1 - Number.EPSILON) : 0.5;
    return { node: decorateMeasured(node, score), key: Math.pow(safe, 1 / weight) };
  });

  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, cap).map((entry) => entry.node);
}

export function preferredPort(node) {
  const ports = Array.isArray(node?.ports)
    ? node.ports.map(Number).filter((port) => Number.isFinite(port) && port > 0)
    : [];
  if (ports.includes(443)) return 443;
  if (node?.port != null && Number.isFinite(Number(node.port))) return Number(node.port);
  return ports[0] ?? null;
}

export function withPreferredPort(node) {
  const port = preferredPort(node);
  return port == null ? node : { ...node, port };
}
