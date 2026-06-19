import { jsonResponse } from "../utils/response.js";
import { readStatus } from "./kv.js";

const STALE_MS = 12 * 60 * 60 * 1000;
const UNHEALTHY_MS = 24 * 60 * 60 * 1000;

function ageMs(updatedAt, now) {
  const ts = Date.parse(updatedAt || "");
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, now - ts);
}

export async function handleStatus(request, env) {
  const status = await readStatus(env.SUB_KV);
  const fallbackActive = Boolean(status.protectedByPrevious);
  const lastError = status.lastError || null;
  const now = Date.parse(env.STATUS_NOW || "") || Date.now();
  const age = ageMs(status.updatedAt, now);
  const stale = age !== null && age > STALE_MS;
  const unhealthy = age !== null && age > UNHEALTHY_MS;
  const semanticStatus = lastError ? (fallbackActive ? "fallback" : "error") : unhealthy ? "unhealthy" : stale ? "stale" : "ok";

  return jsonResponse({
    updatedAt: status.updatedAt || null,
    available: status.available || 0,
    newAvailable: status.newAvailable || 0,
    sourceCount: status.sourceCount || 0,
    checked: status.checked || 0,
    fallbackActive,
    lastError,
    stale,
    unhealthy,
    ageSeconds: age === null ? null : Math.round(age / 1000),
    speedtestLocation: status.speedtestLocation || null,
    speedTestNote: status.speedTestNote || null,
    averageSpeed: status.averageSpeed ?? null,
    averageLatency: status.averageLatency ?? null,
    status: semanticStatus,
  });
}
