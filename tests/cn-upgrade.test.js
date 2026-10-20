import test from "node:test";
import assert from "node:assert/strict";
import { entryWeight, filterEntriesByIsp, isPeakHour, stableRank, summarizeIpScores } from "../src/api/ip-feedback.js";
import { applySnapshotFallback, buildVerifiedSnapshot, mergeSnapshot, snapshotList } from "../src/api/cn-verified.js";
import { applyHostRotation, healthyHosts, judgeHistory, mergeHostHealth, resolveCheckHosts, summarizeHostHealth } from "../src/api/host-health.js";
import { handleCnVerified } from "../src/api/cn-verified-endpoint.js";
import { handleSub } from "../src/api/sub.js";
import { handleStatus } from "../src/api/status.js";
import { hostAlertDecision, httpResultToCheck, parseTrace, pickComboTargets, runHostCheck } from "../scripts/china-host-check.js";
import { fetchCommunityPool } from "../scripts/china-probe.js";
import { formatAlertText, notifyTargets, sendNotification } from "../scripts/lib/notify.js";

const NOW = Date.parse("2026-10-13T04:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

test("晚高峰判定按北京时间 20-23 点", () => {
  assert.equal(isPeakHour("2026-10-12T12:30:00Z"), true); // 20:30 北京
  assert.equal(isPeakHour("2026-10-12T15:10:00Z"), false); // 23:10 北京
  assert.equal(isPeakHour("2026-10-12T04:00:00Z"), false);
});

test("实测权重：24 小时半衰期 + 晚高峰 1.5 倍", () => {
  assert.equal(entryWeight({ at: hoursAgo(0) }, { now: NOW }), 1);
  assert.ok(Math.abs(entryWeight({ at: hoursAgo(24) }, { now: NOW }) - 0.5) < 1e-9);
  assert.equal(entryWeight({ at: "2026-10-13T04:00:00Z" }, {}), 1);
  assert.equal(entryWeight({ at: "2026-10-12T13:00:00Z" }, {}), 1.5);
});

test("旧失败被新成功盖过：衰减后不再判死", () => {
  const entries = [
    { at: hoursAgo(60), address: "1.1.1.1", ok: false },
    { at: hoursAgo(60), address: "1.1.1.1", ok: false },
    { at: hoursAgo(1), address: "1.1.1.1", rtt: 120, ok: true },
  ];
  assert.equal(summarizeIpScores(entries).get("1.1.1.1").unreachable, true);
  assert.equal(summarizeIpScores(entries, { now: NOW }).get("1.1.1.1").unreachable, false);
});

test("稳定排序分：20ms 分桶、远端机房加罚、失败率加罚", () => {
  assert.equal(stableRank({ rtt: 101 }), stableRank({ rtt: 109 }));
  assert.ok(stableRank({ rtt: 100, colo: "AMS" }) > stableRank({ rtt: 160, colo: "HKG" }));
  assert.ok(stableRank({ rtt: 100, successRate: 0.5 }) > stableRank({ rtt: 100, successRate: 1 }));
  assert.equal(stableRank({ rtt: null }), Infinity);
});

test("分运营商过滤：只留对应探针，手机数据保留", () => {
  const entries = [
    { address: "a", region: "CN-CT" },
    { address: "b", region: "CN-CU" },
    { address: "c", region: "CN" },
    { address: "d", region: "" },
  ];
  assert.deepEqual(filterEntriesByIsp(entries, "cu").map((e) => e.address), ["b", "c", "d"]);
  assert.equal(filterEntriesByIsp(entries, "xx").length, 4);
});

test("快照：按运营商分别排名，够用才覆盖", () => {
  const at = hoursAgo(1);
  const entries = [
    { at, address: "1.0.0.1", rtt: 90, ok: true, region: "CN-CU" },
    { at, address: "1.0.0.2", rtt: 200, ok: true, region: "CN-CT" },
    { at, address: "1.0.0.3", rtt: null, ok: false, region: "CN-CM" },
  ];
  const snap = buildVerifiedSnapshot(entries, [{ address: "1.0.0.2", port: 2053 }], { now: NOW });
  assert.deepEqual(snap.all.map((i) => i.address), ["1.0.0.1", "1.0.0.2"]);
  assert.deepEqual(snap.CU.map((i) => i.address), ["1.0.0.1"]);
  assert.equal(snap.CT[0].port, 2053);
  assert.equal(snap.CM.length, 0);
  const previous = { all: Array.from({ length: 12 }, (_, i) => ({ address: `9.9.9.${i}`, rtt: 100 })), CT: [], CU: [], CM: [{ address: "8.8.8.8", rtt: 50 }] };
  const merged = mergeSnapshot(previous, snap);
  assert.equal(merged.all.length, 12, "新快照太少时保留旧的");
  assert.equal(merged.CU.length, 1, "旧的更少时用新的");
  assert.equal(merged.CM[0].address, "8.8.8.8");
  assert.deepEqual(snapshotList(merged, "CU", { now: NOW }).map((i) => i.address), ["1.0.0.1"]);
});

test("快照兜底：补进评分表和节点池，不覆盖已有实测", () => {
  const scores = new Map([["2.2.2.2", { rtt: 80, unreachable: false }]]);
  const { nodes, scores: out } = applySnapshotFallback([{ address: "2.2.2.2" }], scores, [
    { address: "2.2.2.2", rtt: 300 },
    { address: "3.3.3.3", rtt: 120, port: 8443, rank: 120 },
  ]);
  assert.equal(out.get("2.2.2.2").rtt, 80);
  assert.equal(out.get("3.3.3.3").stale, true);
  assert.equal(out.get("3.3.3.3").rank, 170);
  assert.deepEqual(nodes.map((n) => n.address), ["2.2.2.2", "3.3.3.3"]);
  assert.equal(nodes[1].port, 8443);
});

function subEnv(data, extra = {}) {
  return {
    SUB_TOKEN: "t", SUB_READ_TOKEN: "r", SUB_PUBLIC: "1",
    VLESS_UUID: "11111111-1111-4111-8111-111111111111", VLESS_SNI: "1.my.cc", VLESS_HOST: "1.my.cc",
    VLESS_PATH: "/ws", VLESS_PORT: "443", VLESS_TYPE: "ws", VLESS_SECURITY: "tls",
    SUB_KV: { async get(key) { return data.get(key) || null; }, async put(key, value) { data.set(key, value); } },
    ...extra,
  };
}

const edgeReq = (q = "") => new Request(`https://example.com/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000${q}`, { headers: { "User-Agent": "edgetunnel/2.3.1" } });
const decode = async (res) => Buffer.from(await res.text(), "base64").toString("utf8").split("\n").filter(Boolean);

test("?isp=cu 分运营商订阅：只按联通实测排序", async () => {
  const at = new Date().toISOString();
  const data = new Map([
    ["BEST_IPS", JSON.stringify([{ address: "10.0.0.1", port: 443 }, { address: "10.0.0.2", port: 443 }])],
    ["CN_PROBE_FEEDBACK", JSON.stringify([
      { at, address: "10.0.0.1", rtt: 60, ok: true, region: "CN-CT" },
      { at, address: "10.0.0.1", ok: false, region: "CN-CU" },
      { at, address: "10.0.0.2", rtt: 150, ok: true, region: "CN-CU" },
      { at, address: "10.0.0.2", rtt: 400, ok: true, region: "CN-CT" },
    ])],
  ]);
  const ct = await decode(await handleSub(edgeReq("&isp=ct"), subEnv(data, { SUB_MIN_NODES: "0" })));
  assert.match(ct[0], /@10\.0\.0\.1:/);
  const cu = await decode(await handleSub(edgeReq("&isp=cu"), subEnv(data, { SUB_MIN_NODES: "0" })));
  assert.match(cu[0], /@10\.0\.0\.2:/);
  assert.ok(!cu.join("\n").includes("10.0.0.1"), "联通判死的不进联通订阅");
});

test("实测过期时用国内快照兜底，不退回美国池顺序", async () => {
  const data = new Map([
    ["BEST_IPS", JSON.stringify([{ address: "10.0.0.9", port: 443 }])],
    ["CN_VERIFIED", JSON.stringify({ updatedAt: "x", all: [{ address: "150.1.1.1", port: 443, rtt: 100, rank: 100 }], CT: [], CU: [{ address: "150.2.2.2", port: 443, rtt: 90, rank: 80 }], CM: [] })],
  ]);
  const lines = await decode(await handleSub(edgeReq(), subEnv(data)));
  assert.match(lines[0], /@150\.1\.1\.1:/);
  const cu = await decode(await handleSub(edgeReq("&isp=cu"), subEnv(data)));
  assert.match(cu[0], /@150\.2\.2\.2:/);
});

test("社区实测池排在自己的快照之后", async () => {
  const data = new Map([
    ["BEST_IPS", JSON.stringify([])],
    ["CN_VERIFIED", JSON.stringify({ all: [{ address: "150.1.1.1", rtt: 150, rank: 160 }] })],
    ["CN_COMMUNITY", JSON.stringify({ all: [{ address: "160.1.1.1", rtt: 50, rank: 40 }] })],
  ]);
  const lines = await decode(await handleSub(edgeReq(), subEnv(data)));
  assert.match(lines[0], /@150\.1\.1\.1:/);
  assert.match(lines[1], /@160\.1\.1\.1:/);
});

test("域名体检：判定、合并、按运营商挑可用域名", () => {
  assert.equal(judgeHistory([{ ok: false }, { ok: false }]).state, "blocked");
  assert.equal(judgeHistory([{ ok: true }, { ok: false }, { ok: true }]).state, "unstable");
  assert.equal(judgeHistory([{ ok: true, colo: "HKG" }]).state, "ok");
  assert.equal(judgeHistory([]).state, "unknown");
  let health = null;
  for (let i = 0; i < 3; i += 1) {
    health = mergeHostHealth(health, [
      { host: "1.my.cc", isp: "CM", ok: false, error: "reset" },
      { host: "1.my.cc", isp: "CU", ok: true, colo: "EWR", ms: 900 },
      { host: "2.other.org", isp: "CM", ok: true },
    ], `t${i}`, { rotate: true, hosts: ["1.my.cc", "2.other.org"] });
  }
  const summary = summarizeHostHealth(health);
  assert.deepEqual(summary.find((s) => s.host === "1.my.cc").blockedIsps, ["CM"]);
  assert.deepEqual(healthyHosts(health, "cm", ["1.my.cc", "2.other.org", "3.new.cc"]), ["2.other.org", "3.new.cc"]);
  assert.deepEqual(healthyHosts(health, "cu", ["1.my.cc"]), ["1.my.cc"]);
  const rotated = applyHostRotation([{ address: "a" }, { address: "b" }], { host: "1.my.cc" }, health, { isp: "cm" });
  assert.deepEqual(rotated.map((n) => n.sni), ["2.other.org", "2.other.org"]);
  const untouched = applyHostRotation([{ address: "a" }], { host: "elsewhere.com" }, health, { isp: "cm" });
  assert.equal(untouched[0].host, undefined);
});

test("测哪些域名：CHECK_HOSTS > VLESS_HOST > Pages 自己的域名", () => {
  assert.deepEqual(resolveCheckHosts({ CHECK_HOSTS: "https://1.a.cc/, 2.a.cc 2.a.cc", VLESS_HOST: "x.com" }), ["1.a.cc", "2.a.cc"]);
  assert.deepEqual(resolveCheckHosts({ VLESS_HOST: "speed.cloudflare.com", VLESS_SNI: "y.com" }), ["y.com"]);
  assert.deepEqual(resolveCheckHosts({ PAGES_PROJECT: "preferred-sub-generator" }), ["preferred-sub-generator.pages.dev"]);
  assert.deepEqual(resolveCheckHosts({}), []);
});

test("HTTPS 探针结果解析：重置 / 1034 / 正常", () => {
  const body = "fl=1\nh=1.my.cc\ncolo=HKG\nloc=CN\n";
  assert.deepEqual(parseTrace(body), { colo: "HKG", host: "1.my.cc", isTrace: true });
  const reset = httpResultToCheck({ probe: { network: "China Mobile" }, result: { status: "failed", rawOutput: "read ECONNRESET" } });
  assert.equal(reset.ok, false);
  assert.equal(reset.error, "reset");
  assert.equal(reset.isp, "CM");
  const blocked = httpResultToCheck({ probe: { network: "Chinanet" }, result: { status: "finished", statusCode: 403, rawBody: "error code: 1034\n" } });
  assert.equal(blocked.error, "1034");
  const ok = httpResultToCheck({ probe: { network: "China Unicom" }, result: { status: "finished", statusCode: 200, rawBody: body, timings: { total: 600, tcp: 140 } } });
  assert.deepEqual([ok.ok, ok.colo, ok.tcp, ok.isp], [true, "HKG", 140, "CU"]);
});

test("组合测目标：综合和三网轮流取，去重", () => {
  const snap = { all: [{ address: "a" }, { address: "b" }], CT: [{ address: "a" }], CU: [{ address: "c" }], CM: [] };
  assert.deepEqual(pickComboTargets(snap, 3).map((t) => t.address), ["a", "c", "b"]);
  assert.deepEqual(pickComboTargets(null, 3), []);
});

test("体检告警：变化才推，同样问题 24 小时重复一次，恢复也推", () => {
  const summary = [{ host: "1.my.cc", blockedIsps: ["CM"] }];
  const snapshot = { CT: new Array(12), CU: new Array(12), CM: new Array(3) };
  const first = hostAlertDecision({ summary, snapshot, previous: null, now: NOW });
  assert.equal(first.notify, true);
  assert.match(first.text, /1\.my\.cc（移动）/);
  assert.match(first.text, /移动 3/);
  const same = hostAlertDecision({ summary, snapshot, previous: { signature: first.signature, hasProblem: true, lastSentAt: hoursAgo(2) }, now: NOW });
  assert.equal(same.notify, false);
  const repeat = hostAlertDecision({ summary, snapshot, previous: { signature: first.signature, hasProblem: true, lastSentAt: hoursAgo(25) }, now: NOW });
  assert.equal(repeat.notify, true);
  const healthy = { CT: new Array(12), CU: new Array(12), CM: new Array(12) };
  const recovered = hostAlertDecision({ summary: [], snapshot: healthy, previous: { signature: first.signature, hasProblem: true }, now: NOW });
  assert.equal(recovered.notify, true);
  assert.match(recovered.text, /已恢复/);
  const quiet = hostAlertDecision({ summary: [], snapshot: healthy, previous: null, now: NOW });
  assert.equal(quiet.notify, false);
});

test("告警推送：Telegram / Bark / Webhook 配了哪个推哪个", async () => {
  assert.deepEqual(notifyTargets({}), []);
  assert.deepEqual(notifyTargets({ TG_BOT_TOKEN: "x", TG_CHAT_ID: "1", BARK_URL: "https://api.day.app/k" }), ["telegram", "bark"]);
  assert.match(formatAlertText({ level: "warn", reasons: ["low-available"], available: 3 }), /可用节点: 3/);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  const ok = await sendNotification({ text: "hi" }, { env: { TG_BOT_TOKEN: "abc", TG_CHAT_ID: "42", BARK_URL: "https://api.day.app/k/" }, fetchImpl });
  assert.equal(ok, true);
  assert.equal(calls[0].url, "https://api.telegram.org/botabc/sendMessage");
  assert.equal(calls[0].body.chat_id, "42");
  assert.equal(calls[1].url, "https://api.day.app/k");
  assert.equal(calls[1].body.body, "hi");
  assert.equal(await sendNotification({ text: "x" }, { env: {}, fetchImpl }), false);
});

test("/cn-verified 默认关闭；打开后只输出 IP 数据", async () => {
  const data = new Map([["CN_VERIFIED", JSON.stringify({ updatedAt: "t", all: [{ address: "1.2.3.4", port: 443, rtt: 99, colo: "HKG", successRate: 1, rank: 100, secret: "x" }], CT: [], CU: [], CM: [] })]]);
  const env = { SUB_KV: { async get(k) { return data.get(k) || null; } } };
  assert.equal((await handleCnVerified(new Request("https://x/cn-verified"), env)).status, 404);
  data.set("CN_PROBE_STATE", JSON.stringify({ publicVerified: true }));
  const res = await handleCnVerified(new Request("https://x/cn-verified"), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.all[0], { address: "1.2.3.4", port: 443, rtt: 99, colo: "HKG", successRate: 1 });
});

test("拉取社区实测池：过滤非法条目，失败返回 null", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ updatedAt: "t", all: [{ address: "1.2.3.4", rtt: 80 }, { address: "evil.com", rtt: 1 }, { address: "5.6.7.8" }], CU: [{ address: "1.2.3.4", rtt: 70, port: 8443 }] }) });
  const pool = await fetchCommunityPool("https://x/cn-verified", { fetchImpl });
  assert.deepEqual(pool.all.map((i) => i.address), ["1.2.3.4"]);
  assert.equal(pool.CU[0].port, 8443);
  assert.equal(await fetchCommunityPool("", { fetchImpl }), null);
  assert.equal(await fetchCommunityPool("https://x", { fetchImpl: async () => { throw new Error("down"); } }), null);
});

