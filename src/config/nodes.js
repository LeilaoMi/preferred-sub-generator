/**
 * 节点配置：对标竞品做法，全部来自离散环境变量，不再有"模板"中间态。
 *
 * 环境变量：
 *   VLESS_UUID      必填，节点 UUID（建议设为 Secret）
 *   VLESS_SNI       TLS 握手域名（SNI），必填当 security=tls
 *   VLESS_HOST      HTTP Host，决定流量路由到哪个后端
 *   VLESS_PATH      WS 路径，默认 ""
 *   VLESS_PORT      默认 443
 *   VLESS_TYPE      默认 ws
 *   VLESS_SECURITY  默认 tls
 */

// 已知在中国大陆被 SNI 阻断 / 高风险的域名后缀
export const RISKY_SNI_PATTERNS = [
  { pattern: /(^|\.)workers\.dev$/i, reason: "workers.dev 在中国大陆普遍被 SNI 阻断（RST），节点 TLS 握手会直接被掐断" },
  { pattern: /(^|\.)pages\.dev$/i, reason: "pages.dev 存在被 SNI 干扰的风险" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从 URL 查询参数读取节点配置（无状态，对标其他订阅器做法） */
export function getNodeConfigFromUrl(url) {
  const params = url.searchParams;
  const uuid = (params.get("uuid") || "").trim();
  if (!uuid) return null; // 没有 uuid 参数，走环境变量兜底
  return {
    uuid,
    sni: (params.get("sni") || "").trim(),
    host: (params.get("host") || "").trim(),
    path: (params.get("path") || "").trim(),
    port: Number(params.get("port")) || 443,
    type: (params.get("type") || "ws").trim() || "ws",
    security: (params.get("security") || "tls").trim() || "tls",
  };
}

/** 从环境变量读取节点配置，缺失必填项时抛错（信息指引去 Dashboard 补） */
export function getNodeConfig(env = {}) {
  const uuid = String(env.VLESS_UUID || "").trim();
  if (!uuid) {
    throw new Error("Missing VLESS_UUID: 请在 Cloudflare Pages 项目的环境变量中配置节点参数（对标竞品做法，不再使用 KV 模板）");
  }
  return {
    uuid,
    sni: String(env.VLESS_SNI || "").trim(),
    host: String(env.VLESS_HOST || "").trim(),
    path: String(env.VLESS_PATH || "").trim(),
    port: Number(env.VLESS_PORT) || 443,
    type: String(env.VLESS_TYPE || "ws").trim() || "ws",
    security: String(env.VLESS_SECURITY || "tls").trim() || "tls",
  };
}

/**
 * 校验节点配置。返回 warnings 数组，每项 { field, level, message }。
 * level=error 表示配置不可用，level=warn 仅提示风险。
 */
export function validateNodeConfig(config = {}) {
  const warnings = [];

  if (!UUID_RE.test(config.uuid || "")) {
    warnings.push({ field: "uuid", level: "error", message: "VLESS_UUID 缺失或格式不正确（应为 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）" });
  }
  if (!String(config.host || "").trim()) {
    warnings.push({ field: "host", level: "error", message: "VLESS_HOST 不能为空：它决定节点流量路由到哪个后端" });
  }
  if (String(config.security || "tls") === "tls" && !String(config.sni || "").trim()) {
    warnings.push({ field: "sni", level: "error", message: "TLS 模式下 VLESS_SNI 不能为空" });
  }

  const sni = String(config.sni || "").trim();
  for (const { pattern, reason } of RISKY_SNI_PATTERNS) {
    if (sni && pattern.test(sni)) {
      warnings.push({
        field: "sni",
        level: "warn",
        message: `VLESS_SNI 为 ${sni}：${reason}。建议换成自有域名做前置（VLESS_HOST 保持不变）。`,
      });
      break;
    }
  }
  if (String(config.type || "ws") === "ws" && !String(config.path || "").trim()) {
    warnings.push({ field: "path", level: "warn", message: "WS 模式下 VLESS_PATH 为空，确认后端不需要特定路径" });
  }
  return warnings;
}

/** 节点配置 → 生成器可用的模板对象（与 parseVlessUri 同形） */
export function nodeConfigToTemplate(config) {
  return {
    protocol: "vless",
    uuid: config.uuid,
    address: "",
    port: config.port,
    name: "",
    type: config.type,
    security: config.security,
    host: config.host,
    sni: config.sni,
    path: config.path,
    params: {},
  };
}
