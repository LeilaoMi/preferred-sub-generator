const buckets = new Map();

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const BLOCK_MS = 300_000;

function getClientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
}

export function checkRateLimit(request) {
  const ip = getClientIp(request);
  const now = Date.now();
  let bucket = buckets.get(ip);

  if (!bucket) {
    bucket = { attempts: 0, windowStart: now, blockedUntil: 0 };
    buckets.set(ip, bucket);
  }

  if (bucket.blockedUntil > now) {
    const remaining = Math.ceil((bucket.blockedUntil - now) / 1000);
    return { allowed: false, status: 429, error: `Too many attempts. Try again in ${remaining}s` };
  }

  if (now - bucket.windowStart > WINDOW_MS) {
    bucket.attempts = 0;
    bucket.windowStart = now;
  }

  bucket.attempts += 1;

  if (bucket.attempts > MAX_ATTEMPTS) {
    bucket.blockedUntil = now + BLOCK_MS;
    return { allowed: false, status: 429, error: "Too many attempts. Blocked for 5 minutes" };
  }

  return { allowed: true };
}

export function resetRateLimit() {
  buckets.clear();
}