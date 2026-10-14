function yamlString(value) {
  return JSON.stringify(String(value));
}

const REGION_MAP = {
  HKG: "亚洲", TPE: "亚洲", NRT: "亚洲", HND: "亚洲", KIX: "亚洲",
  ICN: "亚洲", SIN: "亚洲", KUL: "亚洲", BKK: "亚洲", MNL: "亚洲", CGK: "亚洲",
  LAX: "美国", SJC: "美国", SEA: "美国", SFO: "美国", DFW: "美国",
  IAD: "美国", ORD: "美国", ATL: "美国", MIA: "美国", EWR: "美国", JFK: "美国",
  YVR: "北美", YYZ: "北美",
  LHR: "欧洲", MAN: "欧洲", CDG: "欧洲", FRA: "欧洲", AMS: "欧洲",
  MAD: "欧洲", MXP: "欧洲", ARN: "欧洲", WAW: "欧洲",
  SYD: "大洋洲", MEL: "大洋洲", AKL: "大洋洲",
};

function getRegion(node) {
  const colo = String(node.colo || node.userColo || "").toUpperCase();
  return REGION_MAP[colo] || "其他";
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

  return { name, yaml: lines.join("\n"), region: getRegion({ ...template, ...override }) };
}

export function generateClashSubscription(template, nodes, options = {}) {
  const proxies = nodes.map((node, index) => buildProxy(template, node, index));
  const names = proxies.map((proxy) => `      - ${yamlString(proxy.name)}`).join("\n");

  // 按地区自动归类（借鉴 figozhu/Sub-Merger-CFWorker 的思路，MIT）
  const regionGroups = {};
  for (const proxy of proxies) {
    const r = proxy.region || "其他";
    if (!regionGroups[r]) regionGroups[r] = [];
    regionGroups[r].push(proxy.name);
  }

  const groups = [];
  const regionGroupType = options.autoTest ? "url-test" : "select";
  for (const [region, names] of Object.entries(regionGroups)) {
    if (names.length === 0) continue;
    const rg = [
      `  - name: "${region}优选"`,
      `    type: ${regionGroupType}`,
    ];
    if (options.autoTest) {
      rg.push(
        '    url: "http://www.gstatic.com/generate_204"',
        "    interval: 300",
        "    tolerance: 80",
      );
    }
    rg.push(
      "    proxies:",
      names.map((n) => `      - ${yamlString(n)}`).join("\n"),
    );
    groups.push(...rg);
  }
  const regionSelects = Object.keys(regionGroups).map((r) => `      - "${r}优选"`).join("\n");
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
      regionSelects,
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
