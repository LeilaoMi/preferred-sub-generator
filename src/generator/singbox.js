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

export function generateSingboxSubscription(template, nodes) {
  return JSON.stringify(
    {
      outbounds: nodes.map((node, index) => buildOutbound(template, node, index)),
    },
    null,
    2,
  );
}
