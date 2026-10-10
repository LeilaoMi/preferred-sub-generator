function yamlString(value) {
  return JSON.stringify(String(value));
}

function buildProxy(template, override, index) {
  const node = { ...template, ...override };
  const name = node.name || `优选-${index + 1}`;
  const tls = node.security === "tls";
  const lines = [
    `  - name: ${yamlString(name)}`,
    "    type: vless",
    `    server: ${yamlString(node.address)}`,
    `    port: ${node.port}`,
    `    uuid: ${yamlString(node.uuid)}`,
    "    network: ws",
    `    tls: ${tls}`,
  ];

  if (tls && node.sni) {
    lines.push(`    servername: ${yamlString(node.sni)}`);
  }

  lines.push("    ws-opts:");
  lines.push(`      path: ${yamlString(node.path || "/")}`);
  if (node.host) {
    lines.push("      headers:");
    lines.push(`        Host: ${yamlString(node.host)}`);
  }

  return { name, yaml: lines.join("\n") };
}

export function generateClashSubscription(template, nodes, options = {}) {
  const proxies = nodes.map((node, index) => buildProxy(template, node, index));
  const names = proxies.map((proxy) => `      - ${yamlString(proxy.name)}`).join("\n");

  const groups = [];
  if (options.autoTest && proxies.length > 0) {
    // 抽样模式：客户端连接时自己测速挑活的，坏节点几秒内被跳过
    groups.push(
      "  - name: \"自动测速\"",
      "    type: url-test",
      "    url: \"http://www.gstatic.com/generate_204\"",
      "    interval: 300",
      "    tolerance: 80",
      "    proxies:",
      names,
      "  - name: \"优选自动\"",
      "    type: select",
      "    proxies:",
      "      - \"自动测速\"",
      names,
    );
  } else {
    groups.push(
      "  - name: \"优选自动\"",
      "    type: select",
      "    proxies:",
      names,
    );
  }

  return [
    "proxies:",
    proxies.map((proxy) => proxy.yaml).join("\n"),
    "proxy-groups:",
    ...groups,
    "rules:",
    "  - MATCH,优选自动",
    "",
  ].join("\n");
}
