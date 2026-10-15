import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("homepage is Chinese, paste-link-to-generate (no template)", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /优选订阅生成器/);
  assert.match(html, /节点链接/);
  assert.match(html, /生成优选订阅/);
  assert.match(html, /parseVlessLink/);
  assert.match(html, /buildSubscriptionUrl/);
  assert.match(html, /项目本身不保存任何模板/);
  assert.match(html, /function escapeHtml/);
  assert.match(html, /复制/);
  assert.doesNotMatch(html, /secret-token/);
  assert.doesNotMatch(html, /保存模板/);
  assert.doesNotMatch(html, /id="adminToken"/);
  assert.doesNotMatch(html, /id="coloFilter"/);
});

test("admin page is Chinese, read-only node config", async () => {
  const html = await fs.readFile(new URL("../public/admin.html", import.meta.url), "utf8");

  assert.match(html, /节点配置/);
  assert.match(html, /环境变量/);
  assert.match(html, /VLESS_UUID/);
  assert.match(html, /读取当前配置/);
  assert.match(html, /warnBox/);
  assert.match(html, /function escapeHtml/);
  assert.doesNotMatch(html, /secret-token/);
  assert.doesNotMatch(html, /保存模板/);
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

test("static pages ship security headers and the legacy nested admin page is gone", async () => {
  const headers = await fs.readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  await assert.rejects(fs.access(new URL("../public/admin/index.html", import.meta.url)));
});

