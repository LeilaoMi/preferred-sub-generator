/**
 * 运营商识别与 CIDR 采样 —— 蒸馏自 cmliu/edgetunnel。
 *
 * 核心思想：anycast 漂移用"分段采样"消化，不用"精确排名"解决。
 * 请求进来先识别运营商，再在该运营商的 CIDR 段内随机采样，
 * 排序丢给客户端的 url-test。
 */

// 中国主要运营商 ASN（主识别表）
const ASN_CARRIER = {
  // 电信 CT
  4134: "ct", 4812: "ct", 4811: "ct", 36678: "ct", 23724: "ct",
  // 联通 CU
  4837: "cu", 17621: "cu", 17622: "cu", 17816: "cu", 133119: "cu",
  // 移动 CMCC
  9808: "cmcc", 58453: "cmcc", 58466: "cmcc", 133482: "cmcc", 135377: "cmcc",
};

// 组织名关键词兜底（ASN 未命中时用）
const ORG_KEYWORDS = [
  { pattern: /telecom|chinanet/i, code: "ct" },
  { pattern: /unicom|\bcnc\b/i, code: "cu" },
  { pattern: /mobile|cmnet/i, code: "cmcc" },
];

/**
 * 从请求识别运营商。非中国直接返回 'cf'。
 * @returns {'ct'|'cu'|'cmcc'|'cf'}
 */
export function detectCarrier(request) {
  const cf = request?.cf || {};
  if (String(cf.country || "").toLowerCase() !== "cn") return "cf";
  const asn = Number(cf.asn);
  if (Number.isFinite(asn) && ASN_CARRIER[asn]) return ASN_CARRIER[asn];
  const org = String(cf.asOrganization || "");
  const hit = ORG_KEYWORDS.find(({ pattern }) => pattern.test(org));
  return hit ? hit.code : "cf";
}

/**
 * 从 CIDR 列表中随机采样 N 个 IPv4 地址（不放回近似）。
 * 每个 CIDR 按地址空间权重选择，保证大段多采样。
 */
export function sampleIpsFromCidr(cidrList, count, random = Math.random) {
  const ranges = (Array.isArray(cidrList) ? cidrList : [])
    .map(parseCidr4)
    .filter(Boolean);
  if (ranges.length === 0 || count <= 0) return [];

  // 按地址空间大小加权
  const total = ranges.reduce((sum, r) => sum + r.size, 0);
  const out = [];
  const seen = new Set();
  let guard = count * 20; // 防无限循环
  while (out.length < count && guard-- > 0) {
    let pick = random() * total;
    let range = ranges[0];
    for (const r of ranges) {
      pick -= r.size;
      if (pick <= 0) { range = r; break; }
    }
    // 跳过网络地址和广播地址
    const offset = 1 + Math.floor(random() * (range.size - 2));
    const ip = intToIp(range.base + offset);
    if (!seen.has(ip)) {
      seen.add(ip);
      out.push(ip);
    }
  }
  return out;
}

function parseCidr4(cidr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(String(cidr).trim());
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some((o) => o > 255)) return null;
  const prefix = Number(m[5]);
  if (prefix < 8 || prefix > 32) return null;
  const base = ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3];
  const size = 2 ** (32 - prefix);
  // 对齐到网络地址
  const netBase = Math.floor(base / size) * size;
  return { base: netBase, size };
}

function intToIp(int) {
  return [
    (int >>> 24) & 0xff,
    (int >>> 16) & 0xff,
    (int >>> 8) & 0xff,
    int & 0xff,
  ].join(".");
}
