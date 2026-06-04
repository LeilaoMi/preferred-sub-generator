const buckets = new Map();

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const BLOCK_MS = 300_000;
const MAX_BUCKETS = 5_000;
let cleanupCounter = 0;

function getClientIp(request) {
  const xff = request.headers.get("x-forwarded-for") || "";
  return request.headers.get("cf-connecting-ip") || xff.split(",")[0].trim() || "unknown";
}

function cleanupBuckets(now) {
  cleanupCounter += 1;
  if (cleanupCounter % 100 !== 0 && buckets.size <= MAX_BUCKETS) return;

  for (const [ip, bucket] of buckets) {
    const activeBlock = bucket.blockedUntil > now;
    const activeWindow = now - bucket.windowStart <= WINDOW_MS;
    if (!activeBlock && !activeWindow) buckets.delete(ip);
  }

  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

export function checkRateLimit(request) {
  const ip = getClientIp(request);
  const now = Date.now();
  cleanupBuckets(now);
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