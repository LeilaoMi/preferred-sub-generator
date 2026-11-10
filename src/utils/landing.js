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

/**
 * 两个探测入口共用的落地白名单：CN_PROBE_MODE=ping 测不到机房，此时忽略 SUB_LANDING，
 * 避免一边过滤一边不过滤、用不同的 landing 键互相清空快照。
 * @param {Record<string, string|undefined>} env
 * @returns {Set<string>|null}
 */
export function resolveLanding(env = process.env) {
  if (String(env.CN_PROBE_MODE || "").trim().toLowerCase() === "ping") return null;
  return parseLandingColos(env.SUB_LANDING);
}

/**
 * Worker 端（订阅生成）的落地白名单：Pages 环境变量 SUB_LANDING 优先，
 * 否则用 china-probe 写进 CN_PROBE_STATE.landing 的那份（instance.json 只作用于 Actions，Worker 读不到）。
 * @param {Record<string, unknown>} env
 * @param {{landing?: unknown}|null} state
 * @returns {Set<string>|null}
 */
export function workerLanding(env = {}, state = null) {
  const fromEnv = parseLandingColos(env?.SUB_LANDING);
  if (fromEnv) return fromEnv;
  if (!Array.isArray(state?.landing) || state.landing.length === 0) return null;
  const parsed = parseLandingColos(state.landing.filter((c) => typeof c === "string").join(","));
  // 探针写了白名单但一个都解析不出来：说明数据坏了，记一笔再按不限处理
  if (!parsed) console.log("CN_PROBE_STATE.landing 无法解析，落地白名单未生效");
  return parsed;
}

/**
 * 按落地白名单修正实测评分：落在白名单外的判死；成功但没有机房信息的（浏览器测速、老记录）
 * 标 unproven，不再算「国内实测 ok」，只能排在后面。
 * @param {Map<string, object>|null} scores
 * @param {Set<string>|null} landing
 * @returns {Map<string, object>|null}
 */
export function applyLandingToScores(scores, landing) {
  if (!landing || !scores) return scores;
  const out = new Map();
  for (const [address, score] of scores) {
    if (!score || score.unreachable) {
      out.set(address, score);
    } else if (score.colo) {
      out.set(address, isAllowedLanding(score.colo, landing) ? score : { ...score, unreachable: true, offLanding: true });
    } else {
      out.set(address, { ...score, unproven: true });
    }
  }
  return out;
}
