// 信誉 quarantine（借鉴 whypuss/cfnew-ycat 的思路）
// 连续失败的 IP 自动隔离，冷却后自动放回

const QUARANTINE_KEY = "IP_QUARANTINE";
const QUARANTINE_THRESHOLD = 3; // 连续失败 3 次进入隔离
const QUARANTINE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 小时冷却

export async function readQuarantine(kv) {
  try {
    const raw = await kv.get(QUARANTINE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

export async function writeQuarantine(kv, data) {
  await kv.put(QUARANTINE_KEY, JSON.stringify(data));
}

// 根据评分更新隔离名单
// scores: Map(address -> { failed, samples, successRate, unreachable })
export function updateQuarantine(quarantine, scores, now = Date.now()) {
  const updated = { ...quarantine };
  let changed = false;

  for (const [address, score] of scores) {
    const entry = updated[address] || { fails: 0, quarantinedAt: 0 };
    
    // 冷却期过了，清除隔离
    if (entry.quarantinedAt > 0 && now - entry.quarantinedAt > QUARANTINE_COOLDOWN_MS) {
      delete updated[address];
      changed = true;
      continue;
    }
    
    // 已在隔离中，跳过
    if (entry.quarantinedAt > 0) continue;
    
    // 失败率过高，累计
    if (score.unreachable || (score.failed > 0 && score.successRate !== null && score.successRate < 0.3)) {
      entry.fails += 1;
      if (entry.fails >= QUARANTINE_THRESHOLD) {
        entry.quarantinedAt = now;
      }
      updated[address] = entry;
      changed = true;
    } else if (score.successRate !== null && score.successRate >= 0.7) {
      // 恢复良好，清除累计
      if (entry.fails > 0) {
        delete updated[address];
        changed = true;
      }
    }
  }
  
  return { quarantine: updated, changed };
}

// 检查 IP 是否在隔离中
export function isQuarantined(quarantine, address, now = Date.now()) {
  const entry = quarantine[address];
  if (!entry || !entry.quarantinedAt) return false;
  // 冷却期过了视为不在隔离
  if (now - entry.quarantinedAt > QUARANTINE_COOLDOWN_MS) return false;
  return true;
}

// 过滤掉被隔离的节点
export function filterQuarantined(nodes, quarantine, now = Date.now()) {
  return nodes.filter((node) => !isQuarantined(quarantine, node.address, now));
}
