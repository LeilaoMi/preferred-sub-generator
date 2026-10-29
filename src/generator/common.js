// 各客户端生成器共用的小工具
export const TEST_URL = "http://www.gstatic.com/generate_204";

// 节点名里的逗号/等号会破坏 Surge、Loon 的 INI 语法
export function iniName(name) {
  return String(name).replace(/[,=\r\n]/g, " ").trim();
}

// INI 生成器里 address/host/sni/path/uuid 都是逗号分隔字段：
// 含 CR/LF 可注入新行，含逗号可拆字段。合法域名/IP/路径/UUID 不含这两类字符，
// 含它们的节点直接丢弃，而不是把整个订阅打断。
export function hasIniBreaker(value) {
  return /[\r\n,]/.test(String(value ?? ""));
}

export function isSafeIniNode(node) {
  return !["address", "host", "sni", "path", "uuid"].some((key) => hasIniBreaker(node[key]));
}

export function nodeName(node, index) {
  return node.name || `优选-${index + 1}`;
}

// 与节点名（formatEdgeNodeName 只用国内拿到的 userColo）一致，避免名字和分组对不上
export function nodeColo(node) {
  return String(node.userColo || "").toUpperCase();
}
