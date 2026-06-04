import test from "node:test";
import assert from "node:assert/strict";
import { handleSub } from "../src/api/sub.js";
import { handleTemplateGet, handleTemplatePost } from "../src/api/template.js";

function createEnv({ hasTemplate = true, hasBestIps = true } = {}) {
  const data = new Map();
  if (hasTemplate) {
    data.set("TEMPLATE", "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点");
  }
  if (hasBestIps) {
    data.set("BEST_IPS", JSON.stringify([{ address: "1.1.1.1", port: 443, colo: "LAX", latency: 12 }]));
  }

  return {
    SUB_TOKEN: "secret-token",
    SUB_READ_TOKEN: "read-token",
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

test("smoke: template POST then GET returns preview without raw template", async () => {
  const env = createEnv({ hasTemplate: false });
  const next = "vless://22222222-2222-4222-8222-222222222222$new.example:443?encryption=none&security=tls&sni=new.example&type=ws&host=new.example&path=%2Fnew#新节点".replace("$", "@");

  const save = await handleTemplatePost(new Request("https://example.com/api/template", {
    method: "POST",
    headers: { Authorization: "Bearer secret-token" },
    body: JSON.stringify({ template: next }),
  }), env);
  assert.equal(save.status, 200);

  const get = await handleTemplateGet(new Request("https://example.com/api/template", {
    headers: { Authorization: "Bearer secret-token" },
  }), env);
  const parsed = await get.json();

  assert.equal(get.status, 200);
  assert.equal(parsed.template, undefined);
  assert.equal(parsed.preview.host, "new.example");
  assert.equal(parsed.templateSafe.host, "new.example");
});

test("smoke: wrong template token returns 401", async () => {
  const response = await handleTemplateGet(new Request("https://example.com/api/template?token=wrong"), createEnv());
  assert.equal(response.status, 401);
});

test("smoke: missing TEMPLATE causes sub to fail", async () => {
  await assert.rejects(
    () => handleSub(new Request("https://example.com/sub?type=vless&t=read-token"), createEnv({ hasTemplate: false })),
    /Missing TEMPLATE/,
  );
});

test("smoke: empty BEST_IPS returns 503", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless&t=read-token"), createEnv({ hasBestIps: false }));
  const parsed = await response.json();

  assert.equal(response.status, 503);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "NO_AVAILABLE_NODES");
  assert.equal(parsed.error, "No available nodes");
});
