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
  const workflow = "CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_NAMESPACE_ID";

  assert.deepEqual(checkWorkflow(workflow), []);
});

test("preflight checks homepage safety", () => {
  const html = '<html lang="zh-CN"><script>fetch("/status")</script></html>';

  assert.deepEqual(checkHomepage(html), []);
});
