import test from "node:test";
import assert from "node:assert/strict";
import { handleBest } from "../src/api/best.js";
import { handleStatus } from "../src/api/status.js";
import { handleSub } from "../src/api/sub.js";
import { handleTemplateGet, handleTemplatePost } from "../src/api/template.js";

const template = "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点";
const bestIps = Array.from({ length: 60 }, (_, index) => ({
  address: `1.1.1.${index + 1}`,
  port: index % 2 === 0 ? 443 : 8443,
  name: index < 2 ? undefined : `优选-${index + 1}`,
  colo: index === 0 ? "LAX" : index === 1 ? "SJC" : "",
  latency: index === 0 ? 12 : index === 1 ? 34 : null,
}));
const status = {
  updatedAt: "2026-06-03T00:00:00.000Z",
  available: bestIps.length,
  sourceCount: 3,
  lastError: "raw private error",
};

function createEnv() {
  const data = new Map([
    ["TEMPLATE", template],
    ["BEST_IPS", JSON.stringify(bestIps)],
    ["STATUS", JSON.stringify(status)],
  ]);

  return {
    SUB_TOKEN: "secret-token",
    SUB_KV: {
      async get(key) {
        return data.get(key) || null;
      },
      put(key, value) {
        data.set(key, value);
      },
    },
  };
}

test("sub rejects missing token", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless"), createEnv());

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("sub generates Clash subscription with token", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=clash&token=secret-token&n=2"), createEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/yaml; charset=utf-8");
  assert.match(text, /server: "1.1.1.1"/);
  assert.match(text, /server: "1.1.1.2"/);
  assert.match(text, /CF Edge LAX-12ms-#1/);
  assert.match(text, /CF Edge SJC-34ms-#2/);
  assert.doesNotMatch(text, /1\.1\.1\.3/);
});

test("sub supports bearer token and Sing-box output", async () => {
  const response = await handleSub(
    new Request("https://example.com/sub?type=singbox&n=1", {
      headers: { Authorization: "Bearer secret-token" },
    }),
    createEnv(),
  );
  const parsed = JSON.parse(await response.text());

  assert.equal(response.status, 200);
  assert.equal(parsed.outbounds.length, 1);
  assert.equal(parsed.outbounds[0].server, "1.1.1.1");
  assert.equal(parsed.outbounds[0].tag, "CF Edge LAX-12ms-#1");
});

test("sub generates base64 v2rayNG subscription", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=v2rayng&token=secret-token&n=1"), createEnv());
  const encoded = await response.text();
  const decoded = Buffer.from(encoded, "base64").toString("utf8");

  assert.equal(response.status, 200);
  assert.match(decoded, /^vless:\/\//);
  assert.match(decoded, /@1\.1\.1\.1:443/);
  assert.match(decoded, /type=ws/);
  assert.match(decoded, /security=tls/);
  assert.match(decoded, /#CF%20Edge%20LAX-12ms-%231/);
});

test("template API: missing token returns 401", async () => {
  const response = await handleTemplateGet(new Request("https://example.com/template"), createEnv());
  assert.equal(response.status, 401);
});

test("template API: GET returns parsed preview", async () => {
  const response = await handleTemplateGet(new Request("https://example.com/template?token=secret-token"), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.template.startsWith("vless://"), true);
  assert.equal(parsed.preview.uuid, "11111111-1111-4111-8111-111111111111");
  assert.equal(parsed.preview.host, "example.com");
});

test("template API: POST saves new vless and returns parsed", async () => {
  const env = createEnv();
  const response = await handleTemplatePost(
    new Request("https://example.com/template?token=secret-token", {
      method: "POST",
      body: JSON.stringify({
        template: "vless://22222222-2222-4222-8222-222222222222$new.example:443?encryption=none&security=tls&sni=new.example&type=ws&host=new.example&path=%2Fnew#新节点".replace("$", "@"),
      }),
    }),
    env,
  );
  const parsed = await response.json();
  const saved = await env.SUB_KV.get("TEMPLATE");

  assert.equal(response.status, 200);
  assert.equal(parsed.saved, true);
  assert.equal(parsed.preview.uuid, "22222222-2222-4222-8222-222222222222");
  assert.match(saved, /^vless:\/\//);
  assert.match(saved, /new\.example/);
});

test("best limits nodes to 50", async () => {
  const response = await handleBest(new Request("https://example.com/best?token=secret-token&n=999"), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.nodes.length, 50);
  assert.equal(parsed.total, 60);
});

test("status is public and hides raw errors", async () => {
  const response = await handleStatus(new Request("https://example.com/status"), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.updatedAt, "2026-06-03T00:00:00.000Z");
  assert.equal(parsed.available, 60);
  assert.equal(parsed.sourceCount, 3);
  assert.equal(parsed.lastError, "检测失败，已保留上次可用结果");
  assert.notEqual(parsed.lastError, "raw private error");
});
