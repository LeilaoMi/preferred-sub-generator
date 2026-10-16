// 各客户端生成器共用的小工具
export const TEST_URL = "http://www.gstatic.com/generate_204";

// 节点名里的逗号/等号会破坏 Surge、Loon 的 INI 语法
export function iniName(name) {
  return String(name).replace(/[,=\r\n]/g, " ").trim();
}

export function nodeName(node, index) {
  return node.name || `优选-${index + 1}`;
}

// 与节点名（formatEdgeNodeName 只用国内拿到的 userColo）一致，避免名字和分组对不上
export function nodeColo(node) {
  return String(node.userColo || "").toUpperCase();
}
