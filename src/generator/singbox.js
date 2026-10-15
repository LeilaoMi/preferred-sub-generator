import { nodeName } from "./common.js";

// 输出 sing-box 1.12+ 可直接导入的完整配置（官方 App 需要 inbounds/route/dns，只给 outbounds 用不了）。
// 已用 sing-box 1.14.3 `sing-box check` 验证。options.outboundsOnly=true 时只输出 outbounds（给自己拼配置的人）。
function buildOutbound(template, override, index) {
  const node = { ...template, ...override };
  const tls = node.security === "tls";
  const outbound = {
    type: "vless",
    tag: nodeName(node, index),
    server: node.address,
    server_port: Number(node.port) || 443,
    uuid: node.uuid,
    transport: {
      type: "ws",
      path: node.path || "/",
    },
  };

  if (node.host) {
    outbound.transport.headers = { Host: node.host };
  }

  // edgetunnel 常见的 /?ed=2560：sing-box 不认路径里的 ed 参数，要拆成 max_early_data
  const ed = /[?&]ed=(\d+)/.exec(outbound.transport.path);
  if (ed) {
    outbound.transport.path = outbound.transport.path.replace(/[?&]ed=\d+/, "").replace(/\?$/, "") || "/";
    outbound.transport.max_early_data = Number(ed[1]);
    outbound.transport.early_data_header_name = "Sec-WebSocket-Protocol";
  }

  if (tls) {
    outbound.tls = {
      enabled: true,
      server_name: node.sni || node.host || node.address,
      utls: { enabled: true, fingerprint: "chrome" },
    };
  }

  return outbound;
}

export function generateSingboxSubscription(template, nodes, options = {}) {
  const nodeOutbounds = nodes.map((node, index) => buildOutbound(template, node, index));
  const tags = nodeOutbounds.map((outbound) => outbound.tag);

  const groups = [];
  if (tags.length > 0) {
    if (options.autoTest) {
      groups.push(
        { type: "urltest", tag: "自动测速", outbounds: tags, url: "https://www.gstatic.com/generate_204", interval: "5m", tolerance: 80 },
        { type: "selector", tag: "优选自动", outbounds: ["自动测速", ...tags], default: "自动测速" },
      );
    } else {
      groups.push({ type: "selector", tag: "优选自动", outbounds: tags });
    }
  }
  const outbounds = options.autoTest
    ? [...groups, ...nodeOutbounds, { type: "direct", tag: "direct" }]
    : [...nodeOutbounds, ...groups, { type: "direct", tag: "direct" }];
  if (options.outboundsOnly) return JSON.stringify({ outbounds }, null, 2);

  const finalTag = tags.length > 0 ? "优选自动" : "direct";
  const config = {
    log: { level: "warn" },
    dns: {
      servers: [
        { type: "https", tag: "dns-remote", server: "1.1.1.1", detour: finalTag },
        { type: "local", tag: "dns-local" },
      ],
      final: "dns-remote",
    },
    inbounds: [
      { type: "tun", tag: "tun-in", address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"], auto_route: true, strict_route: true },
      { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 },
    ],
    outbounds,
    route: {
      rules: [
        { action: "sniff" },
        { protocol: "dns", action: "hijack-dns" },
        { ip_is_private: true, outbound: "direct" },
      ],
      final: finalTag,
      auto_detect_interface: true,
      default_domain_resolver: "dns-local",
    },
  };
  return JSON.stringify(config, null, 2);
}
