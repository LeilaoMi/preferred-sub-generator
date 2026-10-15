// Globalping 公共工具：国内三网探针定位、运营商识别、额度查询。
// 2026-10-15 实测（/v1/probes）：中国家宽探针 电信 AS4134 约 5 个、联通 AS4837 约 7 个、移动 AS9808 约 5 个；
// 旧写法 magic "CN+Chinanet" 只能匹配到 4 个电信探针（桂林那台标的是 "China Telecom"）。
export const API_BASE = "https://api.globalping.io/v1";
export const USER_AGENT = "preferred-sub-generator (+https://github.com/LeilaoMi/preferred-sub-generator)";

export const ISP_ASN = { CT: 4134, CU: 4837, CM: 9808 };
const ASN_TO_ISP = new Map([
  [4134, "CT"], [4812, "CT"], [4809, "CT"], [134774, "CT"], [136188, "CT"],
  [4837, "CU"], [17621, "CU"], [17622, "CU"], [17623, "CU"], [9929, "CU"], [4808, "CU"],
  [9808, "CM"], [24400, "CM"], [24445, "CM"], [56040, "CM"], [56041, "CM"], [56042, "CM"], [56044, "CM"], [56046, "CM"], [56047, "CM"], [56048, "CM"],
]);

// 每个运营商只取家宽探针（eyeball-network），排除机房
export function ispLocation(isp, limit = 1) {
  return { country: "CN", asn: ISP_ASN[isp], tags: ["eyeball-network"], limit };
}

export function cnLocations(isps = ["CT", "CU", "CM"], limit = 1) {
  return isps.map((isp) => ispLocation(isp, limit));
}

export function ispFromNetwork(network) {
  const n = String(network || "").toLowerCase();
  if (n.includes("unicom") || n.includes("china169")) return "CU";
  if (n.includes("mobile") || n.includes("cmnet")) return "CM";
  if (n.includes("chinanet") || n.includes("telecom")) return "CT";
  return "CN";
}

// 先按 ASN 判断，认不出再看网络名
export function ispFromProbe(probe) {
  const byAsn = ASN_TO_ISP.get(Number(probe?.asn));
  return byAsn || ispFromNetwork(probe?.network);
}

export function gpHeaders(token, json = false) {
  const headers = { "User-Agent": USER_AGENT };
  if (json) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// 剩余创建额度（每个探针结果算 1 次）；查不到返回 null
export async function readRemainingCredits({ fetchImpl = fetch, token = "" } = {}) {
  try {
    const response = await fetchImpl(`${API_BASE}/limits`, { headers: gpHeaders(token) });
    if (!response.ok) return null;
    const data = await response.json();
    const remaining = Number(data?.rateLimit?.measurements?.create?.remaining);
    return Number.isFinite(remaining) ? remaining : null;
  } catch {
    return null;
  }
}

// 按剩余额度收缩本轮预算：每个目标消耗 perTarget 次，留 reserve 给其他任务
export function adaptBudget(budget, remaining, { perTarget = 3, reserve = 30 } = {}) {
  if (remaining === null || remaining === undefined) return budget;
  const affordable = Math.floor(Math.max(0, remaining - reserve) / perTarget);
  return Math.max(0, Math.min(budget, affordable));
}
