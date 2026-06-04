import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("homepage is Chinese, builds protected subscription URLs, and uses admin token only for template save", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /优选订阅生成器/);
  assert.match(html, /节点链接/);
  assert.match(html, /管理 token/);
  assert.match(html, /默认格式/);
  assert.match(html, /\/status/);
  assert.match(html, /\/sub\?type=v2rayng/);
  assert.match(html, /默认需要只读 token/);
  assert.match(html, /location\.origin/);
  assert.match(html, /let readToken = ""/);
  assert.match(html, /fetch\("\/api\/read-token"\)/);
  assert.match(html, /SUB_READ_TOKEN/);
  assert.match(html, /searchParams\.set\("t", readToken\)/);
  assert.match(html, /自动附带线上环境变量 SUB_READ_TOKEN/);
  assert.match(html, /不会带管理 token/);
  assert.doesNotMatch(html, /autosub/);
  assert.match(html, /api\/template/);
  assert.match(html, /Authorization/);
  assert.match(html, /已保存节点模板/);
  assert.equal((html.match(/id="adminToken"/g) || []).length, 1);
  assert.equal((html.match(/id="subscriptionList"/g) || []).length, 1);
  assert.doesNotMatch(html, /\/sub\?type=v2rayng&token=/);
  assert.doesNotMatch(html, /searchParams\.get\("token"\)/);
  assert.match(html, /history\.replaceState/);
  assert.match(html, /function escapeHtml/);
  assert.match(html, /escapeHtml\(error\.message\)/);
  assert.match(html, /escapeHtml\(value \|\| "-"\)/);
  assert.match(html, /复制/);
  assert.doesNotMatch(html, /secret-token/);
  assert.match(html, /保存并生成/);
  assert.match(html, /仅显示订阅/);
});

test("admin page is Chinese and uses admin token for api/template", async () => {
  const html = await fs.readFile(new URL("../public/admin.html", import.meta.url), "utf8");

  assert.match(html, /订阅配置/);
  assert.match(html, /管理 token/);
  assert.match(html, /api\/template/);
  assert.match(html, /Authorization/);
  assert.match(html, /解析预览/);
  assert.match(html, /保存模板/);
  assert.match(html, /function escapeHtml/);
  assert.match(html, /escapeHtml\(preview\[key\] \|\| "-"\)/);
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

  assert.match(checklist, /CLOUDFLARE_API_TOKEN_2/);
  assert.match(checklist, /SUB_TOKEN/);
  assert.match(checklist, /SUB_READ_TOKEN/);
  assert.match(checklist, /只读访问/);
});


test("nested admin page escapes preview values before rendering", async () => {
  const html = await fs.readFile(new URL("../public/admin/index.html", import.meta.url), "utf8");

  assert.match(html, /function escapeHtml/);
  assert.match(html, /escapeHtml\(preview\[key\] \|\| "-"\)/);
  assert.doesNotMatch(html, /<div class="value">\$\{preview\[key\] \|\| "-"\}<\/div>/);
});
