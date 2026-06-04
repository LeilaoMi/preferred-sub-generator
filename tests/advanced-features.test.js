import test from "node:test";
import assert from "node:assert/strict";
import { handleSub } from "../src/api/sub.js";
import { handleBest } from "../src/api/best.js";
import { handleTemplatePost } from "../src/api/template.js";

const template1 = "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#slot1";
const template2 = "vless://22222222-2222-4222-8222-222222222222@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#slot2";

function createEnv() {
  const data = new Map([
    ["TEMPLATE", template1],
    ["TEMPLATE_2", template2],
    ["BEST_IPS", JSON.stringify([{ address: "1.1.1.1", port: 443, latency: 10, colo: "LAX" }])],
    ["BEST_IPS_LAST", JSON.stringify([{ address: "2.2.2.2", port: 443 }])],
  ]);
  return {
    SUB_TOKEN: "secret-token",
    SUB_READ_TOKEN: "read-token",
    SUB_KV: {
      async get(key) { return data.get(key) || null; },
      async put(key, value) { data.set(key, value); },
    },
    data,
  };
}

test("sub can use template slot without putting token in subscription URL", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless&template=2&t=read-token"), createEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /22222222-2222-4222-8222-222222222222/);
});

test("best can read last version snapshot", async () => {
  const response = await handleBest(new Request("https://example.com/best?version=last&t=read-token"), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.nodes[0].address, "2.2.2.2");
});

test("template POST can save selected slot and audit selected key", async () => {
  const env = createEnv();
  const response = await handleTemplatePost(new Request("https://example.com/api/template?slot=3", {
    method: "POST",
    headers: { authorization: "Bearer secret-token", "cf-connecting-ip": "8.8.8.8", "user-agent": "test-agent" },
    body: JSON.stringify({ template: template2 }),
  }), env);
  const parsed = await response.json();
  const audit = JSON.parse(await env.SUB_KV.get("TEMPLATE_AUDIT"));

  assert.equal(response.status, 200);
  assert.equal(parsed.key, "TEMPLATE_3");
  assert.equal(await env.SUB_KV.get("TEMPLATE_3"), template2);
  assert.equal(audit.lastTemplateKey, "TEMPLATE_3");
  assert.equal(audit.lastTemplateUpdateIp, "8.8.8.8");
});
