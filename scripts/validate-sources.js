import fs from "node:fs/promises";

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/\d{1,2})?(:\d{1,5})?$/;
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;
const FORBIDDEN = /proxyip|socks|nat64|中转|公益/i;

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
    if (line.includes(":") && line.includes("[")) return;
    if (!IPV4.test(line) && !HOST.test(line)) {
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
