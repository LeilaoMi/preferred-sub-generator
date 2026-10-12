import test from "node:test";
import assert from "node:assert/strict";
import { ispLabel, mergeEntries, pickTargets, resultToEntry } from "../scripts/china-probe.js";
import { loadIpScores } from "../src/api/ip-feedback.js";

test("ispLabel 识别三网", () => {
  assert.equal(ispLabel("Chinanet Backbone"), "CT");
  assert.equal(ispLabel("CHINA UNICOM China169 Backbone"), "CU");
  assert.equal(ispLabel("China Mobile Communications Group"), "CM");
});

test("resultToEntry 丢包过多判失败", () => {
  const t = { address: "1.2.3.4", port: 443 };
  const good = resultToEntry(t, { probe: { network: "Chinanet" }, result: { status: "finished", stats: { total: 3, rcv: 3, avg: 180.26 } } }, "x");
  assert.equal(good.ok, true);
  assert.equal(good.rtt, 180.3);
  assert.equal(good.region, "CN-CT");
  const bad = resultToEntry(t, { probe: { network: "China Mobile" }, result: { status: "finished", stats: { total: 3, rcv: 1, avg: 100 } } }, "x");
  assert.equal(bad.ok, false);
  assert.equal(bad.rtt, null);
});

test("pickTargets 置顶优先、轮转覆盖整池、跳过域名", () => {
  const pool = [
    { address: "a.example.com", source: "edge-manual" },
    { address: "9.9.9.9", source: "edge-manual", port: 2053 },
    ...Array.from({ length: 6 }, (_, i) => ({ address: `1.0.0.${i}` })),
  ];
  const first = pickTargets(pool, [], 0, 3);
  assert.deepEqual(first.targets.map((t) => t.address), ["9.9.9.9", "1.0.0.0", "1.0.0.1"]);
  assert.equal(first.targets[0].port, 2053);
  const second = pickTargets(pool, [], first.nextCursor, 3);
  assert.ok(second.targets.some((t) => t.address === "1.0.0.2"));
});

test("mergeEntries 丢弃 3 天前的数据", () => {
  const now = Date.parse("2026-10-12T00:00:00Z");
  const merged = mergeEntries([{ at: "2026-10-01T00:00:00Z" }, { at: "2026-10-11T00:00:00Z" }], [{ at: "2026-10-12T00:00:00Z" }], now);
  assert.equal(merged.length, 2);
});

test("loadIpScores 合并国内三网自动实测", async () => {
  const at = new Date().toISOString();
  const kv = new Map([["CN_PROBE_FEEDBACK", JSON.stringify([
    { at, address: "5.5.5.5", port: 443, rtt: 50, ok: true },
    { at, address: "5.5.5.5", port: 443, rtt: 70, ok: true },
    { at, address: "6.6.6.6", port: 443, rtt: null, ok: false },
  ])]]);
  const env = { SUB_KV: { async get(k) { return kv.get(k) || null; } } };
  const { scores } = await loadIpScores(env, { days: 3 });
  assert.equal(scores.get("5.5.5.5").rtt, 60);
  assert.equal(scores.get("6.6.6.6").unreachable, true);
});
