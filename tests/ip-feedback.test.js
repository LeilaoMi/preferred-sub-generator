import test from "node:test";
import assert from "node:assert/strict";
import { handleBest } from "../src/api/best.js";
import { handleIpFeedbackGet, handleIpFeedbackPost, loadIpScores, summarizeIpScores } from "../src/api/ip-feedback.js";
import { handleSub } from "../src/api/sub.js";
import { filterNodesByColo, parseColoFilter, rankNodesByScore } from "../src/api/node-filter.js";

const template = "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点";
const bestIps = [
  { address: "1.1.1.1", port: 443, name: undefined, colo: "LAX", latency: 12 },
  { address: "1.1.1.2", port: 8443, name: undefined, colo: "SJC", latency: 34 },
  { address: "1.1.1.3", port: 443, name: "优选-3", colo: "HKG", latency: 180 },
];

const RECENT_AT = new Date(Date.now() - 60 * 1000).toISOString();

function createEnv(extra = {}) {
  const data = new Map([
    ["TEMPLATE", template],
    ["BEST_IPS", JSON.stringify(bestIps)],
  ]);

  return {
    SUB_TOKEN: "secret-token",
    SUB_READ_TOKEN: "read-token",
    SUB_KV: {
      async get(key) { return data.get(key) || null; },
      async put(key, value) { data.set(key, value); },
    },
    ...extra,
  };
}

function createMockD1(initial = []) {
  const rows = [...initial];
  return {
    rows,
    prepare() {
      return {
        run: async () => ({ success: true }),
        bind: (...args) => ({
          run: async () => {
            rows.push({
              created_at: args[0],
              address: args[1],
              port: args[2],
              colo: args[3],
              region: args[4],
              rtt_ms: args[5],
              speed_mbps: args[6],
              client_hash: args[7],
            });
            return { success: true };
          },
          all: async () => ({
            results: rows
              .filter((row) => row.created_at >= args[0])
              .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
              .slice(0, args[1])
              .map((row) => ({
                created_at: row.created_at,
                address: row.address,
                port: row.port,
                colo: row.colo,
                region: row.region,
                rtt_ms: row.rtt_ms,
                speed_mbps: row.speed_mbps,
                client_hash: row.client_hash,
              })),
          }),
        }),
      };
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
      return statements.map(() => ({ success: true }));
    },
  };
}

