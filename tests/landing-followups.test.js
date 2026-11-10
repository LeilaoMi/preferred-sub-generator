import test from "node:test";
import assert from "node:assert/strict";
import { applyLandingToScores, parseLandingColos, workerLanding } from "../src/utils/landing.js";
import { isMeasuredOk, selectVerifiedNodes } from "../src/api/node-filter.js";
import { pickTargets, subnetKey, subnetStats } from "../scripts/china-probe.js";

const US = parseLandingColos("US");
const NOW = Date.parse("2026-11-11T00:00:00Z");
const RECENT = "2026-11-10T12:00:00.000Z";
const OLD = "2026-11-01T00:00:00.000Z";

test("workerLanding: 环境变量优先，否则读 CN_PROBE_STATE.landing", () => {
  assert.ok(workerLanding({ SUB_LANDING: "LAX" }, { landing: ["HKG"] }).has("LAX"));
  assert.ok(workerLanding({}, { landing: ["SJC", "LAX"] }).has("SJC"));
  assert.equal(workerLanding({}, {}), null);
  assert.equal(workerLanding({}, null), null);
});

test("applyLandingToScores: 白名单外判死、无机房标 unproven、白名单内不变", () => {
  const scores = new Map([
    ["1.1.1.1", { rtt: 150, colo: "LAX" }],
    ["2.2.2.2", { rtt: 60, colo: "HKG" }],
    ["3.3.3.3", { rtt: 90 }],
    ["4.4.4.4", { rtt: null, unreachable: true }],
  ]);
  const out = applyLandingToScores(scores, US);
  assert.ok(isMeasuredOk(out.get("1.1.1.1"), 1000));
  assert.equal(out.get("2.2.2.2").unreachable, true);
  assert.equal(out.get("2.2.2.2").offLanding, true);
  assert.equal(out.get("3.3.3.3").unproven, true);
  assert.equal(isMeasuredOk(out.get("3.3.3.3"), 1000), false);
  assert.equal(out.get("4.4.4.4").unreachable, true);
  assert.equal(applyLandingToScores(scores, null), scores);
});

test("selectVerifiedNodes fill=false：不拿未实测节点补位", () => {
  const nodes = [{ address: "1.1.1.1" }, { address: "5.5.5.5" }, { address: "6.6.6.6" }];
  const scores = new Map([["1.1.1.1", { rtt: 150, colo: "LAX" }]]);
  assert.deepEqual(selectVerifiedNodes(nodes, scores, { minNodes: 3, fill: false }).map((n) => n.address), ["1.1.1.1"]);
  assert.equal(selectVerifiedNodes(nodes, scores, { minNodes: 3 }).length, 3);
});

test("subnetStats 只统计 Globalping 记录，按 /24 计不同 IP", () => {
  const st = subnetStats([
    { address: "9.9.9.1", ok: false, clientHash: "globalping-https:1:a", at: RECENT },
    { address: "9.9.9.1", ok: false, clientHash: "globalping-https:2:b", at: RECENT },
    { address: "9.9.9.2", ok: true, clientHash: "globalping-https:1:a", at: RECENT },
    { address: "9.9.9.3", ok: true, clientHash: "phone:cellular:x", at: RECENT },
    { address: "9.9.9.4", ok: false, clientHash: "globalping-https:1:a", at: OLD },
  ], NOW);
  assert.deepEqual(st.get("9.9.9"), { tested: 2, ok: 1 });
  assert.equal(subnetKey("2606:4700::1"), null);
});

test("pickTargets：死网段只留探索额度，好网段没测过的 IP 优先", () => {
  const prev = [];
  for (let i = 1; i <= 3; i++) prev.push({ address: `10.0.0.${i}`, ok: false, clientHash: "globalping-https:1:a", at: RECENT });
  prev.push({ address: "20.0.0.1", ok: true, clientHash: "globalping-https:1:a", at: RECENT });
  const pool = [];
  for (let i = 1; i <= 20; i++) pool.push({ address: `10.0.0.${i}` });
  for (let i = 1; i <= 5; i++) pool.push({ address: `30.0.0.${i}` });
  pool.push({ address: "20.0.0.1" }, { address: "20.0.0.9" });
  const { targets } = pickTargets(pool, prev, 0, 10, { mode: "http", now: NOW });
  const addrs = targets.map((t) => t.address);
  assert.ok(addrs.includes("20.0.0.1"), "上次 ok 的保持新鲜");
  assert.ok(addrs.includes("20.0.0.9"), "好网段没测过的 IP 优先");
  assert.equal(addrs.filter((a) => a.startsWith("10.0.0.")).length, 1, "死网段只测 1 个");
  assert.equal(addrs.filter((a) => a.startsWith("30.0.0.")).length, 5);
});

test("pickTargets：过期记录不判死网段；全是死网段时游标照样推进", () => {
  const old = [1, 2, 3].map((i) => ({ address: `10.0.0.${i}`, ok: false, clientHash: "globalping-https:1:a", at: OLD }));
  const pool = [1, 2, 3, 4, 5].map((i) => ({ address: `10.0.0.${i}` }));
  assert.equal(pickTargets(pool, old, 0, 5, { mode: "http", now: NOW }).targets.length, 5);
  const dead = old.map((e) => ({ ...e, at: RECENT }));
  const first = pickTargets(pool, dead, 0, 10, { mode: "http", now: NOW });
  assert.equal(first.targets.length, 1);
  const second = pickTargets(pool, dead, first.nextCursor, 10, { mode: "http", now: NOW });
  assert.notEqual(second.targets[0].address, first.targets[0].address);
});
