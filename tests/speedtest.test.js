import test from "node:test";
import assert from "node:assert/strict";
import { resetRateLimit } from "../src/security/rate-limit.js";
import { handleSpeedtestFeedbackGet, handleSpeedtestFeedbackPost } from "../src/api/speedtest-feedback.js";
import { clampOptions, hashClientIp, insertFeedback, loadFeedback, summarizeFeedback } from "../src/api/speedtest-db.js";

function createKvEnv() {
  const data = new Map();
  return {
    SUB_KV: {
      async get(key) { return data.get(key) ?? null; },
      async put(key, value) { data.set(key, value); },
    },
    _data: data,
  };
}

function createD1Env() {
  const rows = [];
  let seq = 0;
  const db = {
    execCalls: 0,
    async exec() { this.execCalls += 1; },
    prepare(sql) {
      return {
        bind: (...args) => ({
          async run() {
            if (sql.startsWith("INSERT INTO speed_feedback")) {
              rows.push({
                id: ++seq,
                created_at: args[0],
                colo: args[1],
                ip_country: args[2],
                isp: args[3],
                speed_mbps: args[4],
                client_hash: args[5],
              });
              return { success: true };
            }
            throw new Error(`Unexpected run: ${sql}`);
          },
          async all() {
            if (sql.startsWith("SELECT created_at")) {
              const [since, limit] = args;
              return { results: rows.filter((row) => row.created_at >= since).slice(0, limit) };
            }
            throw new Error(`Unexpected all: ${sql}`);
          },
        }),
      };
    },
  };
  return { SPEED_DB: db, _rows: rows };
}

function feedbackRequest(body) {
  return new Request("https://example.com/api/speedtest-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify(body),
  });
}

test("clampOptions applies defaults and bounds", () => {
  assert.deepEqual(clampOptions({}), { days: 14, limit: 100 });
  assert.deepEqual(clampOptions({ days: "7", limit: "5" }), { days: 7, limit: 5 });
  assert.deepEqual(clampOptions({ days: 9999, limit: 99999 }), { days: 90, limit: 1000 });
  assert.deepEqual(clampOptions({ days: "abc", limit: "-3" }), { days: 14, limit: 100 });
});

test("hashClientIp is deterministic and truncated", async () => {
  const a = await hashClientIp("203.0.113.9");
  const b = await hashClientIp("203.0.113.9");
  const c = await hashClientIp("198.51.100.7");

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 16);
});

test("speedtest POST falls back to KV and stores hashed client", async () => {
  resetRateLimit();
  const env = createKvEnv();
  const response = await handleSpeedtestFeedbackPost(feedbackRequest({ speedMbps: 123.45, colo: "lax", ipCountry: "US" }), env);
  const parsed = await response.json();
  const stored = JSON.parse(env._data.get("SPEED_FEEDBACK"));

  assert.equal(response.status, 200);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.storage, "kv");
  assert.equal(parsed.saved.colo, "LAX");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].ip, undefined);
  assert.equal(typeof stored[0].clientHash, "string");
  assert.equal(stored[0].clientHash.length, 16);
});

test("speedtest POST uses D1 when bound", async () => {
  resetRateLimit();
  const env = createD1Env();
  const response = await handleSpeedtestFeedbackPost(feedbackRequest({ speedMbps: 88, colo: "hkg" }), env);
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.storage, "d1");
  assert.equal(env._rows.length, 1);
  assert.equal(env._rows[0].colo, "HKG");
  assert.equal(env._rows[0].speed_mbps, 88);
  assert.equal(typeof env._rows[0].client_hash, "string");
  assert.ok(env.SPEED_DB.execCalls >= 1, "schema should be ensured before insert");
});

test("speedtest POST rejects invalid speed", async () => {
  resetRateLimit();
  const response = await handleSpeedtestFeedbackPost(feedbackRequest({ speedMbps: "fast" }), createKvEnv());
  assert.equal(response.status, 400);
});

test("speedtest GET requires admin token", async () => {
  const response = await handleSpeedtestFeedbackGet(new Request("https://example.com/api/speedtest-feedback"), {
    ...createKvEnv(),
    SUB_TOKEN: "secret-token",
  });
  assert.equal(response.status, 401);
});

