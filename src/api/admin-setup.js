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

export async function handleAdminSetupGet(request, env) {
  return jsonResponse({ setupRequired: !(await setupLocked(env)) });
}

export async function handleAdminSetupPost(request, env) {
  const rate = checkRateLimit(request);
  if (!rate.allowed) return jsonResponse({ error: rate.error }, rate.status);

  if (await setupLocked(env)) {
    return jsonResponse({ error: "管理 token 已设置，无需重复设置" }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
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