test("/status 带出国内域名体检", async () => {
  const health = mergeHostHealth(null, [{ host: "1.my.cc", isp: "CM", ok: false }, { host: "1.my.cc", isp: "CM", ok: false }].slice(0, 1), "t1", { rotate: false, hosts: ["1.my.cc"] });
  const twice = mergeHostHealth(health, [{ host: "1.my.cc", isp: "CM", ok: false }], "t2");
  const data = new Map([["CN_HOST_HEALTH", JSON.stringify(twice)], ["STATUS", JSON.stringify({ updatedAt: new Date().toISOString(), available: 1 })]]);
  const res = await handleStatus(new Request("https://x/status"), { SUB_KV: { async get(k) { return data.get(k) || null; } } });
  const body = await res.json();
  assert.equal(body.cnHosts.hosts[0].CM, "blocked");
  assert.deepEqual(body.cnHosts.hosts[0].blockedIsps, ["CM"]);
});

test("runHostCheck 端到端：体检 + 只在没被墙的运营商上做组合测", async () => {
  const kvData = new Map([
    ["CN_VERIFIED", JSON.stringify({ all: [{ address: "9.9.9.9", port: 443, rtt: 100 }], CT: [], CU: [], CM: [] })],
  ]);
  const created = [];
  const measurements = new Map();
  const trace = "fl=1\nh=1.my.cc\ncolo=HKG\n";
  const fetchImpl = async (url, init = {}) => {
    if (url.startsWith("https://api.cloudflare.com")) {
      const key = decodeURIComponent(url.split("/values/")[1]);
      if (init.method === "PUT") { kvData.set(key, init.body); return { ok: true, status: 200 }; }
      return kvData.has(key) ? { ok: true, status: 200, text: async () => kvData.get(key) } : { ok: false, status: 404 };
    }
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      const id = `m${created.length}`;
      created.push(body);
      const results = body.locations.map((loc) => {
        const network = { 4134: "Chinanet", 4837: "China Unicom", 9808: "China Mobile" }[loc.asn];
        if (network === "China Mobile") return { probe: { network, asn: loc.asn }, result: { status: "failed", rawOutput: "read ECONNRESET" } };
        return { probe: { network, asn: loc.asn }, result: { status: "finished", statusCode: 200, rawBody: trace, timings: { total: 500, tcp: 120 } } };
      });
      measurements.set(id, { status: "finished", results });
      return { ok: true, status: 202, json: async () => ({ id }) };
    }
    const id = url.split("/").pop();
    return { ok: true, status: 200, json: async () => measurements.get(id) };
  };
  const kv = { accountId: "a", namespaceId: "n", apiToken: "t" };
  let result;
  for (let i = 0; i < 2; i += 1) {
    result = await runHostCheck({ kv, env: { CHECK_HOSTS: "1.my.cc" }, fetchImpl, now: new Date(NOW + i * 1000), comboTop: 5, pollMs: 1 });
  }
  assert.deepEqual(result.blocked, ["1.my.cc:CM"]);
  const combos = created.filter((c) => c.target === "9.9.9.9");
  assert.ok(combos.length > 0);
  assert.equal(combos[combos.length - 1].measurementOptions.request.host, "1.my.cc");
  assert.ok(!combos[combos.length - 1].locations.some((l) => l.asn === 9808), "移动下域名被墙，不能拿它做组合测");
  const feedback = JSON.parse(kvData.get("CN_PROBE_FEEDBACK"));
  assert.ok(feedback.every((e) => e.colo === "HKG" && e.ok && e.rtt === 120));
});

