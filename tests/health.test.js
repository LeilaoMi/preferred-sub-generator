import test from "node:test";
import assert from "node:assert/strict";
import { handleHealth } from "../src/api/health.js";

function createEnv(values) {
  return {
    SUB_TOKEN: "secret-token",
    SUB_KV: {
      async get(key) {
        return values[key] || null;
      },
    },
  };
}

test("health returns minimal public ok without template details", async () => {
  const response = await handleHealth(new Request("https://example.com/health"), createEnv({
    TEMPLATE: "vless://x",
    BEST_IPS: JSON.stringify([{ address: "1.1.1.1" }]),
  }));
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(parsed, { ok: true });
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex,nofollow,noarchive");
});

test("health returns minimal public failure when required KV values are missing", async () => {
  const response = await handleHealth(new Request("https://example.com/health"), createEnv({}));
  const parsed = await response.json();

  assert.equal(response.status, 503);
  assert.deepEqual(parsed, { ok: false });
});

test("health full requires admin auth and returns details", async () => {
  const env = createEnv({
    TEMPLATE: "vless://x",
    BEST_IPS: JSON.stringify([{ address: "1.1.1.1" }]),
  });
  const denied = await handleHealth(new Request("https://example.com/health/full"), env);
  const allowed = await handleHealth(new Request("https://example.com/health/full", {
    headers: { Authorization: "Bearer secret-token" },
  }), env);
  const parsed = await allowed.json();

  assert.equal(denied.status, 401);
  assert.equal(allowed.status, 200);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.kv, true);
  assert.equal(parsed.templateExists, true);
  assert.equal(parsed.bestIpsCount, 1);
});
