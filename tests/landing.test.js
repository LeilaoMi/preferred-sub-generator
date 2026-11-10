import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedLanding, parseLandingColos } from "../src/utils/landing.js";
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