function postRequest(body, headers = {}) {
  return new Request("https://example.com/api/ip-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer secret-token", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("parse colo filter normalizes, caps, and expands auto", () => {
  assert.deepEqual(parseColoFilter("hkg , nrt").colos, ["HKG", "NRT"]);
  assert.deepEqual(parseColoFilter("auto", { cf: { colo: "HKG" } }).colos, ["HKG"]);
  assert.deepEqual(parseColoFilter("auto", {}).colos, []);
  assert.deepEqual(parseColoFilter("").requested, []);
  assert.equal(parseColoFilter("a,b,c,d,e,f,g,h,i,j,k,l").colos.length, 10);
});

test("colo filter matches measured colo first and falls back to scanner colo", () => {
  const nodes = [
    { address: "1.1.1.1", colo: "LAX", userColo: "HKG" },
    { address: "1.1.1.2", colo: "SJC" },
  ];

  const byUser = filterNodesByColo(nodes, ["HKG"]);
  assert.equal(byUser.matched, true);
  assert.deepEqual(byUser.nodes.map((node) => node.address), ["1.1.1.1"]);

  const byScanner = filterNodesByColo(nodes, ["SJC"]);
  assert.deepEqual(byScanner.nodes.map((node) => node.address), ["1.1.1.2"]);

  const miss = filterNodesByColo(nodes, ["NRT"]);
  assert.equal(miss.matched, false);
  assert.equal(miss.fallback, true);
  assert.equal(miss.nodes.length, 2);

  const none = filterNodesByColo(nodes, []);
  assert.equal(none.filtered, false);
  assert.equal(none.nodes.length, 2);
});

test("ranking puts measured nodes first ordered by measured rtt", () => {
  const nodes = [
    { address: "a", colo: "LAX" },
    { address: "b", colo: "LAX" },
    { address: "c", colo: "LAX" },
  ];
  const scores = new Map([
    ["b", { rtt: 18.44, speed: 90, colo: "HKG", samples: 3 }],
    ["c", { rtt: 31, speed: 12, colo: "NRT", samples: 1 }],
    ["a", { rtt: 18.46, speed: 20, colo: "HKG", samples: 2 }],
  ]);

  const ranked = rankNodesByScore(nodes, scores);
  assert.deepEqual(ranked.map((node) => node.address), ["b", "a", "c"]);
  assert.equal(ranked[0].userRtt, 18.4);
  assert.equal(ranked[0].userColo, "HKG");
  assert.equal(ranked[0].userSpeed, 90);
  assert.equal(ranked[0].userSamples, 3);
});

test("ranking keeps original order when nothing is measured", () => {
  const nodes = [{ address: "a" }, { address: "b" }];
  const ranked = rankNodesByScore(nodes, new Map());
  assert.deepEqual(ranked.map((node) => node.address), ["a", "b"]);
  assert.equal(ranked[0].userRtt, undefined);
});

test("summarize ip scores averages rtt and keeps latest colo", () => {
  const scores = summarizeIpScores([
    { at: "2026-06-01T00:00:00.000Z", address: "1.1.1.1", rtt: 10, speed: 50, colo: "LAX" },
    { at: "2026-06-03T00:00:00.000Z", address: "1.1.1.1", rtt: 30, speed: 70, colo: "HKG" },
    { at: "2026-06-03T00:00:00.000Z", address: "1.1.1.2", rtt: 40, colo: "NRT" },
    { at: "2026-06-03T00:00:00.000Z", address: "bad", rtt: "x" },
  ]);

  assert.equal(scores.size, 2);
  assert.equal(scores.get("1.1.1.1").rtt, 20);
  assert.equal(scores.get("1.1.1.1").speed, 60);
  assert.equal(scores.get("1.1.1.1").colo, "HKG");
  assert.equal(scores.get("1.1.1.1").samples, 2);
  assert.equal(scores.get("1.1.1.2").speed, null);
});

test("ip feedback POST requires admin token", async () => {
  const missing = await handleIpFeedbackPost(postRequest({ results: [] }), createEnv({ SUB_TOKEN: "" }));
  assert.equal(missing.status, 500);

  const wrong = await handleIpFeedbackPost(
    postRequest({ results: [{ address: "1.1.1.1", rtt: 10 }] }, { Authorization: "Bearer nope" }),
    createEnv(),
  );
  assert.equal(wrong.status, 401);
});

test("ip feedback POST validates payload", async () => {
  const badJson = await handleIpFeedbackPost(postRequest("{"), createEnv());
  assert.equal(badJson.status, 400);

  const empty = await handleIpFeedbackPost(postRequest({ results: [] }), createEnv());
  assert.equal(empty.status, 400);

  const invalid = await handleIpFeedbackPost(postRequest({ results: [{ address: "not an ip", rtt: -1 }] }), createEnv());
  assert.equal(invalid.status, 400);
});

test("ip feedback POST stores measurements in KV and GET returns scores", async () => {
  const env = createEnv();
  const response = await handleIpFeedbackPost(postRequest({
    results: [
      { address: "1.1.1.1", port: 443, rtt: 32.4, speed: 88.5, colo: "HKG", region: "HK" },
      { address: "1.1.1.2", port: 8443, rtt: 41, colo: "NRT", region: "JP" },
      { address: "1.1.1.3", port: 443, rtt: 120, colo: "LAX", region: "US" },
    ],
  }), env);
  const posted = await response.json();

  assert.equal(response.status, 200);
  assert.equal(posted.ok, true);
  assert.equal(posted.storage, "kv");
  assert.equal(posted.saved, 3);

  const get = await handleIpFeedbackGet(new Request("https://example.com/api/ip-feedback", {
    headers: { Authorization: "Bearer secret-token" },
  }), env);
  const parsed = await get.json();

  assert.equal(get.status, 200);
  assert.equal(parsed.storage, "kv");
  assert.equal(parsed.scores["1.1.1.1"].rtt, 32.4);
  assert.equal(parsed.scores["1.1.1.1"].colo, "HKG");
  assert.equal(parsed.count, 3);
});

test("ip feedback POST writes to D1 when bound", async () => {
  const d1 = createMockD1();
  const response = await handleIpFeedbackPost(postRequest({
    results: [{ address: "1.1.1.1", rtt: 12.3, colo: "HKG" }],
  }), createEnv({ SPEED_DB: d1 }));
  const posted = await response.json();

  assert.equal(response.status, 200);
  assert.equal(posted.storage, "d1");
  assert.equal(d1.rows.length, 1);
  assert.equal(d1.rows[0].address, "1.1.1.1");
  assert.equal(d1.rows[0].rtt_ms, 12.3);

  const { scores, storage } = await loadIpScores({ SPEED_DB: d1 });
  assert.equal(storage, "d1");
  assert.equal(scores.get("1.1.1.1").rtt, 12.3);
});

test("best reorders nodes by measured rtt and reports measurement count", async () => {
  const env = createEnv();
  await env.SUB_KV.put("IP_FEEDBACK", JSON.stringify([
    { at: RECENT_AT, address: "1.1.1.3", port: 443, rtt: 21, speed: 66, colo: "HKG" },
  ]));

  const response = await handleBest(new Request("https://example.com/best?n=3", {
    headers: { Authorization: "Bearer read-token" },
  }), env);
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.nodes[0].address, "1.1.1.3");
  assert.equal(parsed.nodes[0].userRtt, 21);
  assert.equal(parsed.measured, 1);
  assert.equal(parsed.total, 3);
});

test("best supports colo filter with fallback when nothing matches", async () => {
  const matched = await handleBest(new Request("https://example.com/best?n=10&colo=sjc", {
    headers: { Authorization: "Bearer read-token" },
  }), createEnv());
  const matchedJson = await matched.json();

  assert.equal(matched.status, 200);
  assert.equal(matchedJson.nodes.length, 1);
  assert.equal(matchedJson.nodes[0].address, "1.1.1.2");
  assert.equal(matchedJson.filter.matched, true);
  assert.equal(matchedJson.filter.resolved[0], "SJC");
  assert.equal(matchedJson.filter.total, 3);

  const fallback = await handleBest(new Request("https://example.com/best?n=10&colo=NRT", {
    headers: { Authorization: "Bearer read-token" },
  }), createEnv());
  const fallbackJson = await fallback.json();

  assert.equal(fallbackJson.nodes.length, 3);
  assert.equal(fallbackJson.filter.matched, false);
  assert.equal(fallbackJson.filter.fallback, true);
});

test("best can disable measured ranking", async () => {
  const env = createEnv();
  await env.SUB_KV.put("IP_FEEDBACK", JSON.stringify([
    { at: RECENT_AT, address: "1.1.1.3", rtt: 21 },
  ]));

  const response = await handleBest(new Request("https://example.com/best?n=3&rank=off", {
    headers: { Authorization: "Bearer read-token" },
  }), env);
  const parsed = await response.json();

  assert.equal(parsed.nodes[0].address, "1.1.1.1");
  assert.equal(parsed.measured, 0);
});

test("sub applies colo filter and measured ranking to generated nodes", async () => {
  const env = createEnv();
  await env.SUB_KV.put("IP_FEEDBACK", JSON.stringify([
    { at: RECENT_AT, address: "1.1.1.3", rtt: 21, colo: "HKG" },
  ]));

  const response = await handleSub(new Request("https://example.com/sub?type=vless&n=3", {
    headers: { Authorization: "Bearer read-token" },
  }), env);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /^vless:\/\//);
  const firstNode = text.split("\n")[0];
  assert.match(firstNode, /@1\.1\.1\.3:443/);
  assert.match(firstNode, /21ms%20%E5%AE%9E%E6%B5%8B/);

  const filtered = await handleSub(new Request("https://example.com/sub?type=clash&colo=HKG&n=3", {
    headers: { Authorization: "Bearer read-token" },
  }), env);
  const yaml = await filtered.text();

  assert.match(yaml, /server: "1\.1\.1\.3"/);
  assert.doesNotMatch(yaml, /server: "1\.1\.1\.1"/);
});
