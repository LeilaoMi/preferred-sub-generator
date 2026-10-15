import test from "node:test";
import assert from "node:assert/strict";
import { dedupePhoneEntries, measurementBody, phoneResultsToEntries, pickTargets, relayResultToEntry, resultToEntry } from "../scripts/china-probe.js";
import { entryWeight, summarizeIpScores } from "../src/api/ip-feedback.js";
import { getNodeConfigFromUrl } from "../src/config/nodes.js";
import { hashClientIp, hashSalt } from "../src/api/speedtest-db.js";

const NOW = Date.parse("2026-10-15T13:00:00Z");

test("relay targets are verified with HTTPS /cdn-cgi/trace instead of TCP ping", () => {
  const { targets } = pickTargets([{ address: "1.2.3.4", port: 2053, pendingCn: true }, { address: "104.16.1.1", port: 443 }], [], 0, 10);
  assert.equal(targets.find((t) => t.address === "1.2.3.4").relay, true);
  assert.equal(targets.find((t) => t.address === "104.16.1.1").relay, undefined);
  const body = measurementBody({ address: "1.2.3.4", port: 2053, relay: true }, ["x"], "node.example.com");
  assert.equal(body.type, "http");
  assert.equal(body.measurementOptions.request.host, "node.example.com");
  assert.equal(body.measurementOptions.port, 2053);
  assert.equal(measurementBody({ address: "104.16.1.1", port: 443 }, ["x"]).type, "ping");
});

test("relay result is ok only when Cloudflare trace comes back", () => {
  const probe = { asn: 4837, city: "X", network: "China Unicom" };
  const good = relayResultToEntry({ address: "1.2.3.4", port: 443, relay: true }, { probe, result: { status: "finished", statusCode: 200, rawBody: "fl=1\ncolo=HKG\n", timings: { tcp: 40 } } }, "t");
  assert.equal(good.ok, true);
  assert.equal(good.rtt, 40);
  assert.equal(good.colo, "HKG");
  const tcpOnly = resultToEntry({ address: "1.2.3.4", port: 443, relay: true }, { probe, result: { status: "finished", statusCode: 200, rawBody: "<html>nginx</html>", timings: { tcp: 30 } } }, "t");
  assert.equal(tcpOnly.ok, false);
  const probeTimeout = relayResultToEntry({ address: "1.2.3.4", port: 443, relay: true }, { probe, result: { status: "failed", rawOutput: "The measurement timed out" } }, "t");
  assert.equal(probeTimeout, null);
});

test("rtt<=0 successes are ignored when ranking", () => {
  const scores = summarizeIpScores([
    { at: "2026-10-15T12:00:00Z", address: "1.1.1.1", rtt: 0, region: "CN-CU" },
    { at: "2026-10-15T12:00:00Z", address: "2.2.2.2", rtt: 80, region: "CN-CU", ok: true },
  ], { now: NOW });
  assert.equal(scores.has("1.1.1.1"), false);
  assert.equal(scores.has("2.2.2.2"), true);
});

test("phone results: VPN runs are dropped, carrier and time are normalized", () => {
  const data = { carrier: "CU", network_type: "wifi", egress_hash: "abc", egress_cn: true, ips: [
    { ip: "104.17.1.1", latency_ms: 55.2, colo: "HKG", measured_at: "2026-10-15T20:30:00+0800" },
    { ip: "104.17.1.2", latency_ms: 0, measured_at: "2026-10-15T20:30:00+0800" },
    { ip: "104.17.1.3", latency_ms: 60, carrier: "CN", measured_at: "2026-10-15T20:30:00+0800" },
  ] };
  const entries = phoneResultsToEntries(data, NOW);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].at, "2026-10-15T12:30:00.000Z");
  assert.equal(entries[0].region, "CN-CU");
  assert.equal(entries[0].clientHash, "phone:wifi:abc");
  assert.deepEqual(phoneResultsToEntries({ ...data, egress_cn: false }, NOW), []);
  assert.equal(dedupePhoneEntries(entries, entries).length, 0);
});

test("phone samples are weighted by network type", () => {
  const at = new Date(NOW).toISOString();
  const base = entryWeight({ at, clientHash: "globalping:4837:x" }, { now: NOW, peakWeight: 1 });
  assert.equal(entryWeight({ at, clientHash: "phone:wifi:a" }, { now: NOW, peakWeight: 1 }), base * 1.5);
  assert.equal(entryWeight({ at, clientHash: "phone:cellular:a" }, { now: NOW, peakWeight: 1 }), base * 1.2);
});

test("transport goes in net=, old type=grpc links still parse", () => {
  assert.equal(getNodeConfigFromUrl(new URL("https://x/sub?uuid=u&net=grpc&type=clash")).type, "grpc");
  assert.equal(getNodeConfigFromUrl(new URL("https://x/sub?uuid=u&type=grpc")).type, "grpc");
  assert.equal(getNodeConfigFromUrl(new URL("https://x/sub?uuid=u&type=clash")).type, "ws");
});

test("client IP hash is salted", async () => {
  assert.notEqual(await hashClientIp("203.0.113.9", "s1"), await hashClientIp("203.0.113.9", "s2"));
  assert.equal(hashSalt({ SUB_TOKEN: "t" }), "t");
  assert.equal(hashSalt({ IP_HASH_SALT: "a", SUB_TOKEN: "t" }), "a");
});
