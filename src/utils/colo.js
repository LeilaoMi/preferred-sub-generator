const COLO_LABELS = {
  LAX: "🇺🇸 美国洛杉矶",
  SJC: "🇺🇸 美国圣何塞",
  SEA: "🇺🇸 美国西雅图",
  SFO: "🇺🇸 美国旧金山",
  DFW: "🇺🇸 美国达拉斯",
  IAD: "🇺🇸 美国阿什本",
  ORD: "🇺🇸 美国芝加哥",
  ATL: "🇺🇸 美国亚特兰大",
  MIA: "🇺🇸 美国迈阿密",
  EWR: "🇺🇸 美国纽瓦克",
  JFK: "🇺🇸 美国纽约",
  YVR: "🇨🇦 加拿大温哥华",
  YYZ: "🇨🇦 加拿大多伦多",
  LHR: "🇬🇧 英国伦敦",
  MAN: "🇬🇧 英国曼彻斯特",
  CDG: "🇫🇷 法国巴黎",
  FRA: "🇩🇪 德国法兰克福",
  AMS: "🇳🇱 荷兰阿姆斯特丹",
  MAD: "🇪🇸 西班牙马德里",
  MXP: "🇮🇹 意大利米兰",
  ARN: "🇸🇪 瑞典斯德哥尔摩",
  WAW: "🇵🇱 波兰华沙",
  NRT: "🇯🇵 日本东京",
  HND: "🇯🇵 日本东京",
  KIX: "🇯🇵 日本大阪",
  ICN: "🇰🇷 韩国首尔",
  HKG: "🇭🇰 香港",
  TPE: "🇹🇼 台湾台北",
  SIN: "🇸🇬 新加坡",
  KUL: "🇲🇾 马来西亚吉隆坡",
  BKK: "🇹🇭 泰国曼谷",
  MNL: "🇵🇭 菲律宾马尼拉",
  CGK: "🇮🇩 印尼雅加达",
  SYD: "🇦🇺 澳大利亚悉尼",
  MEL: "🇦🇺 澳大利亚墨尔本",
  AKL: "🇳🇿 新西兰奥克兰",
  BOM: "🇮🇳 印度孟买",
  DEL: "🇮🇳 印度德里",
  DXB: "🇦🇪 阿联酋迪拜",
  TLV: "🇮🇱 以色列特拉维夫",
  GRU: "🇧🇷 巴西圣保罗",
  SCL: "🇨🇱 智利圣地亚哥",
  JNB: "🇿🇦 南非约翰内斯堡",
};

export function formatColo(colo) {
  const code = String(colo || "").trim().toUpperCase();
  if (!code) return "";
  return COLO_LABELS[code] ? `${COLO_LABELS[code]} ${code}` : `🌐 ${code}`;
}

export function formatEdgeNodeName(node, index) {
  const measured = node.userRtt != null && Number.isFinite(Number(node.userRtt))
    ? Math.round(Number(node.userRtt))
    : null;
  // P2-6: 保留 [IPv6] 标记
  const v6Prefix = String(node.name || "").startsWith("[IPv6] ") ? "[IPv6] " : "";
  // 2026-10-12 诚实原则（Rams）：节点名只显示 Leo 本机的实测延迟。
  // 美国扫描机的延迟（node.latency）是 demo 数据，印在名字里等于骗人——删掉。
  // 没实测过的节点只显示落点，不假装知道快慢。
  // 名字每次请求现生成，不沿用 KV 里存的老名字（老名字可能嵌着旧延迟）。
  const location = formatColo(node.userColo || node.colo) || "🌐 未识别地区";
  const latency = measured !== null ? ` ${measured}ms 实测` : "";
  return `${v6Prefix}${location}${latency} #${index + 1}`;
}
