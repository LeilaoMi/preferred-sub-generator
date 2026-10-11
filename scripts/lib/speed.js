import https from "node:https";

// 直连 IP（SNI/Host 固定为 speed.cloudflare.com）下载定速文件测带宽，返回 Mbps；失败返回 null。
// 从 scripts/probe-ips.js 抽出，供 update-kv.js 的 GHA 带宽抽测复用。
//
// 关键：必须用 speed.cloudflare.com 当 SNI/Host，连被测 IP 的端口。
// /__down 是 CF 边缘的真实测速负载；若用节点自己的域名当 SNI/Host，
// 请求会打到该域名的源站（如 edgetunnel 的 nginx 欢迎页），
// 测出来的"带宽"只是源站小页面的下载抖动，完全失真。
const SPEED_HOST = "speed.cloudflare.com";

export function downloadSpeed(address, port, { bytes, timeoutMs }) {
  return new Promise((resolve) => {
    const request = https.request({
      host: address,
      port,
      servername: SPEED_HOST,
      method: "GET",
      path: `/__down?bytes=${bytes}`,
      headers: { Host: SPEED_HOST, "Accept-Encoding": "identity" },
      rejectUnauthorized: false,
      timeout: timeoutMs,
    }, (response) => {
      if (response.statusCode >= 400) {
        response.resume();
        resolve(null);
        return;
      }
      let received = 0;
      let startedAt = null;
      response.on("data", (chunk) => {
        if (startedAt === null) startedAt = Date.now();
        received += chunk.length;
      });
      response.on("end", () => {
        if (startedAt === null || received <= 0) {
          resolve(null);
          return;
        }
        const elapsed = (Date.now() - startedAt) / 1000;
        resolve(elapsed > 0 ? Math.round(((received * 8) / (elapsed * 1000000)) * 100) / 100 : null);
      });
      response.on("error", () => resolve(null));
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", () => resolve(null));
    request.end();
  });
}
