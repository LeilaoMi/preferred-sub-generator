import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootstrap, renderWrangler } from "../scripts/cf-bootstrap.js";

function mockCf(routes) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const key = `${opts.method || "GET"} ${String(url).replace("https://api.cloudflare.com/client/v4", "").split("?")[0]}`;
    calls.push(key);
    const hit = routes[key];
    if (!hit) return new Response(JSON.stringify({ success: false }), { status: 404 });
    return new Response(JSON.stringify({ success: true, result: hit }), { status: 200 });
  };
  return { fetchImpl, calls };
}

async function tmpToml(content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "boot-"));
  const file = path.join(dir, "wrangler.toml");
  await fs.writeFile(file, content);
  return file;
}

test("复刻者：KV / D1 / Pages 全部自动新建", async () => {
  const { fetchImpl, calls } = mockCf({
    "GET /accounts/acc/storage/kv/namespaces": [],
    "POST /accounts/acc/storage/kv/namespaces": { id: "newkv" },
    "GET /accounts/acc/d1/database": [],
    "POST /accounts/acc/d1/database": { uuid: "newd1" },
    "POST /accounts/acc/pages/projects": { name: "preferred-sub-generator" },
  });
  const file = await tmpToml(renderWrangler({ project: "preferred-sub-generator", kvId: "oldkv", d1Id: "oldd1", d1Name: "speed-feedback" }));
  const r = await bootstrap({ env: { CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "t", BOOTSTRAP_PAGES: "1" }, fetchImpl, wranglerPath: file });
  assert.equal(r.kv.id, "newkv");
  assert.equal(r.d1.id, "newd1");
  assert.equal(r.pages.created, true);
  const toml = await fs.readFile(file, "utf8");
  assert.match(toml, /id = "newkv"/);
  assert.match(toml, /database_id = "newd1"/);
  assert.ok(calls.includes("POST /accounts/acc/pages/projects"));
});

test("原部署：已有 NAMESPACE secret 不新建，D1 查询无权限时沿用仓库里的 id", async () => {
  const { fetchImpl, calls } = mockCf({});
  const file = await tmpToml(renderWrangler({ project: "preferred-sub-generator", kvId: "kv1", d1Id: "d1-keep", d1Name: "speed-feedback" }));
  const r = await bootstrap({ env: { CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_NAMESPACE_ID: "kv1" }, fetchImpl, wranglerPath: file });
  assert.equal(r.kv.id, "kv1");
  assert.equal(r.d1.id, "d1-keep");
  assert.ok(!calls.some((c) => c.startsWith("POST /accounts/acc/storage")));
});

test("D1 建不了时去掉绑定，回传降级为 KV", async () => {
  const { fetchImpl } = mockCf({ "GET /accounts/acc/storage/kv/namespaces": [{ id: "k", title: "preferred-sub-generator-kv" }] });
  const file = await tmpToml("");
  const r = await bootstrap({ env: { CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "t" }, fetchImpl, wranglerPath: file });
  assert.equal(r.kv.id, "k");
  assert.equal(r.d1.skipped, true);
  assert.doesNotMatch(await fs.readFile(file, "utf8"), /d1_databases/);
});
