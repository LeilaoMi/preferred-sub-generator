import fs from "node:fs/promises";

const REQUIRED_FILES = [
  "public/index.html",
  "public/admin.html",
  "functions/sub.js",
  "functions/best.js",
  "functions/status.js",
  "functions/api/template.js",
  "scripts/update-kv.js",
  "sources/edge/manual.txt",
  "sources/edge/remote.json",
  ".github/workflows/update.yml",
  "wrangler.toml",
  "docs/deploy-checklist.md",
  "docs/cloudflare-setup.md",
];

export function checkWranglerToml(content) {
  const issues = [];
  if (!content.includes('pages_build_output_dir = "public"')) {
    issues.push("wrangler.toml 缺少 pages_build_output_dir = \"public\"");
  }
  if (!content.includes('binding = "SUB_KV"')) {
    issues.push("wrangler.toml 缺少 SUB_KV 绑定");
  }
  if (content.includes("replace_with_cloudflare_kv_namespace_id")) {
    issues.push("wrangler.toml 的 KV Namespace ID 仍是占位符");
  }
  return issues;
}

export function checkWorkflow(content) {
  const issues = [];
  for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_NAMESPACE_ID", "ORIGINAL_SUB_OR_NODE"]) {
    if (!content.includes(name)) issues.push(`GitHub Actions 缺少 ${name}`);
  }
  return issues;
}

export function checkHomepage(content) {
  const issues = [];
  if (!content.includes('lang="zh-CN"')) issues.push("首页未设置 lang=zh-CN");
  if (!content.includes("/status")) issues.push("首页未读取 /status");
  if (content.includes("secret-token")) issues.push("首页包含测试 token");
  return issues;
}

async function exists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runPreflight(root = process.cwd()) {
  const issues = [];

  for (const file of REQUIRED_FILES) {
    if (!(await exists(`${root}/${file}`))) {
      issues.push(`缺少文件：${file}`);
    }
  }

  if (await exists(`${root}/wrangler.toml`)) {
    issues.push(...checkWranglerToml(await fs.readFile(`${root}/wrangler.toml`, "utf8")));
  }
  if (await exists(`${root}/.github/workflows/update.yml`)) {
    issues.push(...checkWorkflow(await fs.readFile(`${root}/.github/workflows/update.yml`, "utf8")));
  }
  if (await exists(`${root}/public/index.html`)) {
    issues.push(...checkHomepage(await fs.readFile(`${root}/public/index.html`, "utf8")));
  }

  return issues;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const issues = await runPreflight();
  if (issues.length > 0) {
    console.error("部署前检查未通过：");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log("部署前检查通过");
}
