import test from "node:test";
import assert from "node:assert/strict";
import { deriveReadToken, requireAuth, requireReadAuth } from "../src/security/auth.js";

function readReq(token) {
  return new Request("https://example.com/sub", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

const FIXED_NOW = Date.parse("2026-10-11T00:00:00.000Z");
const rotateEnv = { SUB_READ_TOKEN: "base-secret", SUB_TOKEN_ROTATE_DAYS: "7", SUB_TOKEN: "admin-secret", SUB_PUBLIC: "0" };

function req({ token = "", ip = "1.2.3.4" } = {}) {
  return new Request(token ? "https://example.com/api/template" : "https://example.com/api/template", {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "cf-connecting-ip": ip,
    },
  });
}

function queryReq(token) {
  return new Request(`https://example.com/api/template?token=${encodeURIComponent(token)}`);
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

test("auth rejects query token by default", () => {
  const result = requireAuth(queryReq("primary"), { SUB_TOKEN: "primary" });
  assert.equal(result.authorized, false);
});

test("auth accepts query token only when explicitly enabled", () => {
  const result = requireAuth(queryReq("primary"), { SUB_TOKEN: "primary", ALLOW_QUERY_TOKEN: "1" });
  assert.equal(result.authorized, true);
});

test("auth uses first x-forwarded-for IP when Cloudflare IP header is absent", () => {
  const request = new Request("https://example.com/api/template", {
    headers: {
      Authorization: "Bearer primary",
      "x-forwarded-for": "1.2.3.4, 9.9.9.9",
    },
  });
  const result = requireAuth(request, {
    SUB_TOKEN: "primary",
    SUB_ALLOWED_IPS: "1.2.3.4",
  });
  assert.equal(result.authorized, true);
});

test("P2-7 deriveReadToken is deterministic for a fixed time", async () => {
  const a = await deriveReadToken(rotateEnv, FIXED_NOW);
  const b = await deriveReadToken(rotateEnv, FIXED_NOW);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("P2-7 deriveReadToken changes across rotation periods", async () => {
  const a = await deriveReadToken(rotateEnv, FIXED_NOW);
  const b = await deriveReadToken(rotateEnv, FIXED_NOW + 7 * 86400000);
  assert.notEqual(a, b);
});

test("P2-7 deriveReadToken returns static token when rotation is off", async () => {
  assert.equal(await deriveReadToken({ SUB_READ_TOKEN: "base-secret" }, FIXED_NOW), "base-secret");
  assert.equal(await deriveReadToken({ SUB_READ_TOKEN: "base-secret", SUB_TOKEN_ROTATE_DAYS: "0" }, FIXED_NOW), "base-secret");
  assert.equal(await deriveReadToken({ SUB_READ_TOKEN: "base-secret", SUB_TOKEN_ROTATE_DAYS: "bogus" }, FIXED_NOW), "base-secret");
});

test("P2-7 read auth accepts current and previous period tokens", async () => {
  const current = await deriveReadToken(rotateEnv, FIXED_NOW);
  const previous = await deriveReadToken(rotateEnv, FIXED_NOW - 7 * 86400000);
  assert.equal((await requireReadAuth(readReq(current), rotateEnv, FIXED_NOW)).authorized, true);
  assert.equal((await requireReadAuth(readReq(previous), rotateEnv, FIXED_NOW)).authorized, true);
});

test("P2-7 read auth rejects static token when rotation is on", async () => {
  const result = await requireReadAuth(readReq("base-secret"), rotateEnv, FIXED_NOW);
  assert.equal(result.authorized, false);
});

test("P2-7 read auth still accepts admin token when rotation is on", async () => {
  const result = await requireReadAuth(readReq("admin-secret"), rotateEnv, FIXED_NOW);
  assert.equal(result.authorized, true);
});

test("P2-7 read auth accepts static token when rotation is off", async () => {
  const result = await requireReadAuth(readReq("base-secret"), { SUB_READ_TOKEN: "base-secret" }, FIXED_NOW);
  assert.equal(result.authorized, true);
});
