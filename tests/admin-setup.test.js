import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminSetupGet, handleAdminSetupPost } from "../src/api/admin-setup.js";
import { KV_ADMIN_TOKEN_KEY, requireAuthAsync, sha256Hex } from "../src/security/auth.js";

let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `10.9.0.${ipCounter}`;
}

function createEnv(extra = {}) {
  const data = new Map();
  return {
    SUB_KV: {
      async get(key) { return data.has(key) ? data.get(key) : null; },
      async put(key, value) { data.set(key, value); },
    },
    _data: data,
    ...extra,
  };
}

function setupRequest(token, ip) {
  return new Request("https://example.com/api/admin-setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": ip || uniqueIp(),
    },
    body: JSON.stringify({ token }),
  });
}

function authedRequest(token, ip) {
  return new Request("https://example.com/api/ip-feedback", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "cf-connecting-ip": ip || uniqueIp(),
    },
  });
}

test("setup GET 报告未设置状态", async () => {
  const response = await handleAdminSetupGet(new Request("https://example.com/api/admin-setup"), createEnv());
  assert.deepEqual(await response.json(), { setupRequired: true });
});

test("setup 拒绝过短 token 且不写入 KV", async () => {
  const env = createEnv();
  const response = await handleAdminSetupPost(setupRequest("short"), env);
  assert.equal(response.status, 400);
  assert.equal(env._data.has(KV_ADMIN_TOKEN_KEY), false);
});

test("setup 成功后 KV 只存哈希不存原文", async () => {
  const env = createEnv();
  const response = await handleAdminSetupPost(setupRequest("this-is-a-long-test-token"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const stored = env._data.get(KV_ADMIN_TOKEN_KEY);
  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.notEqual(stored, "this-is-a-long-test-token");
  assert.equal(stored, await sha256Hex("this-is-a-long-test-token"));
});

test("setup 成功后锁定：GET 变 false，重复 POST 返回 403", async () => {
  const env = createEnv();
  await handleAdminSetupPost(setupRequest("this-is-a-long-test-token"), env);

  const state = await handleAdminSetupGet(new Request("https://example.com/api/admin-setup"), env);
  assert.deepEqual(await state.json(), { setupRequired: false });

  const again = await handleAdminSetupPost(setupRequest("another-long-test-token"), env);
  assert.equal(again.status, 403);
});

test("环境变量已配时 setup 直接锁定", async () => {
  const env = createEnv({ SUB_TOKEN: "env-admin-token-value" });
  const response = await handleAdminSetupPost(setupRequest("this-is-a-long-test-token"), env);
  assert.equal(response.status, 403);
  assert.equal(env._data.has(KV_ADMIN_TOKEN_KEY), false);
});

test("requireAuthAsync 接受 KV 设置的 token（原文）", async () => {
  const env = createEnv();
  await handleAdminSetupPost(setupRequest("kv-backed-admin-token"), env);

  const auth = await requireAuthAsync(authedRequest("kv-backed-admin-token"), env);
  assert.equal(auth.authorized, true);
});

test("requireAuthAsync 拒绝错误 token", async () => {
  const env = createEnv();
  await handleAdminSetupPost(setupRequest("kv-backed-admin-token"), env);

  const auth = await requireAuthAsync(authedRequest("wrong-token-value"), env);
  assert.equal(auth.authorized, false);
  assert.equal(auth.reason, "Unauthorized");
});

test("requireAuthAsync 兼容环境变量 token", async () => {
  const env = createEnv({ SUB_TOKEN: "env-admin-token-value" });
  const auth = await requireAuthAsync(authedRequest("env-admin-token-value"), env);
  assert.equal(auth.authorized, true);
});

test("requireAuthAsync 两边都没配时返回 Missing SUB_TOKEN", async () => {
  const auth = await requireAuthAsync(authedRequest("anything"), createEnv());
  assert.equal(auth.authorized, false);
  assert.equal(auth.reason, "Missing SUB_TOKEN");
});
