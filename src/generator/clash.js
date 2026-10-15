import { nodeColo, nodeName, TEST_URL } from "./common.js";

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
  return REGION_MAP[nodeColo(node)] || "其他";
}

// sniKey：Clash/mihomo 用 servername，Stash 用 sni
function buildProxy(template, override, index, { sniKey = "servername" } = {}) {
  const node = { ...template, ...override };
  const name = nodeName(node, index);
  const tls = node.security === "tls";
  const lines = [
    `  - name: ${yamlString(name)}`,
    "    type: vless",
    `    server: ${yamlString(node.address)}`,
    `    port: ${Number(node.port) || 443}`,
    `    uuid: ${yamlString(node.uuid)}`,
    "    udp: true",
    "    network: ws",
    `    tls: ${tls}`,
  ];

  if (tls) {
    const sni = node.sni || node.host;
    if (sni) lines.push(`    ${sniKey}: ${yamlString(sni)}`);
    lines.push("    client-fingerprint: chrome");
  }

  lines.push("    ws-opts:");
  lines.push(`      path: ${yamlString(node.path || "/")}`);
  if (node.host) {
    lines.push("      headers:");
    lines.push(`        Host: ${yamlString(node.host)}`);
  }

  return { name, yaml: lines.join("\n"), region: getRegion(node) };
}

function urlTestLines(name, memberLines) {
  return [
    `  - name: ${yamlString(name)}`,
    "    type: url-test",
    `    url: ${yamlString(TEST_URL)}`,
    "    interval: 300",
    "    tolerance: 80",
    "    proxies:",
    memberLines,
  ];
}

export function buildClashYaml(template, nodes, options = {}, proxyOptions = {}) {
  const proxies = nodes.map((node, index) => buildProxy(template, node, index, proxyOptions));
  const names = proxies.map((proxy) => `      - ${yamlString(proxy.name)}`).join("\n");

  if (proxies.length === 0) {
    return ["proxies: []", "proxy-groups: []", "rules:", "  - MATCH,DIRECT", ""].join("\n");
  }

  // 按落地地区归类（思路参考 figozhu/Sub-Merger-CFWorker，MIT）
  const regionGroups = new Map();
  for (const proxy of proxies) {
    if (!regionGroups.has(proxy.region)) regionGroups.set(proxy.region, []);
    regionGroups.get(proxy.region).push(proxy.name);
  }
  // 只有一个地区时不单独建地区组，避免和"自动测速"重复
  const useRegions = options.autoTest && regionGroups.size > 1;

  const groups = [];
  if (options.autoTest) {
    groups.push(...urlTestLines("自动测速", names));
    if (useRegions) {
      for (const [region, members] of regionGroups) {
        groups.push(...urlTestLines(`${region}优选`, members.map((n) => `      - ${yamlString(n)}`).join("\n")));
      }
    }
    groups.push(
      "  - name: \"优选自动\"",
      "    type: select",
      "    proxies:",
      "      - \"自动测速\"",
      ...(useRegions ? [...regionGroups.keys()].map((r) => `      - ${yamlString(`${r}优选`)}`) : []),
      names,
    );
  } else {
    groups.push("  - name: \"优选自动\"", "    type: select", "    proxies:", names);
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

export function generateClashSubscription(template, nodes, options = {}) {
  return buildClashYaml(template, nodes, options, { sniKey: "servername" });
}
