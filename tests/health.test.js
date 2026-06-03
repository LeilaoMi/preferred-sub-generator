import test from "node:test";
import assert from "node:assert/strict";
import { handleHealth } from "../src/api/health.js";

function createEnv(values) {
  return {
    SUB_KV: {
      async get(key) {
        return values[key] || null;
      },
    },
  };
}

test("health returns ok when KV, TEMPLATE and BEST_IPS are available", async () => {
  const response = await handleHealth(new Request("https://example.com/health"), createEnv({
    TEMPLATE: "vless://x",
    BEST_IPS: JSON.stringify([{ address: "1.1.1.1" }]),
  }));
  const parsed = await response.json();

  assert.equal(response.status, 200);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.kv, true);
  assert.equal(parsed.templateExists, true);
  assert.equal(parsed.bestIpsCount, 1);
});

test("health returns 503 when required KV values are missing", async () => {
  const response = await handleHealth(new Request("https://example.com/health"), createEnv({}));
  const parsed = await response.json();

  assert.equal(response.status, 503);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.kv, true);
  assert.equal(parsed.templateExists, false);
  assert.equal(parsed.bestIpsCount, 0);
});
