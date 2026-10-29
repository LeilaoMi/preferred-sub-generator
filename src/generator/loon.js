import { iniName, isSafeIniNode, nodeName, TEST_URL } from "./common.js";

// Loon VLESS 语法（nsloon.app/docs/Node）：
// 名称 = VLESS,服务器,端口,"UUID",transport=ws,path=/,host=域名,over-tls=true,sni=域名,skip-cert-verify=false
function buildProxy(template, override, index) {
  const node = { ...template, ...override };
  const name = iniName(nodeName(node, index));
  const tls = node.security === "tls";
  const parts = [
    "VLESS",
    node.address,
    String(Number(node.port) || 443),
    `"${node.uuid}"`,
    "transport=ws",
    `path=${node.path || "/"}`,
  ];
  if (node.host) parts.push(`host=${node.host}`);
  parts.push(`over-tls=${tls}`);
  if (tls) {
    const sni = node.sni || node.host;
    if (sni) parts.push(`sni=${sni}`);
    parts.push("skip-cert-verify=false");
  }
  parts.push("udp=true");
  return { name, line: `${name} = ${parts.join(",")}` };
}

export function generateLoonSubscription(template, nodes, options = {}) {
  const proxies = nodes
    .filter((node) => isSafeIniNode({ ...template, ...node }))
    .map((node, index) => buildProxy(template, node, index));
  const names = proxies.map((proxy) => proxy.name);
  const lines = ["[Proxy]", ...proxies.map((proxy) => proxy.line), "", "[Proxy Group]"];
  if (names.length === 0) {
    lines.push("优选自动 = select,DIRECT");
  } else if (options.autoTest) {
    lines.push(`自动测速 = url-test,${names.join(",")},url=${TEST_URL},interval=300,tolerance=80`);
    lines.push(`优选自动 = select,自动测速,${names.join(",")}`);
  } else {
    lines.push(`优选自动 = select,${names.join(",")}`);
  }
  lines.push("", "[Rule]", "FINAL,优选自动", "");
  return lines.join("\n");
}
