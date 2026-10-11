import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { downloadSpeed } from "../scripts/lib/speed.js";

// 回归测试：带宽必须测 speed.cloudflare.com 的 /__down 端点。
// 曾经的 bug：用节点自己的域名当 SNI/Host，/__down 打到源站
// （如 edgetunnel 的 nginx 欢迎页），"带宽"全是失真数据。
function startTlsServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speed-test-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", key, "-out", cert, "-days", "1",
    "-subj", "/CN=localhost",
  ], { stdio: "ignore" });

  const seen = {};
  const server = tls.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (socket) => {
    seen.sni = socket.servername;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (!buffer.includes("\r\n\r\n")) return;
      const [head] = buffer.split("\r\n\r\n");
      const [requestLine, ...headers] = head.split("\r\n");
      seen.path = requestLine.split(" ")[1];
      for (const line of headers) {
        const index = line.indexOf(":");
        if (index > 0 && line.slice(0, index).trim().toLowerCase() === "host") {
          seen.host = line.slice(index + 1).trim();
        }
      }
      const body = Buffer.alloc(200000);
      const response = `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
      socket.write(response);
      // 分两次写，模拟真实网络的分片
      socket.write(body.subarray(0, 100000));
      setImmediate(() => {
        socket.write(body.subarray(100000));
        socket.end();
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, seen, dir }));
  });
}

test("downloadSpeed 用 speed.cloudflare.com 当 SNI/Host 测真实带宽", async (t) => {
  const { server, port, seen, dir } = await startTlsServer();
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const speed = await downloadSpeed("127.0.0.1", port, { bytes: 200000, timeoutMs: 15000 });

  assert.equal(seen.sni, "speed.cloudflare.com");
  assert.equal(seen.host, "speed.cloudflare.com");
  assert.ok(seen.path.startsWith("/__down?bytes=200000"), `path=${seen.path}`);
  assert.ok(Number.isFinite(speed) && speed > 0, `speed=${speed}`);
});

test("downloadSpeed 服务端 4xx 时返回 null", async (t) => {
  const { server, port, dir } = await (async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "speed-test-"));
    const key = path.join(d, "key.pem");
    const cert = path.join(d, "cert.pem");
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost",
    ], { stdio: "ignore" });
    const s = tls.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (socket) => {
      socket.on("data", () => {
        socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        socket.end();
      });
    });
    await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
    return { server: s, port: s.address().port, dir: d };
  })();
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const speed = await downloadSpeed("127.0.0.1", port, { bytes: 200000, timeoutMs: 15000 });
  assert.equal(speed, null);
});
