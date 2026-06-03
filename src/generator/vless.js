function formatAddress(address) {
  return address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
}

export function generateVlessUri(template, overrides = {}) {
  const node = { ...template, ...overrides };
  if (!node.uuid || !node.address) {
    throw new Error("Missing VLESS uuid or address");
  }

  const params = new URLSearchParams(node.params || {});
  if (node.type) params.set("type", node.type);
  if (node.security) params.set("security", node.security);
  if (node.host) params.set("host", node.host);
  if (node.sni) params.set("sni", node.sni);
  if (node.path) params.set("path", node.path);

  const port = node.port ? `:${node.port}` : "";
  const query = params.toString();
  const name = node.name ? `#${encodeURIComponent(node.name)}` : "";

  return `vless://${encodeURIComponent(node.uuid)}@${formatAddress(node.address)}${port}${query ? `?${query}` : ""}${name}`;
}
