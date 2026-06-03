import { timingSafeEqual } from "node:crypto";

function getClientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
}

function getTokens(env) {
  return [env.SUB_TOKEN, env.SUB_TOKEN_NEXT].filter(Boolean);
}

function isAllowedIp(request, env) {
  const allowed = String(env.SUB_ALLOWED_IPS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(getClientIp(request));
}

export function requireAuth(request, env) {
  const tokens = getTokens(env);
  if (tokens.length === 0) {
    return { authorized: false, reason: "Missing SUB_TOKEN" };
  }

  if (!isAllowedIp(request, env)) {
    return { authorized: false, reason: "IP not allowed" };
  }

  const header = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") || "";

  let candidate = "";
  if (header.startsWith("Bearer ")) {
    candidate = header.slice(7).trim();
  } else if (queryToken) {
    candidate = queryToken.trim();
  }

  if (!candidate) {
    return { authorized: false, reason: "Unauthorized" };
  }

  const a = Buffer.from(candidate);
  const ok = tokens.some((token) => {
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  return ok ? { authorized: true } : { authorized: false, reason: "Unauthorized" };
}
