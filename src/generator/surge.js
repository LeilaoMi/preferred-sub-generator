import { iniName, nodeName, TEST_URL } from "./common.js";

// Surge 不支持 VLESS（官方协议列表里没有），所以输出 Trojan over WebSocket。
// cmliu edgetunnel 在同一个 WS 路径上接受 Trojan，密码就是 UUID（服务端比对 sha224(UUID)）。
function buildProxy(template, override, index) {
  const node = { ...template, ...override };
  const name = iniName(nodeName(node, index));
  const parts = [
    `${name} = trojan`,
    node.address,
    String(Number(node.port) || 443),
    `password=${node.uuid}`,
  ];
  const sni = node.sni || node.host;
  if (sni) parts.push(`sni=${sni}`);
  parts.push("ws=true", `ws-path=${node.path || "/"}`);
  if (node.host) parts.push(`ws-headers=Host:${node.host}`);
  parts.push("skip-cert-verify=false", "tfo=false", "udp-relay=true");
  return { name, line: parts.join(", ") };
}

export function generateSurgeSubscription(template, nodes, options = {}) {
  const proxies = nodes.map((node, index) => buildProxy(template, node, index));
  const names = proxies.map((proxy) => proxy.name);
  const lines = ["[Proxy]", ...proxies.map((proxy) => proxy.line), "", "[Proxy Group]"];
  if (names.length === 0) {
    lines.push("优选自动 = select, DIRECT");
  } else if (options.autoTest) {
    lines.push(`自动测速 = url-test, ${names.join(", ")}, url=${TEST_URL}, interval=300, tolerance=80`);
    lines.push(`优选自动 = select, 自动测速, ${names.join(", ")}`);
  } else {
    lines.push(`优选自动 = select, ${names.join(", ")}`);
  }
  lines.push("", "[Rule]", "FINAL,优选自动", "");
  return lines.join("\n");
}
