import test from "node:test";
import assert from "node:assert/strict";
import { handleBest } from "../src/api/best.js";
import { handleStatus } from "../src/api/status.js";
import { handleSub } from "../src/api/sub.js";
import { handleTemplateGet, handleTemplatePost } from "../src/api/template.js";
import { handleVersions } from "../src/api/versions.js";

const expectedGeneratedName = "🇺🇸 美国洛杉矶 LAX 12ms #1";
const expectedEncodedGeneratedName = encodeURIComponent(expectedGeneratedName);

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
  newAvailable: 12,
  sourceCount: 3,
  checked: 88,
  protectedByPrevious: true,
  lastError: "本次可用节点少于 20，已保留上次可用结果",
};

function createEnv() {
  const data = new Map([
    ["TEMPLATE", template],
    ["BEST_IPS", JSON.stringify(bestIps)],
    ["STATUS", JSON.stringify(status)],
    ["BEST_IPS_VERSION_INDEX", JSON.stringify([
      { key: "BEST_IPS_20260603T000000Z", version: "20260603T000000Z", updatedAt: "2026-06-03T00:00:00.000Z", total: 60 },
      { key: "BEST_IPS_20260602T180000Z", version: "20260602T180000Z", updatedAt: "2026-06-02T18:00:00.000Z", total: 55 },
    ])],
  ]);

  return {
    SUB_TOKEN: "secret-token",
    SUB_READ_TOKEN: "read-token",
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

function createPublicEnv() {
  return { ...createEnv(), SUB_PUBLIC: "1" };
}

function subRequest(path) {
  return new Request(`https://example.com${path}`, {
    headers: { Authorization: "Bearer read-token" },
  });
}

test("sub requires read token by default", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless&n=1"), createEnv());
  assert.equal(response.status, 401);
});

test("sub allows public access only when SUB_PUBLIC=1", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless&n=1"), createPublicEnv());
  assert.equal(response.status, 200);
});

test("sub accepts read token from short query parameter", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless&n=1&t=read-token"), createEnv());
  assert.equal(response.status, 200);
});

