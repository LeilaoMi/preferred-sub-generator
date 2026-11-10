// 落地机房白名单：只要「国内入口实际落到的 Cloudflare 机房」在这里的节点。
// edgetunnel 访问非 CF 托管站点时，出口就是入口落到的机房，所以想要美国出口（AI 站点），入口必须落在美国机房。
// SUB_LANDING 可写地区别名（US / ASIA / EU）或三字码，逗号分隔，如 "US" 或 "LAX,SJC,SEA"。空 = 不限。
export const LANDING_ALIASES = {
  US: [
    "LAX", "SJC", "SFO", "SEA", "PDX", "SMF", "LAS", "PHX", "SAN", "SLC", "DEN", "ABQ", "DFW", "IAH", "AUS", "MCI",
    "OMA", "MSP", "STL", "ORD", "IND", "DTW", "CMH", "CLT", "ATL", "MEM", "BNA", "MIA", "TPA", "MCO", "JAX", "RIC",
    "IAD", "PHL", "EWR", "JFK", "BOS", "BUF", "PIT", "HNL", "ANC",
  ],
  ASIA: ["HKG", "TPE", "KHH", "NRT", "HND", "KIX", "FUK", "OKA", "ICN", "SIN", "KUL", "BKK", "MNL", "CGK", "SGN", "HAN"],
  EU: ["FRA", "AMS", "LHR", "CDG", "MAD", "MXP", "WAW", "ARN", "VIE", "ZRH", "DUS", "HAM", "MUC", "DUB", "BRU", "PRG"],
};

export function parseLandingColos(value) {
  const out = new Set();
  for (const raw of String(value || "").split(/[\s,]+/)) {
    const code = raw.trim().toUpperCase();
    if (!code) continue;
    if (LANDING_ALIASES[code]) LANDING_ALIASES[code].forEach((c) => out.add(c));
    else if (/^[A-Z]{3}$/.test(code)) out.add(code);
  }
  return out.size ? out : null;
}

// colo 不明的结果不能证明落地，有白名单时一律不算
export function isAllowedLanding(colo, allowed) {
  if (!allowed) return true;
  const code = String(colo || "").toUpperCase();
  return Boolean(code) && allowed.has(code);
}
