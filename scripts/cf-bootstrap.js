#!/usr/bin/env node
// 零门槛部署：复刻者只需要在仓库填 CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID 两个 secret。
// 本脚本在 Actions 里自动：找到或创建 KV 命名空间 / D1 数据库 / Pages 项目，
// 并把它们的 id 写进 wrangler.toml（部署用）和 $GITHUB_ENV（后续步骤用）。
// 已手动配置 CLOUDFLARE_NAMESPACE_ID 的老部署照常使用原命名空间，不会新建。
import fs from "node:fs/promises";

const API = "https://api.cloudflare.com/client/v4";
export const DEFAULTS = {
  project: "preferred-sub-generator",
  kvTitle: "preferred-sub-generator-kv",
  d1Name: "speed-feedback",
};

async function cf(path, { token, method = "GET", body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok && data.success !== false, result: data.result, errors: data.errors };
}

export async function ensureKv({ account, token, title, presetId, fetchImpl }) {
  if (presetId) return { id: presetId, created: false };
  for (let page = 1; page <= 10; page += 1) {
    const list = await cf(`/accounts/${account}/storage/kv/namespaces?per_page=100&page=${page}`, { token, fetchImpl });
    if (!list.ok) throw new Error(`列出 KV 失败 ${list.status}：请确认 token 有 Workers KV Storage 编辑权限`);
    const hit = (list.result || []).find((ns) => ns.title === title);
    if (hit) return { id: hit.id, created: false };
    if (!list.result || list.result.length < 100) break;
  }
  const created = await cf(`/accounts/${account}/storage/kv/namespaces`, { token, method: "POST", body: { title }, fetchImpl });
  if (!created.ok) throw new Error(`创建 KV 失败 ${created.status}`);
  return { id: created.result.id, created: true };
}

// D1 是可选的（没有时测速回传走 KV），所以失败只告警不中断
export async function ensureD1({ account, token, name, fallbackId, fetchImpl }) {
  const list = await cf(`/accounts/${account}/d1/database?name=${encodeURIComponent(name)}`, { token, fetchImpl });
  if (list.ok) {
    const hit = (list.result || []).find((db) => db.name === name);
    if (hit) return { id: hit.uuid, created: false };
    const created = await cf(`/accounts/${account}/d1/database`, { token, method: "POST", body: { name }, fetchImpl });
    if (created.ok) return { id: created.result.uuid, created: true };
  }
  if (fallbackId) return { id: fallbackId, created: false, assumed: true };
  return { id: "", created: false, skipped: true };
}

export async function ensurePagesProject({ account, token, project, fetchImpl }) {
  const got = await cf(`/accounts/${account}/pages/projects/${project}`, { token, fetchImpl });
  if (got.ok) return { created: false };
  if (got.status !== 404) return { created: false, unknown: true };
  const created = await cf(`/accounts/${account}/pages/projects`, { token, method: "POST", body: { name: project, production_branch: "main" }, fetchImpl });
  if (!created.ok) throw new Error(`创建 Pages 项目失败 ${created.status}：请确认 token 有 Cloudflare Pages 编辑权限`);
  return { created: true };
}

export function renderWrangler({ project, kvId, d1Id, d1Name, compatibilityDate = "2026-06-03" }) {
  let text = `name = "${project}"\npages_build_output_dir = "public"\ncompatibility_date = "${compatibilityDate}"\n\n[[kv_namespaces]]\nbinding = "SUB_KV"\nid = "${kvId}"\n`;
  if (d1Id) text += `\n[[d1_databases]]\nbinding = "SPEED_DB"\ndatabase_name = "${d1Name}"\ndatabase_id = "${d1Id}"\n`;
  return text;
}

function readCommitted(toml, key) {
  const match = toml.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`));
  return match ? match[1] : "";
}

export async function bootstrap({ env = process.env, fetchImpl = fetch, wranglerPath = "wrangler.toml" } = {}) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("请在仓库 Settings → Secrets → Actions 里填 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID");
  const project = env.PAGES_PROJECT || DEFAULTS.project;
  const committed = await fs.readFile(wranglerPath, "utf8").catch(() => "");

  const kv = await ensureKv({ account, token, title: env.KV_TITLE || DEFAULTS.kvTitle, presetId: env.CLOUDFLARE_NAMESPACE_ID, fetchImpl });
  // 只有原作者账号里才有仓库里写死的 D1 id；复刻者账号查不到会自动新建
  const d1 = await ensureD1({ account, token, name: DEFAULTS.d1Name, fallbackId: env.CLOUDFLARE_NAMESPACE_ID ? readCommitted(committed, "database_id") : "", fetchImpl });
  const pages = env.BOOTSTRAP_PAGES === "1" ? await ensurePagesProject({ account, token, project, fetchImpl }) : { created: false };

  await fs.writeFile(wranglerPath, renderWrangler({ project, kvId: kv.id, d1Id: d1.id, d1Name: DEFAULTS.d1Name, compatibilityDate: readCommitted(committed, "compatibility_date") || undefined }));
  if (env.GITHUB_ENV) {
    await fs.appendFile(env.GITHUB_ENV, `CLOUDFLARE_NAMESPACE_ID=${kv.id}\nPAGES_PROJECT=${project}\n`);
  }
  console.log(`KV ${kv.created ? "已新建" : "已就绪"}；D1 ${d1.skipped ? "未启用（回传改用 KV）" : d1.created ? "已新建" : "已就绪"}；Pages 项目 ${pages.created ? "已新建" : "已就绪"}`);
  return { kv, d1, pages, project };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
