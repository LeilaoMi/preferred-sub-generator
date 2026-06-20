import test from "node:test";
import assert from "node:assert/strict";
import { checkCandidates, parseCfRayColo } from "../scripts/lib/check.js";
import { collectCandidates, collectCandidatesWithHealth, expandIPv4Cidr, expandIPv6Cidr, parseCandidate, uniqueCandidates } from "../scripts/lib/candidates.js";
import { deleteKvValue, readKvValue, writeKvValue } from "../scripts/lib/kv.js";
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

test("expand IPv4 CIDR into sampled edge candidates with more samples", () => {
  const result = expandIPv4Cidr("1.1.1.0/28", 6);

  assert.deepEqual(result, [
    { address: "1.1.1.1", port: null },
    { address: "1.1.1.3", port: null },
    { address: "1.1.1.6", port: null },
    { address: "1.1.1.8", port: null },
    { address: "1.1.1.11", port: null },
    { address: "1.1.1.14", port: null },
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

test("collect candidates expands IPv6 CIDR from Cloudflare official source", async () => {
  const result = await collectCandidates({
    manualText: "",
    remoteSources: [{ name: "cloudflare-official-v6", url: "https://www.cloudflare.com/ips-v6/", type: "text", cidrSamples: 2 }],
    fetchImpl: async () => new Response("2400:cb00::/32\n2606:4700::/32"),
  });

  assert.equal(result.length, 4);
  assert.ok(result.every((item) => item.address.includes(":")));
  assert.ok(result.every((item) => item.port === null));
  assert.deepEqual(result.map((item) => item.source), ["cloudflare-official-v6", "cloudflare-official-v6", "cloudflare-official-v6", "cloudflare-official-v6"]);
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

test("check candidates sorts by speed descending when bandwidth data present", async () => {
  // 模拟国内场景：延迟低但带宽低的节点 应排在 延迟高但带宽高的节点 之后
  const candidates = [
    { address: "low-latency", port: 443, speed: 3.2 },   // 低带宽
    { address: "high-bandwidth", port: 443, speed: 11.6 }, // 高带宽
    { address: "no-speed", port: 443 },                   // 无带宽数据
  ];
  const result = await checkCandidates(candidates, [443], {
    checkOne: async (address) => ({
      latency: address === "low-latency" ? 12 : address === "high-bandwidth" ? 73 : 50,
      colo: "NRT",
      edgeVerified: true,
    }),
  });

  // 高带宽排第一，低带宽第二，无带宽排最后
  assert.deepEqual(result.map((item) => item.address), ["high-bandwidth", "low-latency", "no-speed"]);
  assert.equal(result[0].speed, 11.6);
});

test("check candidates falls back to latency when no speed data", async () => {
  const result = await checkCandidates(
    [{ address: "a.example", port: null }],
    [443, 8443],
    {
      checkOne: async (address, port) => (port === 443 ? { latency: 20, colo: "LAX", edgeVerified: true } : { latency: 10, colo: "SJC", edgeVerified: true }),
    },
  );

  assert.deepEqual(result.map((item) => item.port), [8443, 443]);
});

test("check candidates can require Cloudflare ray verification", async () => {
  const result = await checkCandidates(
    [{ address: "a.example", port: 443 }],
    [443],
    {
      requireCfRay: true,
      allowTcpOnly: false,
      checkOne: async () => ({ latency: 5, colo: "", edgeVerified: false }),
    },
  );

  assert.deepEqual(result, []);
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
  assert.equal(bestIps[0].speed, null);
  assert.equal(status.updatedAt, "2026-06-03T00:00:00.000Z");
  assert.equal(status.available, 50);
  assert.equal(status.protectedByPrevious, false);
  assert.equal(status.requireCfRay, true);
  assert.equal(status.allowTcpOnly, false);
  assert.equal(status.averageSpeed, null);
  assert.equal(JSON.parse(payload.SOURCE_HEALTH).length, 1);
  assert.equal(payload.LAST_RUN_AT, "2026-06-03T00:00:00.000Z");
  assert.equal(payload.LAST_RUN_OK, "true");
  assert.equal(payload.LAST_RUN_AVAILABLE, "50");
  assert.equal(JSON.parse(payload.BEST_IPS_LAST).length, 50);
  assert.equal(JSON.parse(payload.BEST_IPS_TREND).length, 1);
  assert.equal(status.available, 50);
});

test("build update payload records speed when CSV source provides bandwidth", async () => {
  const csv = [
    "IP地址,端口,回源端口,TLS,数据中心,地区,城市,TCP延迟(ms),速度(MB/s)",
    "141.147.162.204,443,443,true,NRT,Asia Pacific,Tokyo,73,11.59",
    "130.61.203.115,443,443,true,FRA,Europe,Frankfurt,195,5.0",
  ].join("\n");
  const payload = await buildUpdatePayload({
    originalNode: "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点",
    remoteSources: [{ name: "csv", url: "https://source.example/addressescsv.csv", type: "csv", minSpeed: 0 }],
    checkOne: async (address) => ({ latency: 50, colo: "NRT", edgeVerified: true }),
    fetchImpl: async () => new Response(csv),
    now: new Date("2026-06-03T00:00:00.000Z"),
  });
  const bestIps = JSON.parse(payload.BEST_IPS);
  const status = JSON.parse(payload.STATUS);

  // 高带宽节点应排在前面
  assert.deepEqual(bestIps.map((item) => item.address), ["141.147.162.204", "130.61.203.115"]);
  assert.equal(bestIps[0].speed, 11.59);
  assert.equal(bestIps[1].speed, 5.0);
  assert.equal(status.averageSpeed, 8); // (11.59 + 5.0) / 2 ≈ 8.3 → 8
});

test("build update payload keeps previous nodes when new result is too small", async () => {
  const previousBestIps = [{ address: "9.9.9.9", port: 443, name: "旧节点" }];
  const payload = await buildUpdatePayload({
    originalNode: "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点",
    manualText: "1.1.1.1",
    remoteSources: [],
    previousBestIps,
    previousStatus: { consecutiveFallbacks: 2, lastSuccessfulRefreshAt: "2026-06-02T00:00:00.000Z" },
    checkOne: async () => ({ latency: 10, colo: "LAX", edgeVerified: true }),
    now: new Date("2026-06-03T00:00:00.000Z"),
  });
  const bestIps = JSON.parse(payload.BEST_IPS);
  const status = JSON.parse(payload.STATUS);

  assert.deepEqual(bestIps, previousBestIps);
  assert.equal(status.available, 1);
  assert.equal(status.newAvailable, 6);
  assert.equal(status.lastRawAvailable, 6);
  assert.equal(status.consecutiveFallbacks, 3);
  assert.equal(status.lastSuccessfulRefreshAt, "2026-06-02T00:00:00.000Z");
  assert.equal(status.protectedByPrevious, true);
  assert.match(status.lastError, /已保留上次可用结果/);
});

test("build update payload keeps version index bounded", async () => {
  const previousVersionIndex = Array.from({ length: 31 }, (_, index) => `BEST_IPS_OLD_${String(index).padStart(2, "0")}`);
  const payload = await buildUpdatePayload({
    originalNode: "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点",
    manualText: "1.1.1.1\n1.1.1.2\n1.1.1.3\n1.1.1.4\n1.1.1.5\n1.1.1.6\n1.1.1.7\n1.1.1.8\n1.1.1.9\n1.1.1.10\n1.1.1.11\n1.1.1.12\n1.1.1.13\n1.1.1.14\n1.1.1.15\n1.1.1.16\n1.1.1.17\n1.1.1.18\n1.1.1.19\n1.1.1.20",
    remoteSources: [],
    previousVersionIndex,
    checkOne: async (address) => ({ latency: Number(address.split(".").at(-1)), colo: "LAX", edgeVerified: true }),
    now: new Date("2026-06-03T00:00:00.000Z"),
  });

  const index = JSON.parse(payload.BEST_IPS_VERSION_INDEX);
  const expired = JSON.parse(payload.BEST_IPS_EXPIRED_VERSIONS);
  assert.equal(index.length, 30);
  assert.equal(index[0], "BEST_IPS_20260603T000000Z");
  assert.deepEqual(expired, ["BEST_IPS_OLD_29", "BEST_IPS_OLD_30"]);
});

test("collect candidates records source health and rejects oversized source", async () => {
  const result = await collectCandidatesWithHealth({
    manualText: "1.1.1.1",
    remoteSources: [
      { name: "ok-source", url: "https://source.example/ok.txt" },
      { name: "large-source", url: "https://source.example/large.txt", maxBytes: 5 },
      { name: "bad-source", url: "https://source.example/bad.txt" },
    ],
    fetchImpl: async (url) => {
      if (url.includes("ok")) return new Response("2.2.2.2\n3.3.3.3", { status: 200 });
      if (url.includes("large")) return new Response("123456789", { status: 200 });
      return new Response("server error", { status: 500 });
    },
  });

  assert.deepEqual(result.candidates.map((item) => item.address), ["1.1.1.1", "2.2.2.2", "3.3.3.3"]);
  assert.equal(result.sourceHealth.find((item) => item.name === "edge-manual").ok, true);
  assert.equal(result.sourceHealth.find((item) => item.name === "ok-source").candidates, 2);
  assert.equal(result.sourceHealth.find((item) => item.name === "large-source").ok, false);
  assert.match(result.sourceHealth.find((item) => item.name === "large-source").error, /source too large/);
  assert.equal(result.sourceHealth.find((item) => item.name === "bad-source").status, 500);
});


test("build update payload honors source max bytes and version retention options", async () => {
  const previousVersionIndex = ["BEST_IPS_A", "BEST_IPS_B", "BEST_IPS_C"];
  const payload = await buildUpdatePayload({
    originalNode: "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点",
    manualText: Array.from({ length: 20 }, (_, index) => `1.1.1.${index + 1}`).join("\n"),
    remoteSources: [{ name: "too-large", url: "https://source.example/large.txt" }],
    previousVersionIndex,
    maxSourceBytes: 5,
    versionRetention: 2,
    fetchImpl: async () => new Response("123456789", { status: 200 }),
    checkOne: async (address) => ({ latency: Number(address.split(".").at(-1)), colo: "LAX", edgeVerified: true }),
    now: new Date("2026-06-03T00:00:00.000Z"),
  });

  const sourceHealth = JSON.parse(payload.SOURCE_HEALTH);
  assert.equal(sourceHealth.find((item) => item.name === "too-large").ok, false);
  assert.match(sourceHealth.find((item) => item.name === "too-large").error, /source too large/);
  assert.equal(JSON.parse(payload.BEST_IPS_VERSION_INDEX).length, 2);
  assert.deepEqual(JSON.parse(payload.BEST_IPS_EXPIRED_VERSIONS), ["BEST_IPS_B", "BEST_IPS_C"]);
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

test("delete KV value calls Cloudflare API", async () => {
  let captured;
  await deleteKvValue({
    accountId: "account-id",
    namespaceId: "namespace-id",
    apiToken: "secret-token",
    key: "BEST_IPS_OLD",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response("{}", { status: 200 });
    },
  });

  assert.match(captured.url, /values\/BEST_IPS_OLD/);
  assert.equal(captured.options.method, "DELETE");
  assert.equal(captured.options.headers.Authorization, "Bearer secret-token");
});