test("speedtest GET returns trend summary from KV", async () => {
  const env = createKvEnv();
  const now = Date.parse("2026-06-03T12:00:00.000Z");
  await env.SUB_KV.put("SPEED_FEEDBACK", JSON.stringify([
    { at: "2026-06-03T01:00:00.000Z", colo: "LAX", speedMbps: 100 },
    { at: "2026-06-03T02:00:00.000Z", colo: "LAX", speedMbps: 200 },
    { at: "2026-06-02T02:00:00.000Z", colo: "HKG", speedMbps: 50 },
    { at: "2026-05-01T02:00:00.000Z", colo: "SJC", speedMbps: 10 },
  ]));

  const response = await handleSpeedtestFeedbackGet(new Request("https://example.com/api/speedtest-feedback?days=7", {
    headers: { Authorization: "Bearer secret-token" },
  }), { ...env, SUB_TOKEN: "secret-token", FEEDBACK_NOW: "2026-06-03T12:00:00.000Z" });
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.storage, "kv");
  assert.equal(parsed.summary.count, 3, "old entries outside window are excluded");
  assert.equal(parsed.summary.averageSpeedMbps, 116.67);
  assert.equal(parsed.summary.maxSpeedMbps, 200);
  assert.equal(parsed.summary.trend.length, 7, "trend has one bucket per day");
  assert.equal(parsed.summary.trend.at(-1).date, "2026-06-03");
  assert.equal(parsed.summary.trend.at(-1).count, 2);
  assert.equal(parsed.summary.trend.at(-1).averageSpeedMbps, 150);
  assert.equal(parsed.summary.coloBreakdown.LAX, 2);
  assert.equal(parsed.summary.coloSummary[0].colo, "LAX");
});

test("speedtest GET reads from D1 when bound", async () => {
  const env = createD1Env();
  await insertFeedback(env, { at: "2026-06-03T01:00:00.000Z", colo: "SIN", ipCountry: "SG", isp: "", speedMbps: 300, clientHash: "abc" });
  await insertFeedback(env, { at: "2026-06-03T05:00:00.000Z", colo: "SIN", ipCountry: "SG", isp: "", speedMbps: 400, clientHash: "def" });

  const response = await handleSpeedtestFeedbackGet(new Request("https://example.com/api/speedtest-feedback?days=30", {
    headers: { Authorization: "Bearer secret-token" },
  }), { ...env, SUB_TOKEN: "secret-token", FEEDBACK_NOW: "2026-06-03T12:00:00.000Z" });
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.storage, "d1");
  assert.equal(parsed.summary.count, 2);
  assert.equal(parsed.summary.averageSpeedMbps, 350);
  assert.equal(parsed.feedback[0].colo, "SIN");
  assert.equal(parsed.feedback[0].ip, undefined, "D1 path never exposes raw ip");
});

test("summarizeFeedback fills empty trend days", () => {
  const now = Date.parse("2026-06-03T12:00:00.000Z");
  const summary = summarizeFeedback([], { now, days: 3 });

  assert.equal(summary.count, 0);
  assert.deepEqual(summary.trend.map((day) => day.date), ["2026-06-01", "2026-06-02", "2026-06-03"]);
  assert.ok(summary.trend.every((day) => day.averageSpeedMbps === null));
  assert.equal(summary.storage, "kv");
});

test("loadFeedback returns storage channel with entries", async () => {
  const env = createKvEnv();
  await env.SUB_KV.put("SPEED_FEEDBACK", JSON.stringify([{ at: "2026-06-03T01:00:00.000Z", colo: "LAX", speedMbps: 10 }]));
  const now = Date.parse("2026-06-03T12:00:00.000Z");

  const fromKv = await loadFeedback(env, { now });
  assert.equal(fromKv.storage, "kv");
  assert.equal(fromKv.entries.length, 1);

  const fromD1 = await loadFeedback(createD1Env(), { now });
  assert.equal(fromD1.storage, "d1");
  assert.deepEqual(fromD1.entries, []);
});
