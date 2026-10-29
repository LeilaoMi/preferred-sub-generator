#!/usr/bin/env node
import fs from "node:fs/promises";
import net from "node:net";
import tls from "node:tls";
import { parseArgs } from "node:util";
import { filterNodesByColo, parseColoFilter } from "../src/api/node-filter.js";
import { downloadSpeed } from "./lib/speed.js";

const HELP = `用法: node scripts/probe-ips.js [选项]

从本机实测每个优选 IP 的 TCP 握手延迟、落地 COLO 和下载带宽，
回传到 /api/ip-feedback，之后订阅会按你的实测结果重排。

选项:
  --site <url>          站点地址（默认 env SITE_URL，如 https://yxdy.woniu.bee.al）
  --token <token>       管理 token（默认 env SUB_TOKEN；无 token 时加 --no-submit 只测不回传）
  --n <count>           探测节点数量（默认 50）
  --samples <n>         每个 IP 的 TCP 握手采样次数（默认 3）；成功数过半才算可用，
                        延迟取中位数，可筛掉时通时断的抖动节点；1 表示单次（旧行为）
  --speed <MB>          每个 IP 下载测速大小，默认 2；0 表示只测延迟
  --sni <host>          测速用 SNI/Host（默认取订阅模板的域名，取不到才用 speed.cloudflare.com）
  --slot <n>            取哪个账号槽位的模板（1-5），决定默认 SNI
  --colo <list>         只探测指定 COLO，如 HKG,NRT；auto 表示你的接入点
  --concurrency <n>     延迟探测并发（默认 8）
  --timeout <ms>        单项超时（默认 5000）
  --json <file>         额外把结果写成 JSON 文件
  --pool                拉整个过审池（最多 300，rank=off）逐个实测，而不是只测排名前 n 个
  --force               跳过"本机是否在国内直连"检查（默认检测到走代理/不在 CN 会中止）
  --no-submit           只打印结果，不回传
  --help                显示帮助

示例:
  node scripts/probe-ips.js --site https://yxdy.woniu.bee.al --token "$SUB_TOKEN"
  node scripts/probe-ips.js --slot 2 --speed 5 --colo auto
  node scripts/probe-ips.js --sni 2.leilaomi.ccwu.cc
`;

function parseTrace(text) {
  const body = String(text || "").split(/\r?\n\r?\n/).slice(1).join("\r\n\r\n") || String(text || "");
  const colo = (body.match(/colo=(\w+)/) || [])[1] || "";
  const region = (body.match(/loc=(\w+)/) || [])[1] || "";
  if (!colo && !region) return null;
  return { colo: colo.toUpperCase(), region };
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function sampleStddev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 对单个 IP 做多次 TCP 握手采样：一次成功可能是运气，多次才能看出稳不稳。
// 返回成功延迟列表与失败次数，由 decideSample 按"成功数过半"判定可用性。
export async function sampleTcpRtt(address, port, { samples = 3, timeoutMs = 5000, delayMs = 800, tcpRttImpl = tcpRtt } = {}) {
  const rtts = [];
  let failures = 0;
  for (let i = 0; i < samples; i += 1) {
    if (i > 0) await sleep(delayMs);
    const rtt = await tcpRttImpl(address, port, timeoutMs);
    if (rtt === null) failures += 1;
    else rtts.push(rtt);
  }
  return { rtts, failures };
}

// 成功数过半才算可用（默认 3 次里至少成功 2 次）；延迟取中位数，抗单次毛刺。
export function decideSample(rtts, samples) {
  const need = Math.ceil(samples / 2);
  if (rtts.length < need) return { ok: false, rtt: null };
  return { ok: true, rtt: median(rtts) };
}

function tcpRtt(address, port, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host: address, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok ? Date.now() - startedAt : null);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function traceEdge(address, port, { servername, timeoutMs }) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: address, port, servername, rejectUnauthorized: false });
    let done = false;
    let buffer = "";
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("secureConnect", () => {
      socket.write(`GET /cdn-cgi/trace HTTP/1.1\r\nHost: ${servername}\r\nConnection: close\r\nAccept: */*\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\r\n\r\n")) finish(parseTrace(buffer));
    });
    socket.once("end", () => finish(parseTrace(buffer)));
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
  });
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function fetchOwnLoc(timeoutMs) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    const text = await response.text();
    return (text.match(/loc=(\w+)/) || [])[1] || "";
  } catch {
    return "";
  }
}

export async function fetchReadToken(site, token) {
  const response = await fetch(`${site}/api/read-token`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  // 未配置只读 token 时服务端只返回 { configured: false }，此时绝不能把管理 token
  // 当成只读 token 回退：它会被拼进 /best?t= 与打印的订阅 URL，造成管理 token 泄露。
  return data.readToken || "";
}

async function fetchNodes(site, readToken, count, { pool = false } = {}) {
  const tokenQuery = readToken ? `&t=${encodeURIComponent(readToken)}` : "";
  const response = await fetch(`${site}/best?n=${count}${pool ? "&rank=off" : ""}${tokenQuery}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`拉取优选列表失败 ${response.status}: ${data.error || "unknown"}`);
  }
  if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
    throw new Error("优选列表为空");
  }
  return data.nodes;
}

