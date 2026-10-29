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
    // searchParams 已解码一次，path 再 decode 就是双重解码：%252F 会被错误地变成 /。
    // 标准单次编码的 %2Fws 在 searchParams 里已是 /ws，直接用即可。
    path: params.path || "",
    params,
  };
}
