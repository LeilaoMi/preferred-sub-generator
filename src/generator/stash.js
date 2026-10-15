import { buildClashYaml } from "./clash.js";

// Stash 兼容 Clash 配置，但 TLS 的 SNI 字段名是 sni（不写会默认用 server，也就是 IP）
export function generateStashSubscription(template, nodes, options = {}) {
  return buildClashYaml(template, nodes, options, { sniKey: "sni" });
}
