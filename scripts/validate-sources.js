import fs from "node:fs/promises";

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/\d{1,2})?(:\d{1,5})?$/;
const IPV6_BARE = /^[0-9a-f:]+(\/\d{1,3})?$/i;
const IPV6_BRACKET = /^\[[0-9a-f:]+\](:\d{1,5})?$/i;
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;
const FORBIDDEN = /proxyip|socks|nat64|中转|公益/i;

// 与 scripts/lib/candidates.js 保持一致：# 之后是备注（如 cf-termux-pick 的 IP#v4-SJC）
function stripRemark(line) {
  return line.split("#")[0].trim();
}

export function validateManualSource(text) {
  const issues = [];
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  entries.forEach((line, index) => {
    const lineNumber = index + 1;
    if (FORBIDDEN.test(line)) {
      issues.push(`第 ${lineNumber} 行疑似混入非 Cloudflare Edge 源：${line}`);
      return;
    }
    const addr = stripRemark(line);
    if (IPV6_BRACKET.test(addr)) return;
    if (addr.includes(":") && addr.split(":").length > 2 && IPV6_BARE.test(addr)) return;
    if (!IPV4.test(addr) && !HOST.test(addr)) {
      issues.push(`第 ${lineNumber} 行格式不支持：${line}`);
    }
  });

  return issues;
}

export async function main(root = process.cwd()) {
  const text = await fs.readFile(`${root}/sources/edge/manual.txt`, "utf8");
  const issues = validateManualSource(text);
  if (issues.length > 0) {
    console.error("手动源校验未通过：");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log("手动源校验通过");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
