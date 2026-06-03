import test from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../src/security/auth.js";

function req({ token = "", ip = "1.2.3.4" } = {}) {
  return new Request(token ? "https://example.com/api/template" : "https://example.com/api/template", {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "cf-connecting-ip": ip,
    },
  });
}

test("auth accepts primary token", () => {
  assert.equal(requireAuth(req({ token: "primary" }), { SUB_TOKEN: "primary" }).authorized, true);
});

test("auth accepts rotated next token", () => {
  assert.equal(requireAuth(req({ token: "next" }), { SUB_TOKEN: "primary", SUB_TOKEN_NEXT: "next" }).authorized, true);
});

test("auth rejects disallowed IP when whitelist is configured", () => {
  const result = requireAuth(req({ token: "primary", ip: "9.9.9.9" }), {
    SUB_TOKEN: "primary",
    SUB_ALLOWED_IPS: "1.2.3.4",
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "IP not allowed");
});

test("auth accepts allowed IP when whitelist is configured", () => {
  const result = requireAuth(req({ token: "primary", ip: "1.2.3.4" }), {
    SUB_TOKEN: "primary",
    SUB_ALLOWED_IPS: "1.2.3.4",
  });
  assert.equal(result.authorized, true);
});
