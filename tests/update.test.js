import test from "node:test";
import assert from "node:assert/strict";
import { checkCandidates, parseCfRayColo } from "../scripts/lib/check.js";
import { collectCandidates, expandIPv4Cidr, parseCandidate, uniqueCandidates } from "../scripts/lib/candidates.js";
import { readKvValue, writeKvValue } from "../scripts/lib/kv.js";
import { buildUpdatePayload } from "../scripts/update-kv.js";

test("parse candidates from IP, host:port and URL", () => {
  assert.deepEqual(parseCandidate("1.1.1.1"), { address: "1.1.1.1", port: null });
  assert.deepEqual(parseCandidate("example.com:8443"), { address: "example.com", port: 8443 });
  assert.deepEqual(parseCandidate("https://node.example.com:8443"), { address: "node.example.com", port: 8443 });
  assert.deepEqual(parseCandidate("[2606:4700::6810:85e5]:443"), { address: "2606:4700::6810:85e5", port: 443 });
  assert.deepEqual(parseCandidate("2606:4700::6810:85e5"), { address: "2606:4700::6810:85e5", port: null });
  assert.equal(parseCandidate(""), null);
});

test("expand IPv4 CIDR into sampled edge candidates", () => {
  const result = expandIPv4Cidr("1.1.1.0/30", 4);

  assert.deepEqual(result, [
    { address: "1.1.1.1", port: null },
    { address: "1.1.1.2", port: null },
  ]);
});

test("deduplicate candidates", () => {
  const result = uniqueCandidates([
    { address: "1.1.1.1", port: null },
    { address: "1.1.1.1", port: null },
    { address: "1.1.1.1", port: 443 },
  ]);

  assert.equal(result.length, 2);
});

test("collect candidates from manual and remote sources", async () => {
  const result = await collectCandidates({
    manualText: "1.1.1.1\nexample.com:443",
    remoteSources: [{ name: "remote", url: "https://source.example/list.txt" }],
    fetchImpl: async () => new Response("2.2.2.2\nhttps://node.example:8443/path"),
  });

  assert.deepEqual(result.map((item) => `${item.address}:${item.port || ""}`), [
    "1.1.1.1:",
    "example.com:443",
    "2.2.2.2:",
    "node.example:8443",
  ]);
});

test("collect candidates from CloudflareSpeedTest CSV source", async () => {
  const csv = [
    "IP地址,端口,回源端口,TLS,数据中心,地区,城市,TCP延迟(ms),速度(MB/s)",
    "141.147.162.204,443,443,true,NRT,Asia Pacific,Tokyo,73,11.59",
    "141.147.162.205,443,443,true,NRT,Asia Pacific,Tokyo,80,3.2",
  ].join("\n");

  const result = await collectCandidates({
    remoteSources: [{ name: "csv", url: "https://source.example/addressescsv.csv", type: "csv", minSpeed: 8 }],
    fetchImpl: async () => new Response(csv),
  });

  assert.deepEqual(result, [{
    address: "141.147.162.204",
    port: 443,
    source: "csv",
    tls: true,
    colo: "NRT",
    speed: 11.59,
  }]);
});

test("parse Cloudflare ray colo", () => {
  assert.equal(parseCfRayColo("973bbddc7e2210a8-LAX"), "LAX");
  assert.equal(parseCfRayColo("bad-value"), "");
});

test("check candidates sorts by latency, expands ports and keeps colo", async () => {
  const result = await checkCandidates(
    [{ address: "a.example", port: null }],
    [443, 8443],
    {
      checkOne: async (address, port) => (port === 443 ? { latency: 20, colo: "LAX", edgeVerified: true } : { latency: 10, colo: "SJC", edgeVerified: true }),
    },
  );

  assert.deepEqual(result.map((item) => item.port), [8443, 443]);
  assert.equal(result[0].colo, "SJC");
  assert.equal(result[0].edgeVerified, true);
});

test("build update payload keeps top 50 checked nodes with colo names", async () => {
  const payload = await buildUpdatePayload({
    originalNode: "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点",
    manualText: Array.from({ length: 60 }, (_, index) => `1.1.1.${index + 1}`).join("\n"),
    remoteSources: [],
    checkOne: async (address) => ({ latency: Number(address.split(".").at(-1)), colo: "LAX", edgeVerified: true }),
    now: new Date("2026-06-03T00:00:00.000Z"),
  });
  const bestIps = JSON.parse(payload.BEST_IPS);
  const status = JSON.parse(payload.STATUS);

  assert.equal(payload.TEMPLATE.startsWith("vless://"), true);
  assert.equal(bestIps.length, 50);
  assert.equal(bestIps[0].address, "1.1.1.1");
  assert.equal(bestIps[0].name, "🇺🇸 美国洛杉矶 LAX 1ms #1");
  assert.equal(bestIps[0].colo, "LAX");
  assert.equal(status.updatedAt, "2026-06-03T00:00:00.000Z");
  assert.equal(status.available, 50);
  assert.equal(status.protectedByPrevious, false);
});

test("build update payload keeps previous nodes when new result is too small", async () => {
  const previousBestIps = [{ address: "9.9.9.9", port: 443, name: "旧节点" }];
  const payload = await buildUpdatePayload({
    originalNode: "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点",
    manualText: "1.1.1.1",
    remoteSources: [],
    previousBestIps,
    checkOne: async () => ({ latency: 10, colo: "LAX", edgeVerified: true }),
    now: new Date("2026-06-03T00:00:00.000Z"),
  });
  const bestIps = JSON.parse(payload.BEST_IPS);
  const status = JSON.parse(payload.STATUS);

  assert.deepEqual(bestIps, previousBestIps);
  assert.equal(status.available, 1);
  assert.equal(status.newAvailable, 6);
  assert.equal(status.protectedByPrevious, true);
  assert.match(status.lastError, /已保留上次可用结果/);
});

test("read KV value returns text or null for missing key", async () => {
  const ok = await readKvValue({
    accountId: "account-id",
    namespaceId: "namespace-id",
    apiToken: "secret-token",
    key: "BEST_IPS",
    fetchImpl: async () => new Response("[]", { status: 200 }),
  });
  const missing = await readKvValue({
    accountId: "account-id",
    namespaceId: "namespace-id",
    apiToken: "secret-token",
    key: "BEST_IPS",
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });

  assert.equal(ok, "[]");
  assert.equal(missing, null);
});

test("write KV value calls Cloudflare API without exposing secrets", async () => {
  let captured;
  await writeKvValue({
    accountId: "account-id",
    namespaceId: "namespace-id",
    apiToken: "secret-token",
    key: "BEST_IPS",
    value: "[]",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response("{}", { status: 200 });
    },
  });

  assert.match(captured.url, /accounts\/account-id\/storage\/kv\/namespaces\/namespace-id\/values\/BEST_IPS/);
  assert.equal(captured.options.method, "PUT");
  assert.equal(captured.options.body, "[]");
  assert.equal(captured.options.headers.Authorization, "Bearer secret-token");
});
