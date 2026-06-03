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

export async function readBestIpsVersion(kv, version) {
  if (!version) return readBestIps(kv);
  const key = version === "last" ? "BEST_IPS_LAST" : `BEST_IPS_${version}`;
  const value = await kv.get(key);
  if (!value) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

export async function readStatus(kv) {
  const value = await kv.get("STATUS");
  if (!value) return { updatedAt: null, available: 0 };
  return JSON.parse(value);
}
