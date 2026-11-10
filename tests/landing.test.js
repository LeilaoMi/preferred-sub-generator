import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedLanding, parseLandingColos, resolveLanding } from "../src/utils/landing.js";
import { dropUnprovenLanding, measurementBody, pickTargets, probeMode, resultToEntry } from "../scripts/china-probe.js";
import { parseScrape } from "../scripts/lib/candidates.js";

const trace = (colo) => `fl=1\nh=x\nip=1.1.1.1\nts=1\nvisit_scheme=https\nuag=x\ncolo=${colo}\nsliver=none\nhttp=http/1.1\nloc=CN\ntls=TLSv1.3\nsni=plaintext\nwarp=off\ngateway=off\nrbi=off\nkex=X25519\n`;
const http = (colo, isp = "China Unicom") => ({ probe: { network: isp }, result: { status: "finished", statusCode: 200, rawBody: trace(colo), timings: { total: 300, tcp: 180 } } });

test("parseLandingColos 支持别名和三字码", () => {
  const us = parseLandingColos("US");
  assert.ok(us.has("LAX") && us.has("SJC") && !us.has("HKG"));
  const mix = parseLandingColos("lax, hkg");
  assert.deepEqual([...mix].sort(), ["HKG", "LAX"]);
  assert.equal(parseLandingColos(""), null);
  assert.equal(isAllowedLanding("", us), false);
  assert.equal(isAllowedLanding("", null), true);
});

test("默认 http 模式：官方 IP 也走 HTTPS trace", () => {
  assert.equal(probeMode({}), "http");
  assert.equal(probeMode({ CN_PROBE_MODE: "ping" }), "ping");
  const { targets } = pickTargets([{ address: "104.16.1.1", port: 443 }], [], 0, 5, { mode: "http" });
  assert.equal(targets[0].https, true);
  const body = measurementBody(targets[0], [], "a.example.com");
  assert.equal(body.type, "http");
  assert.equal(body.measurementOptions.request.host, "a.example.com");
  const ping = pickTargets([{ address: "104.16.1.1", port: 443 }], [], 0, 5).targets[0];
  assert.equal(measurementBody(ping, []).type, "ping");
});

test("落地白名单：HKG 判不可用，LAX 可用", () => {
  const landing = parseLandingColos("US");
  const t = { address: "104.16.1.1", port: 443, https: true };
  const lax = resultToEntry(t, http("LAX"), "x", { landing });
  assert.equal(lax.ok, true);
  assert.equal(lax.colo, "LAX");
  assert.equal(lax.region, "CN-CU");
  const hkg = resultToEntry(t, http("HKG"), "x", { landing });
  assert.equal(hkg.ok, false);
  assert.equal(hkg.offLanding, true);
  assert.equal(resultToEntry(t, http("HKG"), "x").ok, true);
});

test("dropUnprovenLanding 清掉没有机房的老 ping 记录", () => {
  const landing = parseLandingColos("US");
  const entries = [
    { clientHash: "globalping:4837:x", ok: true, colo: "" },
    { clientHash: "globalping-https:4837:x", ok: true, colo: "LAX" },
    { clientHash: "phone:cellular:abc", ok: true, colo: "HKG" },
    { clientHash: "phone:cellular:abc", ok: true, colo: "SJC" },
  ];
  assert.equal(dropUnprovenLanding(entries, landing).length, 2);
  assert.equal(dropUnprovenLanding(entries, null).length, 4);
});

test("parseScrape 从网页/JSON 抠 IPv4", () => {
  const html = "<td>104.16.1.1</td><td>LAX</td><td>104.16.1.1</td>";
  const json = '{"data":{"CU":[{"ip":"172.64.1.2"}]}}';
  assert.deepEqual(parseScrape(html, "w").map((c) => c.address), ["104.16.1.1"]);
  assert.deepEqual(parseScrape(json, "v").map((c) => c.address), ["172.64.1.2"]);
});

test("落地白名单变化时丢弃旧快照", async () => {
  const { refreshSnapshot, landingKey } = await import("../scripts/china-probe.js");
  const old = { updatedAt: "2026-11-01T00:00:00.000Z", landing: "", all: [], CT: [], CU: Array.from({ length: 30 }, (_, i) => ({ address: `104.16.0.${i}`, rtt: 180 })), CM: [] };
  let written = null;
  const fetchImpl = async (url, init) => {
    if (init?.method === "PUT") { written = JSON.parse(init.body); return new Response("{}"); }
    return new Response(JSON.stringify(old));
  };
  const landing = parseLandingColos("US");
  const now = Date.parse("2026-11-11T00:00:00Z");
  const entries = [{ at: "2026-11-10T23:00:00.000Z", address: "104.17.1.1", port: 443, colo: "LAX", region: "CN-CU", rtt: 170, clientHash: "globalping-https:4837:x", ok: true }];
  const snap = await refreshSnapshot({ kv: { accountId: "a", namespaceId: "n", apiToken: "t" }, fetchImpl, entries, pool: [], now, landing });
  assert.equal(snap.landing, landingKey(landing));
  assert.ok(!snap.CU.some((item) => item.address.startsWith("104.16.0.")));
  assert.ok(written);
});

test("resolveLanding: ping 模式下两个入口都忽略 SUB_LANDING", () => {
  assert.equal(resolveLanding({ CN_PROBE_MODE: "ping", SUB_LANDING: "US" }), null);
  assert.equal(resolveLanding({ CN_PROBE_MODE: " PING ", SUB_LANDING: "LAX" }), null);
  assert.ok(resolveLanding({ SUB_LANDING: "LAX" }).has("LAX"));
  assert.ok(resolveLanding({ CN_PROBE_MODE: "http", SUB_LANDING: "LAX" }).has("LAX"));
  assert.equal(resolveLanding({}), parseLandingColos(undefined));
});
