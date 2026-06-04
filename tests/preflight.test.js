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
  const html = '<html lang="zh-CN"><script>fetch("/status"); fetch("/api/read-token"); fetch("/api/template", { headers: { Authorization: `Bearer token` } });</script></html>';

  assert.deepEqual(checkHomepage(html), []);
});
