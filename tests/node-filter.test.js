import test from "node:test";
import assert from "node:assert/strict";
import { filterNodesByColo, isMeasuredOk, orderNodesByMeasurement, preferredPort, rankNodesByScore, readRttDropMs, sampleNodes, sampleWeight, withPreferredPort } from "../src/api/node-filter.js";
import { getPortsForSecurity, getPreferredPortOrder } from "../src/utils/ports.js";

const nodes = [
  { address: "1.1.1.1", port: 8443, colo: "LAX", latency: 20 },
  { address: "2.2.2.2", port: 443, colo: "SJC", latency: 30 },
  { address: "3.3.3.3", port: 2087, colo: "HKG", latency: 40 },
  { address: "4.4.4.4", port: 443, colo: "LAX", latency: 50 },
];

function sequencedRandom(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

test("sampleNodes returns at most limit nodes from the pool", () => {
  const sampled = sampleNodes(nodes, { limit: 2, random: sequencedRandom([0.9, 0.1, 0.5, 0.3]) });

  assert.equal(sampled.length, 2);
  assert.equal(new Set(sampled.map((node) => node.address)).size, 2);
});

test("sampleNodes drops locally unreachable nodes but keeps measured decoration", () => {
  const scores = new Map([
    ["1.1.1.1", { rtt: 18, speed: 40, colo: "HKG", samples: 3, failed: 0, unreachable: false }],
    ["2.2.2.2", { rtt: null, speed: null, samples: 0, failed: 4, unreachable: true }],
  ]);

  const sampled = sampleNodes(nodes, { limit: 10, scores, random: sequencedRandom([0.9, 0.8, 0.7]) });

  assert.equal(sampled.some((node) => node.address === "2.2.2.2"), false);
  const measured = sampled.find((node) => node.address === "1.1.1.1");
  assert.equal(measured.userRtt, 18);
  assert.equal(measured.userColo, "HKG");
});

test("sampleNodes keeps pool when every node is marked unreachable", () => {
  const scores = new Map(nodes.map((node) => [node.address, { unreachable: true, failed: 5, samples: 0 }]));

  const sampled = sampleNodes(nodes, { limit: 3, scores, random: sequencedRandom([0.2, 0.4, 0.6, 0.8]) });

  assert.equal(sampled.length, 3);
});

test("sampleWeight: measured nodes get 3, others get 1", () => {
  const measured = sampleWeight({ rtt: 20, unreachable: false }, 1000);
  const slow = sampleWeight({ rtt: 5000, unreachable: false }, 1000);
  const dead = sampleWeight({ unreachable: true }, 1000);
  const none = sampleWeight(null, 1000);

  assert.equal(measured, 3);
  assert.equal(slow, 1);
  assert.equal(dead, 1);
  assert.equal(none, 1);
});

test("withPreferredPort prefers 443 when the pool entry passed it", () => {
  assert.deepEqual(withPreferredPort({ address: "1.1.1.1", port: 2087, ports: [2087, 443] }), { address: "1.1.1.1", port: 443, ports: [2087, 443] });
  assert.equal(preferredPort({ address: "1.1.1.1", port: 2087, ports: [2087] }), 2087);
  assert.equal(withPreferredPort({ address: "1.1.1.1", port: 8443 }).port, 8443);
});

test("sampled selection composes with colo bucket filter", () => {
  const bucket = filterNodesByColo(nodes, ["LAX"]).nodes;
  const sampled = sampleNodes(bucket, { limit: 5, random: sequencedRandom([0.5, 0.6]) });

  assert.deepEqual(new Set(sampled.map((node) => node.address)), new Set(["1.1.1.1", "4.4.4.4"]));
});

test("orderNodesByMeasurement sorts measured pool by real RTT, rest keep pool order", () => {
  const scores = new Map([
    ["3.3.3.3", { rtt: 90, speed: 10, colo: "HKG", samples: 2, failed: 0, unreachable: false }],
    ["1.1.1.1", { rtt: 30, speed: 5, samples: 1, failed: 0, unreachable: false }],
  ]);
  const ranked = orderNodesByMeasurement(nodes, scores);

  // 实测池按 RTT 升序：1.1.1.1 (30ms) 在 3.3.3.3 (90ms) 前面
  assert.equal(ranked[0].address, "1.1.1.1");
  assert.equal(ranked[0].userRtt, 30);
  assert.equal(ranked[1].address, "3.3.3.3");
  assert.equal(ranked[1].userRtt, 90);
  // 没测过的保持原池顺序
  assert.deepEqual(ranked.slice(2).map((n) => n.address), ["2.2.2.2", "4.4.4.4"]);
});

test("orderNodesByMeasurement drops nodes above the rtt threshold", () => {
  const scores = new Map([
    ["1.1.1.1", { rtt: 50, unreachable: false }],
    ["2.2.2.2", { rtt: 5000, unreachable: false }],
  ]);
  const ranked = orderNodesByMeasurement(nodes, scores);
  // 2.2.2.2 超过 1000ms 门槛，不进实测池，掉到后面
  assert.equal(ranked[0].address, "1.1.1.1");
  assert.ok(ranked.map((n) => n.address).indexOf("2.2.2.2") > 0);

  const ranked2 = orderNodesByMeasurement(nodes, scores, { rttDropMs: 10000 });
  assert.equal(ranked2[0].address, "1.1.1.1");
  assert.equal(ranked2[1].address, "2.2.2.2");
});

test("orderNodesByMeasurement drops unreachable nodes but never empties the list", () => {
  const scores = new Map(nodes.map((node) => [node.address, { unreachable: true }]));
  const ranked = orderNodesByMeasurement(nodes, scores);
  assert.equal(ranked.length, 4);
});

test("isMeasuredOk is the single source of truth for usable measurements", () => {
  assert.equal(isMeasuredOk({ rtt: 50, unreachable: false }, 1000), true);
  assert.equal(isMeasuredOk({ rtt: 5000, unreachable: false }, 1000), false);
  assert.equal(isMeasuredOk({ rtt: 50, unreachable: true }, 1000), false);
  assert.equal(isMeasuredOk({ rtt: null, unreachable: false }, 1000), false);
  assert.equal(isMeasuredOk(null, 1000), false);
});

test("readRttDropMs reads SUB_RTT_DROP_MS with a sane default", () => {
  assert.equal(readRttDropMs({ SUB_RTT_DROP_MS: "2000" }), 2000);
  assert.equal(readRttDropMs({ SUB_RTT_DROP_MS: "bogus" }), 1000);
  assert.equal(readRttDropMs({}), 1000);
});

// 旧名别名保留，后续版本删除
test("rankNodesByScore is an alias of orderNodesByMeasurement", () => {
  const scores = new Map([["3.3.3.3", { rtt: 9, speed: 10, colo: "HKG", samples: 2, failed: 0, unreachable: false }]]);
  const ranked = rankNodesByScore(nodes, scores);

  assert.equal(ranked[0].address, "3.3.3.3");
  assert.equal(ranked[0].userRtt, 9);
});

test("P1-3 getPortsForSecurity honors SUB_PREFERRED_PORTS override", () => {
  assert.deepEqual(getPortsForSecurity("tls", { SUB_PREFERRED_PORTS: "8443,443,2053" }), [8443, 443, 2053]);
  assert.deepEqual(getPortsForSecurity("tls", {}), [443, 8443, 2053, 2083, 2087, 2096]);
  assert.deepEqual(getPortsForSecurity("none", {}), [80, 8080, 8880, 2052, 2082, 2086, 2095]);
  assert.equal(getPreferredPortOrder({}), null);
  assert.equal(getPreferredPortOrder({ SUB_PREFERRED_PORTS: "bogus" }), null);
});

test("P1-3 preferredPort follows custom port order when provided", () => {
  const node = { address: "1.1.1.1", port: 443, ports: [443, 8443, 2053] };
  assert.equal(preferredPort(node), 443);
  assert.equal(preferredPort(node, [8443, 443]), 8443);
  assert.equal(withPreferredPort(node, [2053]).port, 2053);
  // 覆盖顺序里没有的端口回退到原逻辑
  assert.equal(preferredPort({ address: "1.1.1.1", port: 2087, ports: [2087] }, [8443]), 2087);
});

import { selectVerifiedNodes as selectVerifiedNodesForTest } from "../src/api/node-filter.js";

test("selectVerifiedNodes: 实测 ok > 手动置顶 > 补齐，判死剔除，结果确定", () => {
  const pool = [
    { address: "a", source: "cloudflare-official-v4" },
    { address: "b", source: "cloudflare-official-v4" },
    { address: "c", source: "edge-manual" },
    { address: "d", source: "cloudflare-official-v4" },
    { address: "e", source: "cloudflare-official-v4" },
  ];
  const scores = new Map([
    ["d", { rtt: 40, colo: "HKG", samples: 3 }],
    ["b", { rtt: 20, colo: "NRT", samples: 3 }],
    ["a", { rtt: null, unreachable: true }],
  ]);
  const out = selectVerifiedNodesForTest(pool, scores, { minNodes: 4 });
  assert.deepEqual(out.map((n) => n.address), ["b", "d", "c", "e"]);
  assert.equal(out[0].userRtt, 20);
  const strict = selectVerifiedNodesForTest(pool, scores, { minNodes: 0 });
  assert.deepEqual(strict.map((n) => n.address), ["b", "d", "c"]);
});

test("selectVerifiedNodes: 全部判死时回退原列表", () => {
  const pool = [{ address: "a" }];
  const scores = new Map([["a", { unreachable: true }]]);
  assert.equal(selectVerifiedNodesForTest(pool, scores, { minNodes: 0 }).length, 1);
});
