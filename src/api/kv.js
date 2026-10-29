import { parseVlessUri } from "../parser/vless.js";

export async function readRawTemplate(kv, key = "TEMPLATE") {
  const value = await kv.get(key);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

export async function readTemplate(kv, key = "TEMPLATE") {
  const value = await readRawTemplate(kv, key);
  if (value.trim().startsWith("vless://")) {
    return parseVlessUri(value.trim());
  }

  return JSON.parse(value);
}

export async function writeTemplate(kv, value, key = "TEMPLATE") {
  await kv.put(key, value);
}

export async function readBestIps(kv) {
  const value = await kv.get("BEST_IPS");
  if (!value) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

// 待国内验证的反代 IP（美国初筛连不上，交给国内三网探针验证）
export async function readPendingCnIps(kv) {
  try {
    const value = await kv.get("CN_PENDING_IPS");
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// P2-6: 未实测 IPv6 独立池
// IPv6 只是追加节点：KV 损坏时降级为空列表，不能拖垮整条订阅。
export async function readBestIpsV6(kv) {
  try {
    const value = await kv.get("BEST_IPS_V6");
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function readBestIpsVersion(kv, version) {
  if (!version) return readBestIps(kv);
  const key = version === "last" ? "BEST_IPS_LAST" : `BEST_IPS_${version}`;
  const value = await kv.get(key);
  if (!value) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

export async function readBestIpVersions(kv) {
  try {
    const value = await kv.get("BEST_IPS_VERSION_INDEX");
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function readStatus(kv) {
  try {
    const value = await kv.get("STATUS");
    if (!value) return { updatedAt: null, available: 0 };
    return JSON.parse(value);
  } catch {
    return { updatedAt: null, available: 0 };
  }
}