test("默认运营商：edgetunnel 带不了 ?isp=，用 CN_PROBE_STATE.defaultIsp；?isp=all 可覆盖", async () => {
  const at = new Date().toISOString();
  const data = new Map([
    ["BEST_IPS", JSON.stringify([{ address: "10.0.0.1", port: 443 }, { address: "10.0.0.2", port: 443 }])],
    ["CN_PROBE_STATE", JSON.stringify({ defaultIsp: "CU" })],
    ["CN_PROBE_FEEDBACK", JSON.stringify([
      { at, address: "10.0.0.1", rtt: 60, ok: true, region: "CN-CT" },
      { at, address: "10.0.0.2", rtt: 150, ok: true, region: "CN-CU" },
    ])],
  ]);
  const def = await decode(await handleSub(edgeReq(), subEnv(data, { SUB_MIN_NODES: "0" })));
  assert.match(def[0], /@10\.0\.0\.2:/);
  const all = await decode(await handleSub(edgeReq("&isp=all"), subEnv(data, { SUB_MIN_NODES: "0" })));
  assert.match(all[0], /@10\.0\.0\.1:/);
});

test("探针自身超时不计入；pages.dev 兜底时不做组合测", async () => {
  const t = httpResultToCheck({ probe: { network: "Chinanet" }, result: { status: "failed", rawOutput: "The measurement timed out." } });
  assert.equal(t.ignore, true);
  const tls = httpResultToCheck({ probe: { network: "Chinanet" }, result: { status: "failed", rawOutput: "Request timed out during the TLS handshake." } });
  assert.equal(tls.error, "timeout");
  const kvData = new Map([["CN_VERIFIED", JSON.stringify({ all: [{ address: "9.9.9.9", rtt: 100 }] })]]);
  const posted = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.startsWith("https://api.cloudflare.com")) {
      const key = decodeURIComponent(url.split("/values/")[1]);
      if (init.method === "PUT") { kvData.set(key, init.body); return { ok: true }; }
      return kvData.has(key) ? { ok: true, status: 200, text: async () => kvData.get(key) } : { ok: false, status: 404 };
    }
    if (init.method === "POST") { posted.push(JSON.parse(init.body)); return { ok: true, status: 202, json: async () => ({ id: "x" }) }; }
    return { ok: true, json: async () => ({ status: "finished", results: [{ probe: { network: "Chinanet" }, result: { status: "finished", statusCode: 200, rawBody: "fl=1\ncolo=HKG\n", timings: { tcp: 50 } } }] }) };
  };
  await runHostCheck({ kv: { accountId: "a", namespaceId: "n", apiToken: "t" }, env: { PAGES_PROJECT: "p" }, fetchImpl, comboTop: 5, pollMs: 1 });
  assert.deepEqual(posted.map((p) => p.target), ["p.pages.dev"]);
});

