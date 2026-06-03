import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("homepage is Chinese, builds subscription URLs, and does not expose a real token", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /优选订阅生成器/);
  assert.match(html, /节点链接/);
  assert.match(html, /生成优选订阅/);
  assert.match(html, /粘贴你的私有 token/);
  assert.match(html, /默认格式/);
  assert.match(html, /\/status/);
  assert.match(html, /\/sub\?type=v2rayng&token=/);
  assert.match(html, /location\.origin/);
  assert.match(html, /api\/template/);
  assert.match(html, /已保存节点模板/);
  assert.equal((html.match(/id="token"/g) || []).length, 1);
  assert.equal((html.match(/id="subscriptionList"/g) || []).length, 1);
  assert.match(html, /复制/);
  assert.doesNotMatch(html, /secret-token/);
});

test("admin page is Chinese and contains api/template, preview, and save template, but does not expose secret-token", async () => {
  const html = await fs.readFile(new URL("../public/admin.html", import.meta.url), "utf8");

  assert.match(html, /订阅配置/);
  assert.match(html, /api\/template/);
  assert.match(html, /解析预览/);
  assert.match(html, /保存模板/);
  assert.doesNotMatch(html, /secret-token/);
});

test("wrangler config declares Pages output and SUB_KV binding", async () => {
  const toml = await fs.readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

  assert.match(toml, /pages_build_output_dir = "public"/);
  assert.match(toml, /binding = "SUB_KV"/);
  assert.doesNotMatch(toml, /replace_with_cloudflare_kv_namespace_id/);
  assert.match(toml, /id = "[a-f0-9]{32}"/);
});

test("deploy checklist contains required secrets and safety checks", async () => {
  const checklist = await fs.readFile(new URL("../docs/deploy-checklist.md", import.meta.url), "utf8");

  assert.match(checklist, /CLOUDFLARE_API_TOKEN/);
  assert.match(checklist, /ORIGINAL_SUB_OR_NODE/);
  assert.match(checklist, /SUB_TOKEN/);
  assert.match(checklist, /没有把真实 token 写进代码/);
});
