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

export function rankNodesByScore(nodes, scores) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (!scores || scores.size === 0) return list;

  const measured = [];
  const rest = [];
  list.forEach((node, index) => {
    const score = scores.get(node?.address);
    const rtt = Number(score?.rtt);
    if (score && Number.isFinite(rtt)) {
      measured.push({ node, index, score, rtt });
    } else {
      rest.push(node);
    }
  });

  if (measured.length === 0) return list;

  measured.sort((a, b) => a.rtt - b.rtt
    || (Number(b.score.speed || 0) - Number(a.score.speed || 0))
    || (a.index - b.index));

  return [
    ...measured.map(({ node, score, rtt }) => ({
      ...node,
      userRtt: round(rtt, 1),
      userColo: score.colo || undefined,
      userSpeed: score.speed != null && Number.isFinite(Number(score.speed)) ? round(Number(score.speed), 2) : undefined,
      userSamples: Number.isFinite(Number(score.samples)) ? Number(score.samples) : undefined,
    })),
    ...rest,
  ];
}
