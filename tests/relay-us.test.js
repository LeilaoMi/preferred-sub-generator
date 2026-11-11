import test from "node:test";
import assert from "node:assert/strict";
import { applySourceFilters, collectCandidatesWithHealth, filterLinesByCountry } from "../scripts/lib/candidates.js";
import { buildUpdatePayload, isRelaySource, isUsCheckableRelay, rankRelayChecked } from "../scripts/update-kv.js";
import { pickTargets } from "../scripts/china-probe.js";
import { readRelayBonusMs, selectVerifiedNodes } from "../src/api/node-filter.js";
import { parseLandingColos } from "../src/utils/landing.js";

const US = parseLandingColos("US");

test("filterLinesByCountry 只留国家标签匹配的行", () => {
  const text = "1.2.3.4:443#US 洛杉矶\n5.6.7.8:443#HK\n9.9.9.9:443#RUS\n10.0.0.1:443\n11.0.0.1:443#us-west";
  assert.equal(filterLinesByCountry(text, "US"), "1.2.3.4:443#US 洛杉矶\n11.0.0.1:443#us-west");
});

test("applySourceFilters 按端口筛、去掉 CF 官方段", () => {
  const out = applySourceFilters(
    [
      { address: "1.2.3.4", port: 443, source: "r" },
      { address: "1.2.3.5", port: 8443, source: "r" },
      { address: "104.18.219.105", port: 443, source: "r" },
      { address: "1.2.3.6", port: null, source: "r" },
    ],
    { ports: [443], relayOnly: true },
  );
  assert.deepEqual(out.map((c) => `${c.address}:${c.port}`), ["1.2.3.4:443", "1.2.3.6:443"]);
});

test("collect：「IP 端口」两列格式、country 过滤、本地文件源", async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => (url.includes("zip") ? "1.1.1.10:443#US\n2.2.2.2:443#JP\n3.3.3.3:8443#US" : "4.4.4.4 443\n5.5.5.5 9997"),
  });
  const { candidates } = await collectCandidatesWithHealth({
    fetchImpl,
    remoteSources: [
      { name: "relay-us-zip", url: "https://zip.example/all.txt", relay: true, country: "US", ports: [443], relayOnly: true },
      { name: "relay-us-nirevil", url: "https://n.example/US.txt", relay: true, ports: [443], relayOnly: true },
      { name: "relay-us-fofa", file: "x.txt", readFileImpl: async () => "# c\n6.6.6.6\n104.16.1.1", relay: true, ports: [443], relayOnly: true },
    ],
  });
  assert.deepEqual(candidates.map((c) => `${c.source}:${c.address}:${c.port}`), [
    "relay-us-zip:1.1.1.10:443",
    "relay-us-nirevil:4.4.4.4:443",
    "relay-us-fofa:6.6.6.6:443",
  ]);
});

test("isRelaySource / isUsCheckableRelay", () => {
  assert.equal(isRelaySource("cmliu-addressesapi"), true);
  assert.equal(isRelaySource("relay-us-fofa"), true);
  assert.equal(isRelaySource("uouin"), false);
  assert.equal(isUsCheckableRelay("relay-us-zip"), true);
  assert.equal(isUsCheckableRelay("cmliu-addressesapi"), false);
});

test("rankRelayChecked：落地白名单外剔除，西海岸优先，再按延迟", () => {
  const out = rankRelayChecked(
    [
      { address: "a", colo: "EWR", latency: 5 },
      { address: "b", colo: "LAX", latency: 50 },
      { address: "c", colo: "HKG", latency: 1 },
      { address: "d", colo: "SJC", latency: 20 },
      { address: "e", colo: "", latency: 1 },
    ],
    US,
  );
  assert.deepEqual(out.map((x) => x.address), ["d", "b", "a"]);
});

