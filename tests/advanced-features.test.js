import test from "node:test";
import assert from "node:assert/strict";
import { handleSub } from "../src/api/sub.js";
import { handleBest } from "../src/api/best.js";

function createEnv() {
  const data = new Map([
    ["BEST_IPS", JSON.stringify([{ address: "1.1.1.1", port: 443, latency: 10, colo: "LAX" }])],
    ["BEST_IPS_LAST", JSON.stringify([{ address: "2.2.2.2", port: 443 }])],
  ]);
  return {
    SUB_TOKEN: "secret-token",
    SUB_READ_TOKEN: "read-token",
    // 单一节点配置来自环境变量（对标竞品，不再有多 slot 模板）
    VLESS_UUID: "11111111-1111-4111-8111-111111111111",
    VLESS_SNI: "example.com",
    VLESS_HOST: "example.com",
    VLESS_PATH: "/ws",
    VLESS_PORT: "443",
    VLESS_TYPE: "ws",
    VLESS_SECURITY: "tls",
    SUB_KV: {
      async get(key) { return data.get(key) || null; },
      async put(key, value) { data.set(key, value); },
    },
    data,
  };
}

test("sub uses env-based node config", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless&t=read-token"), createEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /11111111-1111-4111-8111-111111111111/);
  assert.match(text, /sni=example\.com/);
});

test("best can read last version snapshot", async () => {
  const response = await handleBest(new Request("https://example.com/best?version=last&t=read-token"), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.nodes[0].address, "2.2.2.2");
});
