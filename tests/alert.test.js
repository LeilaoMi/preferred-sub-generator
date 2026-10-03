import test from "node:test";
import assert from "node:assert/strict";
import { classifyStatus, runAlertStage, shouldNotify } from "../scripts/lib/alert.js";

function status(overrides = {}) {
  return {
    updatedAt: "2026-06-03T00:00:00.000Z",
    available: 50,
    newAvailable: 50,
    consecutiveFallbacks: 0,
    protectedByPrevious: false,
    lastError: null,
    ...overrides,
  };
}

test("classifyStatus healthy state stays ok with no reasons", () => {
  const result = classifyStatus(status(), null);
  assert.equal(result.level, "ok");
  assert.deepEqual(result.reasons, []);
});

test("classifyStatus flags zero available nodes as critical", () => {
  const result = classifyStatus(status({ available: 0, newAvailable: 0 }));
  assert.equal(result.level, "critical");
  assert.deepEqual(result.reasons, ["no-available-nodes"]);
});

test("classifyStatus flags consecutive fallbacks past threshold", () => {
  const result = classifyStatus(status({ consecutiveFallbacks: 3 }), null, { fallbackThreshold: 3 });
  assert.equal(result.level, "warn");
  assert.ok(result.reasons.includes("consecutive-fallbacks"));
});

test("classifyStatus flags sharp drop against previous run", () => {
  const previous = status({ available: 50 });
  const current = status({ available: 20 });
  const result = classifyStatus(current, previous, { dropRatio: 0.3 });
  assert.equal(result.level, "warn");
  assert.ok(result.reasons.includes("available-dropped"));
});

test("classifyStatus ignores small drops below ratio", () => {
  const previous = status({ available: 50 });
  const current = status({ available: 45 });
  const result = classifyStatus(current, previous, { dropRatio: 0.3 });
  assert.equal(result.level, "ok");
});

test("classifyStatus flags non-fallback refresh error as critical", () => {
  const result = classifyStatus(status({ lastError: "boom", protectedByPrevious: false }));
  assert.equal(result.level, "critical");
  assert.ok(result.reasons.includes("refresh-error"));
});

test("classifyStatus flags low available below minimum", () => {
  const result = classifyStatus(status({ available: 5 }), null, { minAvailable: 10 });
  assert.equal(result.level, "warn");
  assert.ok(result.reasons.includes("low-available"));
});

test("shouldNotify stays silent on first healthy run", () => {
  const decision = shouldNotify({ previousState: null, currentState: { level: "ok", reasons: [] } });
  assert.equal(decision.notify, false);
});

test("shouldNotify fires on first degraded run", () => {
  const decision = shouldNotify({ previousState: null, currentState: { level: "warn", reasons: ["low-available"] } });
  assert.equal(decision.notify, true);
  assert.equal(decision.type, "initial");
});

test("shouldNotify stays silent while state unchanged inside repeat window", () => {
  const now = Date.parse("2026-06-03T00:00:00.000Z");
  const decision = shouldNotify({
    previousState: { level: "warn", reasons: ["low-available"], lastSentAt: "2026-06-02T12:00:00.000Z" },
    currentState: { level: "warn", reasons: ["low-available"] },
    now,
    repeatHours: 24,
  });
  assert.equal(decision.notify, false);
});

test("shouldNotify repeats after repeat window elapses", () => {
  const now = Date.parse("2026-06-05T00:00:00.000Z");
  const decision = shouldNotify({
    previousState: { level: "warn", reasons: ["low-available"], lastSentAt: "2026-06-02T00:00:00.000Z" },
    currentState: { level: "warn", reasons: ["low-available"] },
    now,
    repeatHours: 24,
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.type, "repeat");
});

test("shouldNotify fires on escalation", () => {
  const decision = shouldNotify({
    previousState: { level: "warn", reasons: ["low-available"], lastSentAt: "2026-06-03T00:00:00.000Z" },
    currentState: { level: "critical", reasons: ["no-available-nodes"] },
    now: Date.parse("2026-06-03T01:00:00.000Z"),
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.type, "escalation");
});

test("shouldNotify fires on recovery", () => {
  const decision = shouldNotify({
    previousState: { level: "warn", reasons: ["low-available"], lastSentAt: "2026-06-03T00:00:00.000Z" },
    currentState: { level: "ok", reasons: [] },
    now: Date.parse("2026-06-03T01:00:00.000Z"),
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.type, "recovery");
});

test("shouldNotify fires when reasons change at same level", () => {
  const decision = shouldNotify({
    previousState: { level: "warn", reasons: ["low-available"], lastSentAt: "2026-06-03T00:00:00.000Z" },
    currentState: { level: "warn", reasons: ["consecutive-fallbacks"] },
    now: Date.parse("2026-06-03T01:00:00.000Z"),
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.type, "change");
});

test("shouldNotify always mode notifies even when healthy", () => {
  const decision = shouldNotify({
    previousState: { level: "ok", reasons: [], lastSentAt: "2026-06-03T00:00:00.000Z" },
    currentState: { level: "ok", reasons: [] },
    now: Date.parse("2026-06-03T01:00:00.000Z"),
    always: true,
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.type, "always");
});

test("runAlertStage notifies once, persists state, then stays silent", async () => {
  const sent = [];
  const states = [];
  const now = Date.parse("2026-06-03T00:00:00.000Z");
  const degraded = status({ available: 5, newAvailable: 0 });

  const first = await runAlertStage({
    status: degraded,
    previousStatus: status(),
    previousAlertState: null,
    now,
    minAvailable: 10,
    notify: async (payload) => { sent.push(payload); return true; },
    saveState: async (state) => { states.push(state); },
  });

  assert.equal(first.notified, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, "preferred-sub-generator.alert");
  assert.equal(sent[0].level, "warn");
  assert.ok(sent[0].reasons.includes("low-available"));
  assert.equal(states.length, 1);

  const second = await runAlertStage({
    status: degraded,
    previousStatus: status(),
    previousAlertState: states[0],
    now: now + 60 * 60 * 1000,
    minAvailable: 10,
    notify: async (payload) => { sent.push(payload); return true; },
    saveState: async (state) => { states.push(state); },
  });

  assert.equal(second.notified, false);
  assert.equal(sent.length, 1);
  assert.equal(states.length, 2);
});

test("runAlertStage does not mark sent when webhook delivery fails", async () => {
  const now = Date.parse("2026-06-03T00:00:00.000Z");
  const result = await runAlertStage({
    status: status({ available: 0 }),
    previousStatus: null,
    previousAlertState: null,
    now,
    notify: async () => false,
    saveState: async () => {},
  });

  assert.equal(result.notified, false);
  assert.equal(result.state.lastSentAt, null);
});

test("runAlertStage without webhook still persists classification state", async () => {
  const states = [];
  const result = await runAlertStage({
    status: status({ available: 5 }),
    previousStatus: null,
    previousAlertState: null,
    now: Date.parse("2026-06-03T00:00:00.000Z"),
    minAvailable: 10,
    saveState: async (state) => { states.push(state); },
  });

  assert.equal(result.notified, false);
  assert.equal(states.length, 1);
  assert.equal(states[0].level, "warn");
});
