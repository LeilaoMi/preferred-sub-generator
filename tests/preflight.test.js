import test from "node:test";
import assert from "node:assert/strict";
import { checkHomepage, checkWorkflow, checkWranglerToml } from "../scripts/preflight.js";

test("preflight detects wrangler placeholder", () => {
  const issues = checkWranglerToml(`
pages_build_output_dir = "public"
[[kv_namespaces]]
binding = "SUB_KV"
id = "replace_with_cloudflare_kv_namespace_id"
`);

  assert.deepEqual(issues, ["wrangler.toml 的 KV Namespace ID 仍是占位符"]);
});

test("preflight accepts configured wrangler", () => {
  const issues = checkWranglerToml(`
pages_build_output_dir = "public"
[[kv_namespaces]]
binding = "SUB_KV"
id = "abc123"
`);

  assert.deepEqual(issues, []);
});

test("preflight checks workflow secrets names", () => {
  const workflow = "CLOUDFLARE_API_TOKEN_2 CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_NAMESPACE_ID npm run preflight permissions: contents: read concurrency: timeout-minutes:";

  assert.deepEqual(checkWorkflow(workflow), []);
});

test("preflight requires workflow hardening controls", () => {
  const workflow = "CLOUDFLARE_API_TOKEN_2 CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_NAMESPACE_ID npm run preflight";
  const issues = checkWorkflow(workflow);

  assert.match(issues.join("\n"), /permissions/);
  assert.match(issues.join("\n"), /concurrency/);
  assert.match(issues.join("\n"), /timeout-minutes/);
});

test("preflight checks homepage safety", () => {
  // 默认公开模式：首页零门槛，不要求管理 token / read-token
  const html = '<html lang="zh-CN"><script>fetch("/status");</script></html>';

  assert.deepEqual(checkHomepage(html), []);
});

test("preflight rejects hardcoded tokens on homepage", () => {
  const html = '<html lang="zh-CN"><script>fetch("/status"); const t = "secret-token";</script></html>';

  assert.match(checkHomepage(html).join("\n"), /测试 token/);
});
