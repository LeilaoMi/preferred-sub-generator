/**
 * Cloudflare 官方 IP 段（2026-10-12 拉取）。
 * 来源：https://www.cloudflare.com/ips-v4
 *
 * 按运营商分文件是 cmliu 的做法（CF-CIDR/{ct,cu,cmcc}.txt）。
 * 当前版本四组共用同一份官方段；后续可按实测替换各运营商的最优子集，
 * 结构已预留（改对应数组即可，无需动代码）。
 */
export const CF_CIDR_V4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

/** 按运营商取 CIDR 列表；未特判的运营商回退到全量 */
export function cidrForCarrier(carrier) {
  switch (carrier) {
    case "ct":
      return CF_CIDR_V4_CT.length > 0 ? CF_CIDR_V4_CT : CF_CIDR_V4;
    case "cu":
      return CF_CIDR_V4_CU.length > 0 ? CF_CIDR_V4_CU : CF_CIDR_V4;
    case "cmcc":
      return CF_CIDR_V4_CMCC.length > 0 ? CF_CIDR_V4_CMCC : CF_CIDR_V4;
    default:
      return CF_CIDR_V4;
  }
}

// ---- 按运营商特判（实测后填；空数组 = 用全量） ----
// 例：CF_CIDR_V4_CU = ["104.16.0.0/13", "104.24.0.0/14"]; // 联通实测最优子集
export const CF_CIDR_V4_CT = [];
export const CF_CIDR_V4_CU = [];
export const CF_CIDR_V4_CMCC = [];
