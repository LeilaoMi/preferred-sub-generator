function buildOutbound(template, override, index) {
  const node = { ...template, ...override };
  const tls = node.security === "tls";
  const outbound = {
    type: "vless",
    tag: node.name || `优选-${index + 1}`,
    server: node.address,
    server_port: node.port,
    uuid: node.uuid,
    transport: {
      type: "ws",
      path: node.path || "/",
    },
  };

  if (node.host) {
    outbound.transport.headers = { Host: node.host };
  }

  if (tls) {
    outbound.tls = {
      enabled: true,
      server_name: node.sni || node.host || node.address,
    };
  }

  return outbound;
}

export function generateSingboxSubscription(template, nodes, options = {}) {
  const nodeOutbounds = nodes.map((node, index) => buildOutbound(template, node, index));

  let outbounds = nodeOutbounds;
  if (options.autoTest && nodeOutbounds.length > 0) {
    // 抽样模式：urltest 在连接时挑活的节点，selector 默认走测速组，也可手动指定
    const tags = nodeOutbounds.map((outbound) => outbound.tag);
    outbounds = [
      {
        type: "urltest",
        tag: "自动测速",
        outbounds: tags,
        url: "https://www.gstatic.com/generate_204",
        interval: "5m",
        tolerance: 80,
      },
      {
        type: "selector",
        tag: "优选自动",
        outbounds: ["自动测速", ...tags],
        default: "自动测速",
      },
      ...nodeOutbounds,
    ];
  }

  return JSON.stringify({ outbounds }, null, 2);
}
