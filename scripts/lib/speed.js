import https from "node:https";

// 直连 IP（SNI=servername）下载定速文件测带宽，返回 Mbps；失败返回 null。
// 从 scripts/probe-ips.js 抽出，供 update-kv.js 的 GHA 带宽抽测复用。
export function downloadSpeed(address, port, { servername, bytes, timeoutMs }) {
  return new Promise((resolve) => {
    const request = https.request({
      host: address,
      port,
      servername,
      method: "GET",
      path: `/__down?bytes=${bytes}`,
      headers: { Host: servername, "Accept-Encoding": "identity" },
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
