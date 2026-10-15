import { KV_ADMIN_TOKEN_KEY, sha256Hex } from "../security/auth.js";
import { checkRateLimit } from "../security/rate-limit.js";
import { jsonResponse } from "../utils/response.js";

const MIN_TOKEN_LENGTH = 12;
const MAX_TOKEN_LENGTH = 128;

// 锁定条件：KV 已有哈希，或环境变量已配好（后者走原有路径，不需要再设置）
async function setupLocked(env) {
  if (env.SUB_TOKEN || env.SUB_TOKEN_NEXT) return true;
  try {
    return Boolean(await env.SUB_KV.get(KV_ADMIN_TOKEN_KEY));
  } catch {
    return false;
  }
}

// 防抢占：首次设置必须带部署者在 Pages 环境变量里配置的一次性设置码 SETUP_CODE。
// 没配 SETUP_CODE 时网页设置关闭（仍可直接配 SUB_TOKEN 环境变量）。
function setupCodeOk(env, candidate) {
  const expected = String(env.SETUP_CODE || "");
  const given = String(candidate || "");
  if (expected.length < 8 || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export async function handleAdminSetupGet(request, env) {
  const locked = await setupLocked(env);
  return jsonResponse({ setupRequired: !locked, setupEnabled: !locked && String(env.SETUP_CODE || "").length >= 8 });
}

export async function handleAdminSetupPost(request, env) {
  const rate = checkRateLimit(request);
  if (!rate.allowed) return jsonResponse({ error: rate.error }, rate.status);

  if (await setupLocked(env)) {
    return jsonResponse({ error: "管理 token 已设置，无需重复设置" }, 403);
  }

  if (String(env.SETUP_CODE || "").length < 8) {
    return jsonResponse({ error: "网页设置未开启：请在 Cloudflare Pages 环境变量里设置 SETUP_CODE（至少 8 位）后重新部署，或直接设置 SUB_TOKEN" }, 403);
  }
  // 只接受 application/json，挡住跨站表单/text/plain 伪造请求
  if (!String(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return jsonResponse({ error: "Content-Type 必须是 application/json" }, 415);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!setupCodeOk(env, body && body.setupCode)) {
    return jsonResponse({ error: "设置码不正确" }, 403);
  }
  const token = String(body && body.token ? body.token : "").trim();
  if (token.length < MIN_TOKEN_LENGTH) {
    return jsonResponse({ error: `管理 token 至少 ${MIN_TOKEN_LENGTH} 位` }, 400);
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    return jsonResponse({ error: `管理 token 至多 ${MAX_TOKEN_LENGTH} 位` }, 400);
  }

  await env.SUB_KV.put(KV_ADMIN_TOKEN_KEY, await sha256Hex(token));
  return jsonResponse({ ok: true });
}
