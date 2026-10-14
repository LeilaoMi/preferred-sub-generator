function buildProxy(template, override, index) {
  const node = { ...template, ...override };
  const name = node.name || `优选-${index + 1}`;
  const tls = node.security === "tls";
  const parts = [
    `${name} = vless`,
    node.address,
    String(node.port || 443),
    `username=${node.uuid}`,
    "ws=true",
    `tls=${tls}`,
  ];
  if (node.path) parts.push(`ws-path=${node.path}`);
  if (node.host) parts.push(`ws-headers=Host:${node.host}`);
  if (tls && node.sni) parts.push(`sni=${node.sni}`);
  parts.push("tfo=false");
  return `${parts.join(", ")}`;
}

export function generateSurgeSubscription(template, nodes, options = {}) {
  const proxies = nodes.map((node, index) => buildProxy(template, node, index));
  const names = nodes.map((node, index) => node.name || `优选-${index + 1}`);

  const lines = ["[Proxy]", ...proxies, "", "[Proxy Group]"];

  if (options.autoTest && proxies.length > 0) {
    lines.push(`自动测速 = url-test, ${names.join(", ")}, url=http://www.gstatic.com/generate_204, interval=300, tolerance=80`);
    lines.push(`优选自动 = select, 自动测速, ${names.join(", ")}`);
  } else {
    lines.push(`优选自动 = select, ${names.join(", ")}`);
  }
  lines.push("", "[Rule]", "FINAL,优选自动", "");
  return lines.join("\n");
}
