const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex,nofollow,noarchive",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

function withSecurityHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: withSecurityHeaders({
      "Content-Type": "application/json; charset=utf-8",
    }),
  });
}

export function textResponse(text, contentType = "text/plain; charset=utf-8") {
  return new Response(text, {
    headers: withSecurityHeaders({
      "Content-Type": contentType,
    }),
  });
}

export async function cachedTextResponse(text, contentType = "text/plain; charset=utf-8") {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const etag = `"${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}"`;
  return new Response(text, {
    headers: withSecurityHeaders({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=600",
      "ETag": etag,
    }),
  });
}

export async function privateTextResponse(text, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const etag = `"${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}"`;
  return new Response(text, {
    headers: withSecurityHeaders({
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "Vary": "Authorization",
      "ETag": etag,
      ...extraHeaders,
    }),
  });
}

export function unauthorizedResponse() {
  return jsonResponse({ error: "Unauthorized" }, 401);
}
