import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, resetRateLimit } from "../src/security/rate-limit.js";

function fakeRequest(ip = "1.2.3.4") {
  return { headers: { get: () => ip } };
}

test("rate limit allows requests under threshold", () => {
  resetRateLimit();
  for (let i = 0; i < 10; i++) {
    const r = checkRateLimit(fakeRequest());
    assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
  }
});

test("rate limit blocks requests over threshold", () => {
  resetRateLimit();
  for (let i = 0; i < 10; i++) checkRateLimit(fakeRequest("5.6.7.8"));
  const r = checkRateLimit(fakeRequest("5.6.7.8"));
  assert.equal(r.allowed, false);
  assert.equal(r.status, 429);
});