test("实例配置只对同名仓库生效，复刻不继承", async () => {
  const { resolveInstanceConfig } = await import("../scripts/lib/instance-config.js");
  const config = { "a/b": { CHECK_HOSTS: "x.com", SECRET: "no", SUB_DEFAULT_ISP: "CU" } };
  assert.deepEqual(resolveInstanceConfig(config, "a/b"), { CHECK_HOSTS: "x.com", SUB_DEFAULT_ISP: "CU" });
  assert.deepEqual(resolveInstanceConfig(config, "fork/b"), {});
  assert.deepEqual(resolveInstanceConfig(config, undefined), {});
});

test("TLS 订阅去掉 :80 等非 TLS 端口节点", async () => {
  const { dropTlsPortMismatch } = await import("../src/api/sub.js");
  const nodes = [{ address: "1.1.1.1", port: 80 }, { address: "1.0.0.1", port: 443 }, { address: "1.0.0.2", port: 8880 }];
  assert.deepEqual(dropTlsPortMismatch(nodes, { security: "tls" }).map((n) => n.address), ["1.0.0.1"]);
  assert.equal(dropTlsPortMismatch(nodes, { security: "none" }).length, 3);
});

test("旧实测按年龄加罚：只有一条旧记录的 IP 不再长期霸榜", async () => {
  const { summarizeIpScores, agePenalty } = await import("../src/api/ip-feedback.js");
  const now = Date.parse("2026-10-15T12:00:00Z");
  const entries = [
    { address: "1.1.1.1", at: "2026-10-13T12:00:00Z", rtt: 150, ok: true },
    { address: "2.2.2.2", at: "2026-10-15T11:00:00Z", rtt: 160, ok: true },
  ];
  const scores = summarizeIpScores(entries, { now });
  assert.ok(scores.get("1.1.1.1").rank > scores.get("2.2.2.2").rank);
  assert.equal(agePenalty(48), 40);
  assert.equal(agePenalty(1000), 60);
});

test("快照每份名单记录真实生成时间，过期名单不再兜底", async () => {
  const { mergeSnapshot, snapshotList } = await import("../src/api/cn-verified.js");
  const item = { address: "1.1.1.1", port: 443, rtt: 100 };
  const old = mergeSnapshot(null, { updatedAt: "2026-10-01T00:00:00Z", all: Array(12).fill(item), CT: [item], CU: [], CM: [] });
  const merged = mergeSnapshot(old, { updatedAt: "2026-10-15T00:00:00Z", all: [], CT: [], CU: [], CM: [] });
  assert.equal(merged.allAt, "2026-10-01T00:00:00Z");
  const now = Date.parse("2026-10-15T00:00:00Z");
  assert.equal(snapshotList(merged, null, { now }).length, 0);
  assert.equal(snapshotList(merged, null, { now, maxAgeMs: 0 }).length, 12);
});