test("buildUpdatePayload：美国反代过 trace 进待验证池，不进 BEST_IPS", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => "9.9.9.1:443#US\n9.9.9.2:443#US\n9.9.9.3:443#US" });
  const payload = await buildUpdatePayload({
    nodeConfig: { sni: "example.com", host: "example.com", security: "tls" },
    manualText: Array.from({ length: 25 }, (_, i) => `1.1.1.${i + 1}`).join("\n"),
    remoteSources: [{ name: "relay-us-zip", url: "https://zip.example/all.txt", relay: true, country: "US", ports: [443] }],
    fetchImpl,
    landing: US,
    checkOne: async (address) => {
      if (address === "9.9.9.2") return null; // 死的
      if (address === "9.9.9.3") return { latency: 10, colo: "HKG", edgeVerified: true }; // 落地不符
      return { latency: 20, colo: "LAX", edgeVerified: true };
    },
    downloadSpeedImpl: async () => null,
  });
  const best = JSON.parse(payload.BEST_IPS).map((n) => n.address);
  const pending = JSON.parse(payload.CN_PENDING_IPS);
  assert.equal(best.includes("9.9.9.1"), false);
  assert.deepEqual(pending.map((n) => [n.address, n.colo, n.source]), [["9.9.9.1", "LAX", "relay-us-zip"]]);
  assert.equal(pending[0].pendingCn, true);
  assert.deepEqual(JSON.parse(payload.STATUS).relayUs, { candidates: 3, alive: 2, inLanding: 1 });
});

test("pickTargets：没测过的美国反代每轮有固定额度，并按 HTTPS 验证", () => {
  const official = Array.from({ length: 20 }, (_, i) => ({ address: `104.16.0.${i + 1}`, port: 443, source: "uouin" }));
  const relays = Array.from({ length: 10 }, (_, i) => ({ address: `9.9.${i}.1`, port: 443, source: "relay-us-fofa", pendingCn: true }));
  const { targets } = pickTargets([...official, ...relays], [], 0, 10, { mode: "http" });
  const relayTargets = targets.filter((t) => t.address.startsWith("9.9."));
  assert.equal(relayTargets.length, 4);
  assert.ok(relayTargets.every((t) => t.relay === true));
});

test("selectVerifiedNodes：反代实测通过时排序加分，SUB_RELAY_BONUS_MS=0 关掉", () => {
  const nodes = [
    { address: "104.16.0.1", port: 443, source: "uouin" },
    { address: "9.9.9.1", port: 443, source: "relay-us-fofa" },
  ];
  const scores = new Map([
    ["104.16.0.1", { ok: true, rtt: 160, rank: 160 }],
    ["9.9.9.1", { ok: true, rtt: 200, rank: 200 }],
  ]);
  assert.deepEqual(selectVerifiedNodes(nodes, scores, { env: {} }).map((n) => n.address), ["9.9.9.1", "104.16.0.1"]);
  assert.deepEqual(selectVerifiedNodes(nodes, scores, { env: { SUB_RELAY_BONUS_MS: "0" } }).map((n) => n.address), ["104.16.0.1", "9.9.9.1"]);
  assert.equal(readRelayBonusMs({ SUB_RELAY_BONUS_MS: "abc" }), 60);
});

test("dir 源：读文件夹里所有 .txt/.csv/.gz（FOFA 导出直接上传）", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const { gzipSync } = await import("node:zlib");
  const dir = await fs.mkdtemp(`${os.tmpdir()}/fofa-`);
  await fs.writeFile(`${dir}/a.csv`, "host,ip,port,title\nhttps://x.com,7.7.7.7,443,\"Forbidden, 403\"\n");
  await fs.writeFile(`${dir}/b.csv.gz`, gzipSync("host,ip,port\n8.8.4.4:443,8.8.4.4,443\n"));
  await fs.writeFile(`${dir}/ignore.md`, "9.9.9.9");
  const { candidates } = await collectCandidatesWithHealth({
    remoteSources: [{ name: "relay-us-fofa", dir, type: "scrape", relay: true, ports: [443], relayOnly: true }],
  });
  assert.deepEqual(candidates.map((c) => `${c.address}:${c.port}`), ["7.7.7.7:443", "8.8.4.4:443"]);
});
