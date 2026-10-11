import test from "node:test";
import assert from "node:assert/strict";
import { computeNodeScore, filterNodesByColo, preferredPort, rankNodesByScore, readScoreOptions, sampleNodes, sampleWeight, withPreferredPort } from "../src/api/node-filter.js";
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

test("sampleWeight rewards lower local rtt and higher speed", () => {
  const fast = sampleWeight(nodes[0], { rtt: 20, speed: 50, unreachable: false });
  const slow = sampleWeight(nodes[0], { rtt: 400, speed: 1, unreachable: false });
  const none = sampleWeight(nodes[0], null);

  assert.equal(none, 1);
  assert.ok(fast > slow);
  assert.ok(slow >= 1);
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

test("rankNodesByScore still puts measured nodes first (legacy path unchanged)", () => {
  const scores = new Map([["3.3.3.3", { rtt: 9, speed: 10, colo: "HKG", samples: 2, failed: 0, unreachable: false }]]);
  const ranked = rankNodesByScore(nodes, scores);

  assert.equal(ranked[0].address, "3.3.3.3");
  assert.equal(ranked[0].userRtt, 9);
});

test("P1-9 rankNodesByScore drops nodes above the rtt threshold", () => {
  const scores = new Map([
    ["1.1.1.1", { rtt: 50, unreachable: false }],
    ["2.2.2.2", { rtt: 5000, unreachable: false }],
  ]);
  const ranked = rankNodesByScore(nodes, scores);
  assert.deepEqual(ranked.map((node) => node.address), ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]);

  const ranked2 = rankNodesByScore(nodes, scores, { rttDropMs: 10000 });
  assert.equal(ranked2[0].address, "1.1.1.1");
  assert.equal(ranked2[1].address, "2.2.2.2");
});

test("P2-11 computeNodeScore penalizes jitter and rewards speed", () => {
  const base = { rtt: 50, speed: 10, colo: "HKG", unreachable: false };
  const calm = computeNodeScore({ address: "a", jitter: 5 }, base);
  const jitty = computeNodeScore({ address: "b", jitter: 400 }, base);
  assert.ok(calm > jitty);

  const fast = computeNodeScore({}, { rtt: 50, speed: 90, unreachable: false });
  const slow = computeNodeScore({}, { rtt: 50, speed: 5, unreachable: false });
  assert.ok(fast > slow);
});

test("P2-11 readScoreOptions reads SUB_SCORE_W_* env overrides", () => {
  const opts = readScoreOptions({ SUB_SCORE_W_SPEED: "2.5", SUB_RTT_DROP_MS: "2000", SUB_SCORE_W_RTT: "bogus" });
  assert.equal(opts.wS, 2.5);
  assert.equal(opts.rttDropMs, 2000);
  assert.equal(opts.wR, 2.0);
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
