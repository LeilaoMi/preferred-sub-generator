export function parseVlessUri(uri) {
  if (typeof uri !== "string" || !uri.startsWith("vless://")) {
    throw new Error("Invalid VLESS URI");
  }

  const url = new URL(uri);
  const params = Object.fromEntries(url.searchParams.entries());

  return {
    protocol: "vless",
    uuid: decodeURIComponent(url.username),
    address: url.hostname,
    port: url.port ? Number(url.port) : null,
    name: url.hash ? decodeURIComponent(url.hash.slice(1)) : "",
    type: params.type || "tcp",
    security: params.security || "none",
    host: params.host || "",
    sni: params.sni || params.peer || "",
    path: params.path ? decodeURIComponent(params.path) : "",
    params,
  };
}