test("sub generates Clash subscription", async () => {
  const response = await handleSub(subRequest("/sub?type=clash&n=2"), createEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/yaml; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Content-Disposition"), 'inline; filename="preferred-sub.yaml"');
  assert.match(text, /server: "1.1.1.1"/);
  assert.match(text, /server: "1.1.1.2"/);
  assert.match(text, /🇺🇸 美国洛杉矶 LAX 12ms #1/);
  assert.match(text, /🇺🇸 美国圣何塞 SJC 34ms #2/);
  assert.doesNotMatch(text, /1\.1\.1\.3/);
});

test("sub generates plain VLESS subscription with encoded generated names", async () => {
  const response = await handleSub(subRequest("/sub?type=vless&n=1"), createEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /^vless:\/\//);
  assert.match(text, /@1\.1\.1\.1:443/);
  assert.match(text, new RegExp(`#${expectedEncodedGeneratedName}$`));
  assert.equal(decodeURIComponent(new URL(text).hash.slice(1)), expectedGeneratedName);
});

test("sub generates base64 v2rayNG subscription", async () => {
  const response = await handleSub(subRequest("/sub?type=v2rayng&n=1"), createEnv());
  const encoded = await response.text();
  const decoded = Buffer.from(encoded, "base64").toString("utf8");

  assert.equal(response.status, 200);
  assert.match(decoded, /^vless:\/\//);
  assert.match(decoded, /@1\.1\.1\.1:443/);
  assert.match(decoded, /type=ws/);
  assert.match(decoded, /security=tls/);
  assert.match(decoded, new RegExp(`#${expectedEncodedGeneratedName}$`));
  assert.equal(decodeURIComponent(new URL(decoded).hash.slice(1)), expectedGeneratedName);
});

test("sub generates Shadowrocket subscription with encoded generated names", async () => {
  const response = await handleSub(subRequest("/sub?type=shadowrocket&n=1"), createEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /^vless:\/\//);
  assert.match(text, /@1\.1\.1\.1:443/);
  assert.match(text, new RegExp(`#${expectedEncodedGeneratedName}$`));
  assert.equal(decodeURIComponent(new URL(text).hash.slice(1)), expectedGeneratedName);
});

test("sub generates Sing-box subscription with localized generated names", async () => {
  const response = await handleSub(subRequest("/sub?type=singbox&n=1"), createEnv());
  const parsed = JSON.parse(await response.text());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Content-Disposition"), 'inline; filename="preferred-sub.json"');
  assert.equal(parsed.outbounds.length, 1);
  assert.equal(parsed.outbounds[0].server, "1.1.1.1");
  assert.equal(parsed.outbounds[0].tag, expectedGeneratedName);
});



test("sub accepts slot alias for template selection", async () => {
  const env = createEnv();
  await env.SUB_KV.put("TEMPLATE_2", template.replaceAll("example.com", "slot.example.com"));
  const response = await handleSub(subRequest("/sub?type=vless&slot=2&n=1"), env);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /sni=slot\.example\.com/);
});

test("v2rayNG subscription can wrap base64 output", async () => {
  const response = await handleSub(subRequest("/sub?type=v2rayng&n=2&wrap=76"), createEnv());
  const encoded = await response.text();
  const lines = encoded.split("\n");

  assert.equal(response.status, 200);
  assert.equal(lines.length > 1, true);
  assert.equal(lines.every((line) => line.length <= 76), true);
  assert.match(Buffer.from(lines.join(""), "base64").toString("utf8"), /^vless:\/\//);
});

test("template API: missing token returns 401", async () => {
  const response = await handleTemplateGet(new Request("https://example.com/template"), {
    ...createEnv(),
    SUB_TOKEN: "required-token",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("template API: GET returns parsed preview and safe template (no raw)", async () => {
  const response = await handleTemplateGet(new Request("https://example.com/template", {
    headers: { Authorization: "Bearer secret-token" },
  }), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.template, undefined);
  assert.equal(typeof parsed.templateSafe, "object");
  assert.equal(typeof parsed.templateSafe.uuidMasked, "string");
  assert.equal(parsed.preview.uuid, undefined);
  assert.equal(parsed.preview.uuidMasked, "11111111…");
  assert.equal(parsed.preview.host, "example.com");
});

test("template API: query token is rejected by default", async () => {
  const response = await handleTemplateGet(new Request("https://example.com/template?token=secret-token"), createEnv());
  assert.equal(response.status, 401);
});

test("template API: query token works only when explicitly enabled", async () => {
  const response = await handleTemplateGet(
    new Request("https://example.com/template?token=secret-token"),
    { ...createEnv(), ALLOW_QUERY_TOKEN: "1" },
  );
  assert.equal(response.status, 200);
});

test("template API: POST saves new vless and returns parsed", async () => {
  const env = createEnv();
  const response = await handleTemplatePost(
    new Request("https://example.com/template", {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" },
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

test("best requires read token by default", async () => {
  const response = await handleBest(new Request("https://example.com/best?n=1"), createEnv());
  assert.equal(response.status, 401);
});

test("best limits nodes to 50", async () => {
  const response = await handleBest(new Request("https://example.com/best?n=999", {
    headers: { Authorization: "Bearer read-token" },
  }), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.nodes.length, 50);
  assert.equal(parsed.total, 60);
});



test("versions requires read token by default", async () => {
  const response = await handleVersions(new Request("https://example.com/versions"), createEnv());
  assert.equal(response.status, 401);
});

test("versions returns bounded version index", async () => {
  const response = await handleVersions(new Request("https://example.com/versions?n=1", {
    headers: { Authorization: "Bearer read-token" },
  }), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.versions.length, 1);
  assert.equal(parsed.total, 2);
  assert.equal(parsed.versions[0].version, "20260603T000000Z");
});

test("status is public and exposes semantic fallback state", async () => {
  const response = await handleStatus(new Request("https://example.com/status"), {
    ...createEnv(),
    STATUS_NOW: "2026-06-03T01:00:00.000Z",
  });
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(parsed.updatedAt, "2026-06-03T00:00:00.000Z");
  assert.equal(parsed.available, 60);
  assert.equal(parsed.newAvailable, 12);
  assert.equal(parsed.sourceCount, 3);
  assert.equal(parsed.checked, 88);
  assert.equal(parsed.fallbackActive, true);
  assert.equal(parsed.status, "fallback");
  assert.equal(parsed.lastError, "本次可用节点少于 20，已保留上次可用结果");
});


test("status marks stale and unhealthy by age", async () => {
  const fresh = await handleStatus(new Request("https://example.com/status"), {
    ...createEnv(),
    STATUS_NOW: "2026-06-03T06:00:00.000Z",
  });
  const stale = await handleStatus(new Request("https://example.com/status"), {
    ...createEnv(),
    STATUS_NOW: "2026-06-03T13:00:00.000Z",
  });
  const unhealthy = await handleStatus(new Request("https://example.com/status"), {
    ...createEnv(),
    STATUS_NOW: "2026-06-04T01:00:01.000Z",
  });

  const freshJson = await fresh.json();
  const staleJson = await stale.json();
  const unhealthyJson = await unhealthy.json();

  assert.equal(freshJson.stale, false);
  assert.equal(freshJson.unhealthy, false);
  assert.equal(staleJson.stale, true);
  assert.equal(staleJson.unhealthy, false);
  assert.equal(staleJson.status, "fallback");
  assert.equal(unhealthyJson.stale, true);
  assert.equal(unhealthyJson.unhealthy, true);
});

test("sub returns machine-readable error code for unsupported type", async () => {
  const response = await handleSub(subRequest("/sub?type=unknown&n=1"), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 400);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "UNSUPPORTED_SUBSCRIPTION_TYPE");
  assert.equal(parsed.error, "Unsupported subscription type");
});
