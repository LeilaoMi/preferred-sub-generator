// 读取 config/instance.json 中属于当前仓库（GITHUB_REPOSITORY）的配置，写进 process.env。
// 复刻的仓库名不同，不会继承原作者的域名等配置，零配置复刻不受影响。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = new Set(["CHECK_HOSTS", "SUB_DEFAULT_ISP", "VLESS_HOST", "VLESS_SNI", "SUB_DOMAIN", "CN_COMBO_TOP", "SUB_ROTATE_HOSTS", "PUBLIC_CN_VERIFIED", "COMMUNITY_POOL_URL", "CN_PROBE_BUDGET"]);

export function resolveInstanceConfig(config, repository) {
  const entry = config && repository ? config[repository] : null;
  if (!entry || typeof entry !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (ALLOWED.has(key) && (typeof value === "string" || typeof value === "number")) out[key] = String(value);
  }
  return out;
}

export function applyInstanceConfig(env = process.env, file) {
  const target = file || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../config/instance.json");
  let config = null;
  try { config = JSON.parse(fs.readFileSync(target, "utf8")); } catch { return {}; }
  const values = resolveInstanceConfig(config, env.GITHUB_REPOSITORY);
  Object.assign(env, values);
  return values;
}
