import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, resetRateLimit } from "../src/security/rate-limit.js";

function fakeRequest(ip = "1.2.3.4") {
  return { headers: { get: () => ip } };
}

function fakeXffRequest(xff) {
  return {
    headers: {
      get(name) {
        if (name === "x-forwarded-for") return xff;
        return "";
      },
    },
  };
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

test("rate limit uses first x-forwarded-for IP when Cloudflare IP is absent", () => {
  resetRateLimit();
  for (let i = 0; i < 10; i++) checkRateLimit(fakeXffRequest("5.5.5.5, 6.6.6.6"));
  const blocked = checkRateLimit(fakeXffRequest("5.5.5.5, 7.7.7.7"));
  const allowed = checkRateLimit(fakeXffRequest("6.6.6.6, 5.5.5.5"));

  assert.equal(blocked.allowed, false);
  assert.equal(allowed.allowed, true);
});

test("rate limit keeps bucket count bounded", () => {
  resetRateLimit();
  for (let i = 0; i < 5200; i++) {
    checkRateLimit(fakeRequest(`10.0.${Math.floor(i / 255)}.${i % 255}`));
  }
  assert.equal(checkRateLimit(fakeRequest("192.0.2.1")).allowed, true);
});
