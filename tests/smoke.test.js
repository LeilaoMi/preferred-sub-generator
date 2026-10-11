import test from "node:test";
import assert from "node:assert/strict";
import { handleSub } from "../src/api/sub.js";
import { handleTemplateGet, handleTemplatePost } from "../src/api/template.js";

const nodeEnv = {
  VLESS_UUID: "11111111-1111-4111-8111-111111111111",
  VLESS_SNI: "example.com",
  VLESS_HOST: "example.com",
  VLESS_PATH: "/ws",
  VLESS_PORT: "443",
  VLESS_TYPE: "ws",
  VLESS_SECURITY: "tls",
};

function createEnv({ hasConfig = true, hasBestIps = true } = {}) {
  const data = new Map();
  if (hasBestIps) {
    data.set("BEST_IPS", JSON.stringify([{ address: "1.1.1.1", port: 443, colo: "LAX", latency: 12 }]));
  }

  return {
    SUB_TOKEN: "secret-token",
    SUB_READ_TOKEN: "read-token",
    ...(hasConfig ? nodeEnv : {}),
    SUB_KV: {
      async get(key) {
        return data.get(key) || null;
      },
      async put(key, value) {
        data.set(key, value);
      },
    },
  };
}

test("smoke: template GET returns env-based config without raw secret", async () => {
  const get = await handleTemplateGet(new Request("https://example.com/api/template", {
    headers: { Authorization: "Bearer secret-token" },
  }), createEnv());
  const parsed = await get.json();

  assert.equal(get.status, 200);
  assert.equal(parsed.template, undefined);
  assert.equal(parsed.fields.host, "example.com");
  assert.equal(parsed.fields.sni, "example.com");
  assert.equal(parsed.templateSafe.host, "example.com");
  assert.equal(parsed.key, "ENV");
});

test("smoke: template POST is gone (410)", async () => {
  const save = await handleTemplatePost(new Request("https://example.com/api/template", {
    method: "POST",
    headers: { Authorization: "Bearer secret-token" },
    body: JSON.stringify({ template: "vless://x" }),
  }), createEnv());
  assert.equal(save.status, 410);
});

test("smoke: wrong template token returns 401", async () => {
  const response = await handleTemplateGet(new Request("https://example.com/api/template?token=wrong"), createEnv());
  assert.equal(response.status, 401);
});

test("smoke: missing node config causes sub to fail", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless&t=read-token"), createEnv({ hasConfig: false }));
  assert.equal(response.status, 500);
  const parsed = await response.json();
  assert.match(parsed.error, /VLESS_UUID/);
});

test("smoke: empty BEST_IPS returns 503", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless&t=read-token"), createEnv({ hasBestIps: false }));
  const parsed = await response.json();

  assert.equal(response.status, 503);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "NO_AVAILABLE_NODES");
  assert.equal(parsed.error, "No available nodes");
});
