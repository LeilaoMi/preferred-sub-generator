import test from "node:test";
import assert from "node:assert/strict";
import { generateLoonSubscription } from "../src/generator/loon.js";
import { generateSurgeSubscription } from "../src/generator/surge.js";
import { capPoolWithManual } from "../scripts/update-kv.js";
import { readBestIpsV6, readBestIpVersions, readStatus } from "../src/api/kv.js";
import { checkWranglerToml } from "../scripts/preflight.js";
import { fetchReadToken } from "../scripts/probe-ips.js";

const template = {
  uuid: "11111111-1111-4111-8111-111111111111",
  address: "origin.example.com",
  port: 443,
  security: "tls",
  type: "ws",
  host: "origin.example.com",
  sni: "origin.example.com",
  path: "/ws",
};

test("Loon drops nodes whose host/path injects CR/LF or comma, keeps legit nodes", () => {
  const nodes = [
    { address: "1.1.1.1", port: 443, name: "good" },
    { address: "2.2.2.2", port: 443, name: "bad-host", host: "evil.example.com\nFake = VLESS,9.9.9.9" },
    { address: "3.3.3.3", port: 443, name: "bad-path", path: "/ws\r\nFake = VLESS,9.9.9.9" },
    { address: "4.4.4.4", port: 443, name: "bad-comma", host: "a.example.com,b.example.com" },
  ];
  const conf = generateLoonSubscription(template, nodes);
  assert.match(conf, /good = VLESS,1\.1\.1\.1/);
  assert.doesNotMatch(conf, /9\.9\.9\.9/);
  assert.doesNotMatch(conf, /bad-host|bad-path|bad-comma/);
});

test("Surge drops nodes whose host/path injects CR/LF or comma, keeps legit nodes", () => {
  const nodes = [
    { address: "1.1.1.1", port: 443, name: "good" },
    { address: "2.2.2.2", port: 443, name: "bad-path", path: "/ws\nFake = trojan, 9.9.9.9" },
  ];
  const conf = generateSurgeSubscription(template, nodes);
  assert.match(conf, /good = trojan, 1\.1\.1\.1/);
  assert.doesNotMatch(conf, /9\.9\.9\.9/);
  assert.doesNotMatch(conf, /bad-path/);
});

test("capPoolWithManual keeps manual entries but never exceeds the pool limit", () => {
  const scanned = Array.from({ length: 300 }, (_, i) => ({ address: `10.0.0.${i + 1}`, source: "seed" }));
  const manual = Array.from({ length: 4 }, (_, i) => ({ address: `192.0.2.${i + 1}`, source: "edge-manual" }));
  const result = capPoolWithManual([...scanned, ...manual], 300);
  assert.equal(result.length, 300);
  assert.equal(result.filter((item) => item.source === "edge-manual").length, 4);
  assert.equal(result.filter((item) => item.source === "seed").length, 296);
});

test("KV V6/status/versions degrade on corrupt JSON instead of throwing", async () => {
  const badKv = { get: async () => "{not-json" };
  assert.deepEqual(await readBestIpsV6(badKv), []);
  assert.deepEqual(await readBestIpVersions(badKv), []);
  assert.deepEqual(await readStatus(badKv), { updatedAt: null, available: 0 });
});

test("preflight detects the example wrangler placeholder too", () => {
  const issues = checkWranglerToml(`
pages_build_output_dir = "public"
[[kv_namespaces]]
binding = "SUB_KV"
id = "replace_with_your_cloudflare_kv_namespace_id"
`);
  assert.deepEqual(issues, ["wrangler.toml 的 KV Namespace ID 仍是占位符"]);
});

test("probe fetchReadToken never falls back to the management token", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ configured: false }), { status: 200 });
  try {
    assert.equal(await fetchReadToken("https://example.com", "mgmt-token-123"), "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
