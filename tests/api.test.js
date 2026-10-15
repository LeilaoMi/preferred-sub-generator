import test from "node:test";
import assert from "node:assert/strict";
import { handleBest } from "../src/api/best.js";
import { handleReadToken } from "../src/api/read-token.js";
import { handleStatus } from "../src/api/status.js";
import { handleSub } from "../src/api/sub.js";
import { handleTemplateGet, handleTemplatePost } from "../src/api/template.js";
import { handleVersions } from "../src/api/versions.js";

const expectedGeneratedName = "🇺🇸 美国洛杉矶 LAX #1";
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
    ["BEST_IPS_V6", JSON.stringify([{ address: "2400:cb00::1", port: 443, ports: [443], name: "v6节点", untested6: true }])],
    ["BEST_IPS_VERSION_INDEX", JSON.stringify([
      { key: "BEST_IPS_20260603T000000Z", version: "20260603T000000Z", updatedAt: "2026-06-03T00:00:00.000Z", total: 60 },
      { key: "BEST_IPS_20260602T180000Z", version: "20260602T180000Z", updatedAt: "2026-06-02T18:00:00.000Z", total: 55 },
    ])],
  ]);

  return {
    SUB_TOKEN: "secret-token",
    SUB_READ_TOKEN: "read-token",
    // 节点配置：离散环境变量（对标竞品），不再用 KV 模板
    VLESS_UUID: "11111111-1111-4111-8111-111111111111",
    VLESS_SNI: "example.com",
    VLESS_HOST: "example.com",
    VLESS_PATH: "/ws",
    VLESS_PORT: "443",
    VLESS_TYPE: "ws",
    VLESS_SECURITY: "tls",
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

test("sub is public by default, requires token when SUB_PUBLIC=0", async () => {
  const env = { ...createEnv(), SUB_PUBLIC: "0" };
  const response = await handleSub(new Request("https://example.com/sub?type=vless&n=1"), env);
  assert.equal(response.status, 401);
  const publicResp = await handleSub(new Request("https://example.com/sub?type=vless&n=1"), createEnv());
  assert.notEqual(publicResp.status, 401);
});

test("public sub never leaks the server-side node template to anonymous requests", async () => {
  const response = await handleSub(new Request("https://example.com/sub?type=vless&n=1"), createPublicEnv());
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /11111111-1111-4111-8111-111111111111/);
  const withParams = await handleSub(new Request("https://example.com/sub?type=vless&n=1&uuid=22222222-2222-4222-8222-222222222222&host=a.example.org&sni=a.example.org&path=%2F"), createPublicEnv());
  assert.equal(withParams.status, 200);
  const text = await withParams.text();
  assert.match(text, /22222222-2222-4222-8222-222222222222/);
  assert.doesNotMatch(text, /11111111-1111-4111-8111-111111111111/);
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
  assert.match(text, /🇺🇸 美国洛杉矶 LAX #1/);
  assert.match(text, /🇺🇸 美国圣何塞 SJC #2/);
  assert.doesNotMatch(text, /1\.1\.1\.3/);
});

function createSampleEnv() {
  const pool = [
    { address: "1.1.1.1", port: 2087, ports: [2087, 443], name: "🇺🇸 美国洛杉矶 LAX #1", colo: "LAX", latency: 12 },
    { address: "1.1.1.2", port: 8443, ports: [8443], name: "🇺🇸 美国圣何塞 SJC #2", colo: "SJC", latency: 34 },
    { address: "1.1.1.3", port: 443, ports: [443], name: "优选-3", colo: "HKG", latency: 55 },
  ];
  const data = new Map([
    ["TEMPLATE", template],
    ["BEST_IPS", JSON.stringify(pool)],
    ["STATUS", JSON.stringify(status)],
  ]);
  return {
    SUB_TOKEN: "secret-token",
    SUB_READ_TOKEN: "read-token",
    VLESS_UUID: "11111111-1111-4111-8111-111111111111",
    VLESS_SNI: "example.com",
    VLESS_HOST: "example.com",
    VLESS_PATH: "/ws",
    VLESS_PORT: "443",
    VLESS_TYPE: "ws",
    VLESS_SECURITY: "tls",
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

test("sub sample mode prefers 443 and hides upstream latency in names", async () => {
  const response = await handleSub(subRequest("/sub?type=clash&mode=sample&n=3"), createSampleEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  // 1.1.1.1 过审端口含 443 时必须发 443，而不是 KV 里存的 2087
  assert.match(text, /server: "1\.1\.1\.1"[\s\S]*?port: 443/);
  // 名称不再带美国测速机的延迟（12ms/34ms/55ms 都不许出现）
  assert.doesNotMatch(text, /12ms|34ms|55ms/);
  assert.match(text, /🇺🇸 美国洛杉矶 LAX #\d/);
  // url-test 默认开启（2026-10-12 起所有模式都带）
  assert.match(text, /type: url-test/);
});

test("sub default mode also carries url-test group", async () => {
  const response = await handleSub(subRequest("/sub?type=clash&n=3"), createEnv());
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /type: url-test/);
  assert.match(text, /name: "自动测速"/);
});

test("sub sample mode applies to singbox with urltest outbound", async () => {
  const response = await handleSub(subRequest("/sub?type=singbox&mode=sample&n=3"), createSampleEnv());
  const parsed = JSON.parse(await response.text());

  assert.equal(response.status, 200);
  assert.equal(parsed.outbounds[0].type, "urltest");
  assert.equal(parsed.outbounds[1].type, "selector");
  const first = parsed.outbounds.find((outbound) => outbound.server === "1.1.1.1");
  assert.equal(first.server_port, 443);
});

test("edgetunnel probe prefers 443 on sampled nodes", async () => {
  const probe = new Request(
    "https://example.com/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000&mode=sample",
    { headers: { Authorization: "Bearer read-token", "User-Agent": "Mozilla/5.0 (compatible) edgetunnel/2.3.1" } },
  );

  // 免只读 token（探测旁路签名）
  const response = await handleSub(probe, createSampleEnv());
  assert.equal(response.status, 200);
  const decoded = Buffer.from(await response.text(), "base64").toString("utf8");
  const lines = decoded.split("\n").filter(Boolean);

  assert.equal(lines.length, 3);
  const expectedPorts = { "1.1.1.1": 443, "1.1.1.2": 8443, "1.1.1.3": 443 };
  for (const line of lines) {
    assert.match(line, /00000000-0000-4000-8000-000000000000/);
    assert.match(line, /example\.com/);
    const matched = line.match(/@([^:/?#]+):(\d+)/);
    assert.ok(matched, line);
    // 443 优先：1.1.1.1 过审端口含 443 就必须发 443（国内运营商对 2053/2083 等非标准端口
    // 建连超时的概率明显高于 443）；1.1.1.2 只过了 8443，保持原样
    assert.equal(Number(matched[2]), expectedPorts[matched[1]], `unexpected port for ${matched[1]}`);
  }
  // 名称里不许出现美国测速机的延迟
  assert.doesNotMatch(decoded, /12ms|34ms|55ms/);
});

test("edgetunnel probe caps sampled nodes at 30", async () => {
  const pool = Array.from({ length: 40 }, (_, index) => ({
    address: `10.0.0.${index + 1}`,
    port: 443,
    ports: [443],
    colo: "LAX",
    latency: 10,
  }));
  const data = new Map([
    ["TEMPLATE", template],
    ["BEST_IPS", JSON.stringify(pool)],
    ["STATUS", JSON.stringify(status)],
  ]);
  const env = {
    SUB_TOKEN: "secret-token",
    SUB_READ_TOKEN: "read-token",
    VLESS_UUID: "11111111-1111-4111-8111-111111111111",
    VLESS_SNI: "example.com",
    VLESS_HOST: "example.com",
    VLESS_PATH: "/ws",
    VLESS_PORT: "443",
    VLESS_TYPE: "ws",
    VLESS_SECURITY: "tls",
    SUB_PUBLIC: "0",
    SUB_KV: { async get(key) { return data.get(key) || null; }, put(key, value) { data.set(key, value); } },
  };
  const probe = new Request(
    "https://example.com/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000&mode=sample",
    { headers: { Authorization: "Bearer read-token", "User-Agent": "edgetunnel/2.3.1" } },
  );

  const response = await handleSub(probe, env);
  const decoded = Buffer.from(await response.text(), "base64").toString("utf8");
  assert.equal(decoded.split("\n").filter(Boolean).length, 30);
});

test("edgetunnel probe uses KV pool (mode=cidr was removed)", async () => {
  const pool = Array.from({ length: 40 }, (_, index) => ({
    address: `10.0.0.${index + 1}`,
    port: 443,
    ports: [443],
    colo: "LAX",
    latency: 10,
  }));
  const data = new Map([
    ["TEMPLATE", template],
    ["BEST_IPS", JSON.stringify(pool)],
    ["STATUS", JSON.stringify(status)],
  ]);
  const env = {
    SUB_TOKEN: "test-token",
    SUB_READ_TOKEN: "test-read-token",
    VLESS_UUID: "11111111-1111-4111-8111-111111111111",
    VLESS_SNI: "example.com",
    VLESS_HOST: "example.com",
    VLESS_PATH: "/ws",
    VLESS_PORT: "443",
    VLESS_TYPE: "ws",
    VLESS_SECURITY: "tls",
    SUB_PUBLIC: "0",
    SUB_KV: { async get(key) { return data.get(key) || null; }, put(key, value) { data.set(key, value); } },
  };
  // 不带 mode 参数的探测：默认走 KV 池（稳定）
  const probe = new Request(
    "https://example.com/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000",
    { headers: { Authorization: "Bearer read-token", "User-Agent": "edgetunnel/2.3.1" } },
  );
  const response = await handleSub(probe, env);
  assert.equal(response.status, 200);
  const decoded = Buffer.from(await response.text(), "base64").toString("utf8");
  const lines = decoded.split("\n").filter(Boolean);
  // 无国内实测、无手动置顶 → 只按固定顺序补齐 SUB_MIN_NODES（默认 10）个，不随机
  assert.equal(lines.length, 10);
  assert.match(lines[0], /@10\.0\.0\.1:443/);
  const again = Buffer.from(await (await handleSub(probe, env)).text(), "base64").toString("utf8");
  assert.equal(again, decoded, "两次探测结果必须一致");
});

test("sub rejects removed mode=cidr with a clear error", async () => {
  const response = await handleSub(subRequest("/sub?mode=cidr"), createEnv());
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "UNSUPPORTED_MODE");
});

test("sub sample mode rotates subsets across requests", async () => {
  const seen = new Set();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await handleSub(subRequest("/sub?type=vless&mode=sample&n=1"), createSampleEnv());
    const text = await response.text();
    seen.add(text.match(/@(1\.1\.1\.\d):/)?.[1]);
  }

  // 12 次各抽 1 个，若还是固定榜首永远只会见到同一个地址
  assert.ok(seen.size > 1, `expected rotation across requests, saw: ${[...seen].join(",")}`);
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
  assert.equal(parsed.outbounds.length, 3);
  // url-test 默认开启：自动测速组 + 选择器 + 节点
  assert.equal(parsed.outbounds[0].type, "urltest");
  assert.equal(parsed.outbounds[0].tag, "自动测速");
  assert.equal(parsed.outbounds[1].type, "selector");
  assert.equal(parsed.outbounds[2].server, "1.1.1.1");
  assert.equal(parsed.outbounds[2].tag, expectedGeneratedName);
});

test("P1-4 sub responses carry Subscription-Userinfo header", async () => {
  const response = await handleSub(subRequest("/sub?type=vless&n=1"), createEnv());
  const userinfo = response.headers.get("Subscription-Userinfo");

  assert.equal(response.status, 200);
  assert.match(userinfo, /^upload=0; download=107374182400; total=107374182400; expire=\d+$/);
  const expire = Number(userinfo.split("expire=")[1]);
  const nowSec = Math.floor(Date.now() / 1000);
  assert.ok(expire > nowSec + 29 * 24 * 3600 && expire <= nowSec + 31 * 24 * 3600);
});

test("P1-5 sub infers clash format from client UA when type is missing", async () => {
  const request = new Request("https://example.com/sub?n=1", {
    headers: { Authorization: "Bearer read-token", "User-Agent": "ClashForWindows/0.20.39" },
  });
  const response = await handleSub(request, createPublicEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /^proxies:/m);
});

test("P1-5 sub infers sing-box format from client UA when type is missing", async () => {
  const request = new Request("https://example.com/sub?n=1", {
    headers: { Authorization: "Bearer read-token", "User-Agent": "sing-box/1.10.0" },
  });
  const response = await handleSub(request, createPublicEnv());
  const parsed = JSON.parse(await response.text());

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(parsed.outbounds));
});

test("P1-5 explicit type parameter beats UA inference", async () => {
  const request = new Request("https://example.com/sub?type=vless&n=1", {
    headers: { Authorization: "Bearer read-token", "User-Agent": "ClashForWindows/0.20.39" },
  });
  const response = await handleSub(request, createPublicEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /^vless:\/\//);
});

test("P1-5 sub falls back to vless when UA is unknown", async () => {
  const response = await handleSub(subRequest("/sub?n=1"), createEnv());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /^vless:\/\//);
});

test("P2-6 sub excludes IPv6 pool by default, includes with ?ip6=1", async () => {
  const plain = await handleSub(subRequest("/sub?type=vless&n=100"), createEnv());
  const plainText = await plain.text();
  assert.ok(!plainText.includes("2400:cb00::1"));

  const withV6 = await handleSub(subRequest("/sub?type=vless&n=100&ip6=1"), createEnv());
  const v6Text = await withV6.text();
  assert.ok(v6Text.includes("[2400:cb00::1]:443"));
  assert.match(v6Text, /#%5BIPv6%5D/);
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

test("template API: POST is gone (410), config moved to env vars", async () => {
  const env = createEnv();
  const response = await handleTemplatePost(
    new Request("https://example.com/template", {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" },
      body: JSON.stringify({ fields: { uuid: "x" } }),
    }),
    env,
  );
  assert.equal(response.status, 410);
  const parsed = await response.json();
  assert.match(parsed.error, /环境变量/);
});

test("template API: GET returns env-based config", async () => {
  const env = createEnv();
  const response = await handleTemplateGet(
    new Request("https://example.com/template", {
      headers: { Authorization: "Bearer secret-token" },
    }),
    env,
  );
  const parsed = await response.json();
  assert.equal(response.status, 200);
  assert.equal(parsed.key, "ENV");
  assert.equal(parsed.fields.sni, "example.com");
  assert.equal(parsed.fields.host, "example.com");
  assert.equal(parsed.templateSafe.uuidMasked, "11111111…");
  assert.equal(parsed.warnings.length, 0);
});

test("template API: GET warns on risky SNI from env", async () => {
  const env = { ...createEnv(), VLESS_SNI: "xxx.workers.dev", VLESS_HOST: "xxx.workers.dev" };
  const response = await handleTemplateGet(
    new Request("https://example.com/template", {
      headers: { Authorization: "Bearer secret-token" },
    }),
    env,
  );
  const parsed = await response.json();
  assert.equal(response.status, 200);
  assert.ok(parsed.warnings.some((w) => w.field === "sni" && w.level === "warn"));
});

test("read-token API: anonymous request only learns configured flag, never the token", async () => {
  const response = await handleReadToken(new Request("https://example.com/api/read-token"), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.configured, true);
  assert.equal(parsed.readToken, undefined);
});

test("read-token API: admin token exchanges for read token", async () => {
  const response = await handleReadToken(new Request("https://example.com/api/read-token", {
    headers: { Authorization: "Bearer secret-token" },
  }), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.configured, true);
  assert.equal(parsed.readToken, "read-token");
});

test("read-token API: read token itself cannot be exchanged", async () => {
  const response = await handleReadToken(new Request("https://example.com/api/read-token", {
    headers: { Authorization: "Bearer read-token" },
  }), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.configured, true);
  assert.equal(parsed.readToken, undefined);
});

test("read-token API: wrong token does not leak the read token", async () => {
  const response = await handleReadToken(new Request("https://example.com/api/read-token", {
    headers: { Authorization: "Bearer wrong-token" },
  }), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.configured, true);
  assert.equal(parsed.readToken, undefined);
});

test("read-token API: query token is rejected by default", async () => {
  const response = await handleReadToken(new Request("https://example.com/api/read-token?token=secret-token"), createEnv());
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.readToken, undefined);
});

test("read-token API: reports unconfigured when SUB_READ_TOKEN missing", async () => {
  const env = createEnv();
  env.SUB_READ_TOKEN = "";
  const response = await handleReadToken(new Request("https://example.com/api/read-token", {
    headers: { Authorization: "Bearer secret-token" },
  }), env);
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(parsed, { configured: false });
});

test("best is public by default, requires token when SUB_PUBLIC=0", async () => {
  const env = { ...createEnv(), SUB_PUBLIC: "0" };
  const response = await handleBest(new Request("https://example.com/best?n=1"), env);
  assert.equal(response.status, 401);
  const publicResp = await handleBest(new Request("https://example.com/best?n=1"), createEnv());
  assert.notEqual(publicResp.status, 401);
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



test("versions is public by default, requires token when SUB_PUBLIC=0", async () => {
  const env = { ...createEnv(), SUB_PUBLIC: "0" };
  const response = await handleVersions(new Request("https://example.com/versions"), env);
  assert.equal(response.status, 401);
  const publicResp = await handleVersions(new Request("https://example.com/versions"), createEnv());
  assert.notEqual(publicResp.status, 401);
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

test("待国内验证反代池：只有国内实测 ok 的才进订阅且排最前", async () => {
  const at = new Date().toISOString();
  const data = new Map([
    ["BEST_IPS", JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ address: `10.0.1.${i + 1}`, port: 443, ports: [443], colo: "LAX" })))],
    ["STATUS", JSON.stringify(status)],
    ["CN_PENDING_IPS", JSON.stringify([
      { address: "150.230.1.1", port: 443, ports: [443], source: "cmliu-addresses-csv", pendingCn: true },
      { address: "150.230.1.2", port: 443, ports: [443], source: "cmliu-addresses-csv", pendingCn: true },
    ])],
    ["CN_PROBE_FEEDBACK", JSON.stringify([
      { at, address: "150.230.1.1", port: 443, rtt: 90, ok: true },
      { at, address: "150.230.1.1", port: 443, rtt: 110, ok: true },
    ])],
  ]);
  const env = {
    SUB_TOKEN: "t", SUB_READ_TOKEN: "r", SUB_PUBLIC: "0",
    VLESS_UUID: "11111111-1111-4111-8111-111111111111", VLESS_SNI: "example.com", VLESS_HOST: "example.com",
    VLESS_PATH: "/ws", VLESS_PORT: "443", VLESS_TYPE: "ws", VLESS_SECURITY: "tls",
    SUB_KV: { async get(key) { return data.get(key) || null; }, put(key, value) { data.set(key, value); } },
  };
  const probe = new Request("https://example.com/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000", { headers: { Authorization: "Bearer read-token", "User-Agent": "edgetunnel/2.3.1" } });
  const decoded = Buffer.from(await (await handleSub(probe, env)).text(), "base64").toString("utf8");
  const lines = decoded.split("\n").filter(Boolean);
  assert.match(lines[0], /@150\.230\.1\.1:443/);
  assert.ok(!decoded.includes("150.230.1.2"), "未验证的反代不能进订阅");
});

function edgeRequest() {
  return new Request("https://example.com/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000", {
    headers: { "User-Agent": "v2rayN/edgetunnel (https://github.com/cmliu/edgetunnel) Uid/0xabcdef Version/20261008" },
  });
}

test("edgetunnel probe never gets a non-2xx response (falls back to CN snapshot)", async () => {
  const snapshot = { updatedAt: Date.now(), all: [{ address: "104.16.1.1", port: 443, rtt: 80 }] };
  const data = new Map([["BEST_IPS", "[]"], ["CN_VERIFIED", JSON.stringify(snapshot)]]);
  const env = { SUB_KV: { async get(key) { return data.get(key) || null; }, async put() {} } };
  const response = await handleSub(edgeRequest(), env);
  assert.equal(response.status, 200);
  const decoded = Buffer.from(await response.text(), "base64").toString("utf8");
  assert.match(decoded, /@104\.16\.1\.1:443/);
});

test("edgetunnel probe survives a broken KV", async () => {
  const env = { SUB_KV: { async get() { throw new Error("kv down"); }, async put() {} } };
  const response = await handleSub(edgeRequest(), env);
  assert.equal(response.status, 200);
});

test("TLS port filter runs before the node limit", async () => {
  const nodes = [
    ...Array.from({ length: 5 }, (_, i) => ({ address: `9.9.9.${i + 1}`, port: 80, name: `bad-${i}` })),
    ...Array.from({ length: 5 }, (_, i) => ({ address: `8.8.8.${i + 1}`, port: 443, name: `good-${i}` })),
  ];
  const data = new Map([["BEST_IPS", JSON.stringify(nodes)]]);
  const env = { ...createEnv(), SUB_KV: { async get(key) { return data.get(key) || null; }, async put() {} } };
  const response = await handleSub(subRequest("/sub?type=vless&n=5&rank=off"), env);
  assert.equal(response.status, 200);
  const lines = (await response.text()).trim().split("\n");
  assert.equal(lines.length, 5);
  assert.ok(lines.every((line) => line.includes("@8.8.8.")));
});

test("/status masks node hostnames for anonymous visitors", async () => {
  const health = { checkedAt: "2026-10-15T00:00:00Z", config: { hosts: ["1.secret-domain.example"] }, hosts: {} };
  const data = new Map([["STATUS", "{}"], ["CN_HOST_HEALTH", JSON.stringify(health)]]);
  const env = { SUB_READ_TOKEN: "read-token", SUB_KV: { async get(key) { return data.get(key) || null; }, async put() {} } };
  const anon = await (await handleStatus(new Request("https://example.com/status"), env)).text();
  assert.doesNotMatch(anon, /secret-domain/);
});

test("maskHost keeps only the first character and the registrable suffix", async () => {
  const { maskHost } = await import("../src/api/status.js");
  assert.equal(maskHost("1.leilaomi.ccwu.cc"), "1***.ccwu.cc");
  assert.equal(maskHost("localhost"), "***");
});
