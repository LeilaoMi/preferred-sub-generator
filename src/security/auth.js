function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function envFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function getClientIp(request) {
  const xff = request.headers.get("x-forwarded-for") || "";
  return request.headers.get("cf-connecting-ip") || xff.split(",")[0].trim() || "unknown";
}

function getTokens(env) {
  return [env.SUB_TOKEN, env.SUB_TOKEN_NEXT].filter(Boolean);
}

function getReadTokens(env) {
  return [env.SUB_READ_TOKEN, env.SUB_READ_TOKEN_NEXT, env.SUB_TOKEN, env.SUB_TOKEN_NEXT].filter(Boolean);
}

function isAllowedIp(request, env) {
  const allowed = String(env.SUB_ALLOWED_IPS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(getClientIp(request));
}

function tokenFromRequest(request, queryName, allowQueryToken) {
  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  if (!allowQueryToken) return "";
  const url = new URL(request.url);
  return (url.searchParams.get(queryName) || "").trim();
}

function authorizeWithTokens(request, env, tokens, { queryName = "token", allowQueryToken = false } = {}) {
  if (tokens.length === 0) {
    return { authorized: false, reason: "Missing SUB_TOKEN" };
  }

  if (!isAllowedIp(request, env)) {
    return { authorized: false, reason: "IP not allowed" };
  }

  const candidate = tokenFromRequest(request, queryName, allowQueryToken);
  if (!candidate) {
    return { authorized: false, reason: "Unauthorized" };
  }

  const ok = tokens.some((token) => constantTimeEqual(candidate, token));
  return ok ? { authorized: true } : { authorized: false, reason: "Unauthorized" };
}

export function requireAuth(request, env) {
  return authorizeWithTokens(request, env, getTokens(env), {
    queryName: "token",
    allowQueryToken: envFlag(env.ALLOW_QUERY_TOKEN),
  });
}

// P2-7: 只读 token 自动周期轮换（默认关闭）。
// 开启（SUB_TOKEN_ROTATE_DAYS=N>0）时，有效只读凭证为 HMAC(SUB_READ_TOKEN, 周期) 的
// 当期值与上一期值（优雅过渡）；静态 SUB_READ_TOKEN 降级为 HMAC 密钥，不再直接当凭证用。
// 管理员 token（SUB_TOKEN/SUB_TOKEN_NEXT）始终可用。Workers 环境用 Web Crypto。
function rotateDays(env) {
  const days = Number(env.SUB_TOKEN_ROTATE_DAYS);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
}

function rotatePeriod(days, now) {
  return Math.floor(now / (days * 86400000));
}

async function hmacHex(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveReadToken(env, now = Date.now()) {
  const days = rotateDays(env);
  const base = env.SUB_READ_TOKEN || "";
  if (!days || !base) return base;
  return hmacHex(base, `read-token-v1:${rotatePeriod(days, now)}`);
}

async function getEffectiveReadTokens(env, now) {
  const days = rotateDays(env);
  const base = env.SUB_READ_TOKEN || "";
  if (!days || !base) return getReadTokens(env);
  const period = rotatePeriod(days, now);
  const current = await hmacHex(base, `read-token-v1:${period}`);
  const previous = await hmacHex(base, `read-token-v1:${period - 1}`);
  // 轮换模式下静态只读 token 只做密钥，不再接受为凭证；管理员 token 保留
  const adminTokens = [env.SUB_TOKEN, env.SUB_TOKEN_NEXT].filter(Boolean);
  return [...new Set([current, previous, ...adminTokens])];
}

export async function requireReadAuth(request, env, now = Date.now()) {
  // 默认公开模式：SUB_PUBLIC 未设置时即公开；只有明确设为 0/false/no/off 才启用 token 验证
  const publicDisabled = ["0", "false", "no", "off"].includes(String(env.SUB_PUBLIC || "").toLowerCase());
  if (!publicDisabled) return { authorized: true, public: true };
  return authorizeWithTokens(request, env, await getEffectiveReadTokens(env, now), {
    queryName: "t",
    allowQueryToken: true,
  });
}