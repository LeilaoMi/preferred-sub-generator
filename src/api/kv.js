import { parseVlessUri } from "../parser/vless.js";

export async function readRawTemplate(kv) {
  const value = await kv.get("TEMPLATE");
  if (!value) throw new Error("Missing TEMPLATE");
  return value;
}

export async function readTemplate(kv) {
  const value = await readRawTemplate(kv);
  if (value.trim().startsWith("vless://")) {
    return parseVlessUri(value.trim());
  }

  return JSON.parse(value);
}

export async function writeTemplate(kv, value) {
  await kv.put("TEMPLATE", value);
}

export async function readBestIps(kv) {
  const value = await kv.get("BEST_IPS");
  if (!value) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

export async function readStatus(kv) {
  const value = await kv.get("STATUS");
  if (!value) return { updatedAt: null, available: 0 };
  return JSON.parse(value);
}