async function fetchTemplateHost(site, token, slot) {
  const query = slot ? `?slot=${encodeURIComponent(slot)}` : "";
  try {
    const response = await fetch(`${site}/api/template${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { host: "", key: "" };
    const safe = data.templateSafe || {};
    // 域名前置时 TLS SNI 必须用 sni（干净域名），不能用 host（可能被 SNI 阻断）
    return { host: String(safe.sni || safe.host || "").trim(), key: String(data.key || "") };
  } catch {
    return { host: "", key: "" };
  }
}

async function fetchOwnColo(site, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 3000));
  try {
    const response = await fetch(`${site}/cdn-cgi/trace`, { cache: "no-store", signal: controller.signal });
    const text = await response.text();
    return parseTrace(text)?.colo || "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function printTable(results) {
  const rows = results.map((item, index) => [
    String(index + 1),
    item.address,
    String(item.port ?? "-"),
    item.rtt == null ? "-" : `${item.rtt}ms`,
    item.jitter == null ? "-" : `±${item.jitter}ms`,
    item.colo || "-",
    item.region || "-",
    item.speed == null ? "-" : `${item.speed} Mbps`,
  ]);
  const header = ["#", "地址", "端口", "RTT", "抖动", "COLO", "地区", "带宽"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => [...row[column]].length)));
  const line = (row) => row.map((cell, column) => cell + " ".repeat(widths[column] - [...cell].length)).join("  ");
  console.log(line(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
}

async function main() {
  const { values } = parseArgs({
    options: {
      site: { type: "string" },
      token: { type: "string" },
      n: { type: "string", default: "50" },
      samples: { type: "string", default: "3" },
      speed: { type: "string", default: "2" },
      sni: { type: "string" },
      slot: { type: "string" },
      colo: { type: "string", default: "" },
      concurrency: { type: "string", default: "8" },
      timeout: { type: "string", default: "5000" },
      json: { type: "string" },
      "no-submit": { type: "boolean", default: false },
      pool: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const site = String(values.site || process.env.SITE_URL || "").replace(/\/+$/, "");
  const token = values.token || process.env.SUB_TOKEN || "";
  if (!site) throw new Error("缺少 --site 或 SITE_URL");
  // token 可选：无 token 时需用 --sni 指定探测域名，且跳过反馈提交

  const count = values.pool ? 300 : Math.max(1, Math.min(Number(values.n) || 50, 200));
  const samples = Math.max(1, Math.min(Number(values.samples) || 3, 5));
  const speedMb = Math.max(0, Number(values.speed) || 0);
  const timeoutMs = Math.max(1000, Number(values.timeout) || 5000);
  const concurrency = Math.max(1, Math.min(Number(values.concurrency) || 8, 32));

  const explicitSni = String(values.sni || "").trim();
  let servername = explicitSni;
  let templateKey = "";
  if (!servername) {
    const template = await fetchTemplateHost(site, token, values.slot);
    servername = template.host;
    templateKey = template.key;
  }
  if (!servername) servername = "speed.cloudflare.com";

  console.log(`站点: ${site}`);
  console.log(`探测 SNI/Host: ${servername}${
    explicitSni ? "（--sni 指定）"
      : templateKey ? `（模板 ${templateKey}）`
        : "（未取到模板，回退）"
  }`);
  const readToken = await fetchReadToken(site, token);
  if (!values.force) {
    // 实测必须是"国内直连"视角：手机开着代理/VPN 时测到的是代理出口的线路，回传只会污染排序
    const loc = await fetchOwnLoc(timeoutMs);
    if (loc && loc !== "CN") {
      throw new Error(`当前出口地区是 ${loc}，看起来开着代理/VPN。请先关掉代理再测（确实要测加 --force）`);
    }
    if (loc) console.log("出口地区: CN（直连）");
  }
  let nodes = await fetchNodes(site, readToken, count, { pool: values.pool });
  console.log(`候选节点: ${nodes.length} 个`);

  const { colos } = parseColoFilter(values.colo, null);
  if (values.colo && colos.length === 0) {
    const ownColo = await fetchOwnColo(site, timeoutMs);
    if (ownColo) colos.push(ownColo);
  }
  if (colos.length > 0) {
    const filtered = filterNodesByColo(nodes, colos);
    nodes = filtered.nodes;
    console.log(`线路过滤 ${colos.join(",")}: ${filtered.matched ? `${nodes.length} 个匹配` : "无匹配，已回退全量"}`);
  }

  console.log(`1/2 测量 TCP 握手延迟与落地 COLO（每个 IP 握手 ${samples} 次，成功过半才算可用）…`);
  const probed = await pool(nodes, concurrency, async (node) => {
    const address = String(node.address || "");
    const port = Number(node.port) || 443;
    const { rtts, failures } = await sampleTcpRtt(address, port, { samples, timeoutMs });
    const decision = decideSample(rtts, samples);
    if (!decision.ok) {
      return { address, port, rtt: null, jitter: null, colo: "", region: "", speed: null, ok: false };
    }
    const jitter = Math.round(sampleStddev(rtts) * 10) / 10;
    const trace = await traceEdge(address, port, { servername, timeoutMs });
    return {
      address,
      port,
      rtt: Math.round(decision.rtt * 10) / 10,
      jitter,
      colo: trace?.colo || "",
      region: trace?.region || "",
      speed: null,
      // TCP 通了但对该域名拿不到可用回包（如 1034 拦截、非 2xx）也算不可用
      ok: Boolean(trace),
    };
  });

  const alive = probed.filter((item) => item.ok);
  const unreachable = probed.filter((item) => !item.ok);
  if (alive.length === 0) throw new Error("所有节点都连不上，请检查网络");
  if (unreachable.length > 0) {
    const list = unreachable.map((item) => item.address);
    console.log(`   ${unreachable.length} 个节点不可用（连不上 / 握手抖动 / 对该域名返回非 2xx）：${list.slice(0, 8).join(", ")}${list.length > 8 ? " …" : ""}`);
  }

  if (speedMb > 0) {
    const bytes = Math.round(speedMb * 1000000);
    console.log(`2/2 测量下载带宽（每个 ${speedMb}MB，并发 2）…`);
    await pool(alive, 2, async (item) => {
      item.speed = await downloadSpeed(item.address, item.port, { bytes, timeoutMs: Math.max(timeoutMs, 15000) });
      return item;
    });
  } else {
    console.log("2/2 跳过带宽测试（--speed 0）");
  }

  alive.sort((a, b) => (a.rtt - b.rtt) || ((b.speed || 0) - (a.speed || 0)));
  console.log("");
  printTable(alive);
  console.log("");

  if (values.json) {
    await fs.writeFile(values.json, JSON.stringify(alive, null, 2), "utf8");
    console.log(`结果已写入 ${values.json}`);
  }

  if (values["no-submit"] || !token) {
    console.log(token ? "--no-submit：未回传。" : "无 token，跳过回传（结果仅本地显示）。");
    return;
  }

  // 服务端单次最多 200 条，分批回传
  let saved = 0;
  let storage = "";
  for (let i = 0; i < probed.length; i += 200) {
    const response = await fetch(`${site}/api/ip-feedback`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // 连不上的也一并回传（ok:false），服务端据此剔除不可用 IP
      body: JSON.stringify({ results: probed.slice(i, i + 200) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(`回传失败 ${response.status}: ${data.error || "unknown"}`);
    }
    saved += Number(data.saved) || 0;
    storage = data.storage || storage;
  }
  const data = { saved, storage };
  console.log(`已回传 ${data.saved} 条实测数据（可用 ${alive.length} / 不可用 ${unreachable.length}，${data.storage}）。`);
  const subUrl = readToken ? `${site}/sub?type=v2rayng&t=${readToken}` : `${site}/sub?type=v2rayng`;
  console.log(`订阅地址（按你的实测重排）: ${subUrl}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`失败: ${error.message}`);
    process.exitCode = 1;
  });
}
