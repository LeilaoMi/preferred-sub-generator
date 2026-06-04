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

export function requireReadAuth(request, env) {
  if (envFlag(env.SUB_PUBLIC)) return { authorized: true, public: true };
  return authorizeWithTokens(request, env, getReadTokens(env), {
    queryName: "t",
    allowQueryToken: true,
  });
}