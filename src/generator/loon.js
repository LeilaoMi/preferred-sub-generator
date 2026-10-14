function buildProxy(template, override, index) {
  const node = { ...template, ...override };
  const name = node.name || `优选-${index + 1}`;
  const tls = node.security === "tls";
  const parts = [
    name,
    "vless",
    node.address,
    String(node.port || 443),
    node.uuid,
    "ws:true",
    `ws-path:${node.path || "/"}`,
  ];
  if (node.host) parts.push(`ws-headers:Host:${node.host}`);
  if (tls) {
    parts.push("over-tls:true");
    if (node.sni) parts.push(`tls-name:${node.sni}`);
  }
  return parts.join(",");
}

export function generateLoonSubscription(template, nodes, options = {}) {
  const proxies = nodes.map((node, index) => buildProxy(template, node, index));
  const names = nodes.map((node, index) => node.name || `优选-${index + 1}`);

  const lines = ["[Proxy]", ...proxies, ""];
  // Loon 用策略组做自动选择
  if (options.autoTest && proxies.length > 0) {
    lines.push("[Remote Proxy]");
  }
  lines.push("[Proxy Group]", `优选自动 = select, ${names.join(", ")}`, "", "[Rule]", "FINAL,优选自动", "");
  return lines.join("\n");
}
