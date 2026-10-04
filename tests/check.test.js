import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { checkEdge, checkHttpEdge } from "../scripts/lib/check.js";

const TRACE_OK = [
  "HTTP/1.1 200 OK",
  "content-type: text/plain;charset=UTF-8",
  "cf-ray: 8a41c2b3d4e5f6a7-LAX",
  "",
  "fl=1\nh=example.com\n",
].join("\r\n");

// Cloudflare 对“只服务部分 zone”的 IP 返回 403，但依然带 cf-ray
const ZONE_REJECTED = [
  "HTTP/1.1 403 Forbidden",
  "content-type: text/plain; charset=UTF-8",
  "cf-ray: 8a41c2b3d4e5f6a7-LAX",
  "",
  "error code: 1034",
].join("\r\n");

const NO_CF_RAY = [
  "HTTP/1.1 200 OK",
  "content-type: text/plain",
  "",
  "fl=1",
].join("\r\n");

function withServer(response, run) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on("data", () => socket.end(response));
      socket.on("error", () => {});
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      Promise.resolve()
        .then(() => run(port))
        .then(resolve, reject)
        .finally(() => server.close());
    });
  });
}

function check(port, options = {}) {
  return checkHttpEdge("127.0.0.1", port, {
    host: "example.com",
    tlsEnabled: false,
    timeoutMs: 3000,
    ...options,
  });
}

test("2xx response with cf-ray is verified as edge", async () => {
  await withServer(TRACE_OK, async (port) => {
    const result = await check(port);
    assert.equal(result.edgeVerified, true);
    assert.equal(result.colo, "LAX");
    assert.equal(typeof result.latency, "number");
  });
});

test("403 zone rejection is dropped even when it carries cf-ray", async () => {
  await withServer(ZONE_REJECTED, async (port) => {
    assert.equal(await check(port), null);
  });
});

test("2xx without cf-ray stays unverified", async () => {
  await withServer(NO_CF_RAY, async (port) => {
    const result = await check(port);
    assert.equal(result.edgeVerified, false);
    assert.equal(result.colo, "");
  });
});

test("checkEdge does not fall back to tcp when the zone is rejected", async () => {
  await withServer(ZONE_REJECTED, async (port) => {
    const result = await checkEdge("127.0.0.1", port, {
      host: "example.com",
      tlsEnabled: false,
      requireCfRay: true,
      allowTcpOnly: false,
      timeoutMs: 3000,
    });
    assert.equal(result, null);
  });
});

test("checkEdge still accepts a 2xx edge response", async () => {
  await withServer(TRACE_OK, async (port) => {
    const result = await checkEdge("127.0.0.1", port, {
      host: "example.com",
      tlsEnabled: false,
      requireCfRay: true,
      allowTcpOnly: false,
      timeoutMs: 3000,
    });
    assert.equal(result.colo, "LAX");
    assert.equal(result.edgeVerified, true);
  });
});
