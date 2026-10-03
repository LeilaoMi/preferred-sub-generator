const LEVEL_RANK = { ok: 0, warn: 1, critical: 2 };

const DEFAULT_FALLBACK_THRESHOLD = 3;
const DEFAULT_MIN_AVAILABLE = 10;
const DEFAULT_DROP_RATIO = 0.3;
const DEFAULT_REPEAT_HOURS = 24;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function classifyStatus(status = {}, previousStatus = null, options = {}) {
  const fallbackThreshold = optionNumber(options.fallbackThreshold, DEFAULT_FALLBACK_THRESHOLD);
  const minAvailable = optionNumber(options.minAvailable, DEFAULT_MIN_AVAILABLE);
  const dropRatio = optionNumber(options.dropRatio, DEFAULT_DROP_RATIO);

  const available = toNumber(status.available, 0);
  const consecutiveFallbacks = toNumber(status.consecutiveFallbacks, 0);
  const previousAvailable = previousStatus ? toNumber(previousStatus.available, null) : null;
  const reasons = [];
  let level = "ok";

  const raise = (nextLevel, reason) => {
    if (LEVEL_RANK[nextLevel] > LEVEL_RANK[level]) level = nextLevel;
    reasons.push(reason);
  };

  if (available === 0) {
    raise("critical", "no-available-nodes");
  }
  if (consecutiveFallbacks >= fallbackThreshold) {
    raise("warn", "consecutive-fallbacks");
  }
  if (available > 0 && available < minAvailable) {
    raise("warn", "low-available");
  }
  if (previousAvailable !== null && previousAvailable > 0 && available < previousAvailable) {
    const dropped = (previousAvailable - available) / previousAvailable;
    if (dropped >= dropRatio) raise("warn", "available-dropped");
  }
  if (status.lastError && !status.protectedByPrevious) {
    raise("critical", "refresh-error");
  }

  return { level, reasons };
}

function sameReasons(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((reason, index) => reason === right[index]);
}

export function shouldNotify({ previousState, currentState, now = Date.now(), repeatHours = DEFAULT_REPEAT_HOURS, always = false }) {
  if (always) return { notify: true, type: "always" };

  const repeatMs = optionNumber(repeatHours, DEFAULT_REPEAT_HOURS) * 60 * 60 * 1000;
  const current = currentState || { level: "ok", reasons: [], lastSentAt: null };

  if (!previousState) {
    if (current.level === "ok") return { notify: false, type: "none" };
    return { notify: true, type: "initial" };
  }

  const previousLevel = previousState.level || "ok";
  const previousReasons = Array.isArray(previousState.reasons) ? previousState.reasons : [];
  const sameLevel = previousLevel === current.level;
  const unchanged = sameLevel && sameReasons(previousReasons, current.reasons);

  if (unchanged) {
    if (current.level === "ok") return { notify: false, type: "none" };
    const lastSentAt = Date.parse(previousState.lastSentAt || "");
    if (!Number.isFinite(lastSentAt)) return { notify: true, type: "repeat" };
    if (now - lastSentAt >= repeatMs) return { notify: true, type: "repeat" };
    return { notify: false, type: "none" };
  }

  if (current.level === "ok") return { notify: true, type: "recovery" };
  if (LEVEL_RANK[current.level] > LEVEL_RANK[previousLevel]) return { notify: true, type: "escalation" };
  if (!sameReasons(previousReasons, current.reasons)) return { notify: true, type: "change" };
  return { notify: true, type: "change" };
}

export async function runAlertStage({
  status = {},
  previousStatus = null,
  previousAlertState = null,
  now = Date.now(),
  repeatHours,
  fallbackThreshold,
  minAvailable,
  dropRatio,
  always = false,
  notify,
  saveState,
} = {}) {
  const current = classifyStatus(status, previousStatus, { fallbackThreshold, minAvailable, dropRatio });
  const decision = shouldNotify({
    previousState: previousAlertState,
    currentState: current,
    now,
    repeatHours,
    always,
  });

  let delivered = false;
  const lastSentAtBefore = previousAlertState?.lastSentAt || null;

  if (decision.notify && typeof notify === "function") {
    const result = await notify({
      event: "preferred-sub-generator.alert",
      alertType: decision.type,
      level: current.level,
      reasons: current.reasons,
      updatedAt: status.updatedAt || null,
      available: toNumber(status.available, 0),
      newAvailable: toNumber(status.newAvailable, 0),
      consecutiveFallbacks: toNumber(status.consecutiveFallbacks, 0),
      fallbackActive: Boolean(status.protectedByPrevious),
      lastError: status.lastError || null,
      lastSuccessfulRefreshAt: status.lastSuccessfulRefreshAt || null,
    });
    delivered = result !== false;
  }

  const lastSentAt = delivered ? new Date(now).toISOString() : lastSentAtBefore;
  const nextState = {
    level: current.level,
    reasons: current.reasons,
    lastNotifiedAt: delivered ? lastSentAt : (previousAlertState?.lastNotifiedAt || null),
    lastSentAt,
    updatedAt: new Date(now).toISOString(),
  };

  if (typeof saveState === "function") await saveState(nextState);

  return { level: current.level, reasons: current.reasons, notified: delivered, alertType: decision.type, state: nextState };
}

