#!/usr/bin/env node
import fs from "node:fs/promises";
import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import { parseArgs } from "node:util";
import { filterNodesByColo, parseColoFilter } from "../src/api/node-filter.js";

const HELP = `用法: node scripts/probe-ips.js [选项]

从本机实测每个优选 IP 的 TCP 握手延迟、落地 COLO 和下载带宽，
回传到 /api/ip-feedback，之后订阅会按你的实测结果重排。

选项:
  --site <url>          站点地址（默认 env SITE_URL，如 https://yxdy.woniu.bee.al）
  --token <token>       管理 token（默认 env SUB_TOKEN）
  --n <count>           探测节点数量（默认 50）
  --speed <MB>          每个 IP 下载测速大小，默认 2；0 表示只测延迟
  --sni <host>          测速用 SNI/Host（默认 speed.cloudflare.com）
  --colo <list>         只探测指定 COLO，如 HKG,NRT；auto 表示你的接入点
  --concurrency <n>     延迟探测并发（默认 8）
  --timeout <ms>        单项超时（默认 5000）
  --json <file>         额外把结果写成 JSON 文件
  --no-submit           只打印结果，不回传
  --help                显示帮助

示例:
  node scripts/probe-ips.js --site https://yxdy.woniu.bee.al --token "$SUB_TOKEN"
  node scripts/probe-ips.js --speed 5 --colo auto
`;

function parseTrace(text) {
  const body = String(text || "").split(/\r?\n\r?\n/).slice(1).join("\r\n\r\n") || String(text || "");
  const colo = (body.match(/colo=(\w+)/) || [])[1] || "";
  const region = (body.match(/loc=(\w+)/) || [])[1] || "";
  if (!colo && !region) return null;
  return { colo: colo.toUpperCase(), region };
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

function downloadSpeed(address, port, { servername, bytes, timeoutMs }) {
  return new Promise((resolve) => {
    const request = https.request({
      host: address,
      port,
      servername,
      method: "GET",
      path: `/__down?bytes=${bytes}`,
      headers: { Host: servername, "Accept-Encoding": "identity" },
      rejectUnauthorized: false,
      timeout: timeoutMs,
    }, (response) => {
      if (response.statusCode >= 400) {
        response.resume();
        resolve(null);
        return;
      }
      let received = 0;
      let startedAt = null;
      response.on("data", (chunk) => {
        if (startedAt === null) startedAt = Date.now();
        received += chunk.length;
      });
      response.on("end", () => {
        if (startedAt === null || received <= 0) {
          resolve(null);
          return;
        }
        const elapsed = (Date.now() - startedAt) / 1000;
        resolve(elapsed > 0 ? Math.round(((received * 8) / (elapsed * 1000000)) * 100) / 100 : null);
      });
      response.on("error", () => resolve(null));
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", () => resolve(null));
    request.end();
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

async function fetchReadToken(site, token) {
  const response = await fetch(`${site}/api/read-token`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  return data.readToken || token;
}

async function fetchNodes(site, readToken, count) {
  const response = await fetch(`${site}/best?n=${count}&t=${encodeURIComponent(readToken)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`拉取优选列表失败 ${response.status}: ${data.error || "unknown"}`);
  }
  if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
    throw new Error("优选列表为空");
  }
  return data.nodes;
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
    item.colo || "-",
    item.region || "-",
    item.speed == null ? "-" : `${item.speed} Mbps`,
  ]);
  const header = ["#", "地址", "端口", "RTT", "COLO", "地区", "带宽"];
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
      speed: { type: "string", default: "2" },
      sni: { type: "string", default: "speed.cloudflare.com" },
      colo: { type: "string", default: "" },
      concurrency: { type: "string", default: "8" },
      timeout: { type: "string", default: "5000" },
      json: { type: "string" },
      "no-submit": { type: "boolean", default: false },
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
  if (!token) throw new Error("缺少 --token 或 SUB_TOKEN");

  const count = Math.max(1, Math.min(Number(values.n) || 50, 200));
  const speedMb = Math.max(0, Number(values.speed) || 0);
  const timeoutMs = Math.max(1000, Number(values.timeout) || 5000);
  const concurrency = Math.max(1, Math.min(Number(values.concurrency) || 8, 32));
  const servername = String(values.sni || "speed.cloudflare.com");

  console.log(`站点: ${site}`);
  const readToken = await fetchReadToken(site, token);
  let nodes = await fetchNodes(site, readToken, count);
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

  console.log("1/2 测量 TCP 握手延迟与落地 COLO…");
  const probed = await pool(nodes, concurrency, async (node) => {
    const address = String(node.address || "");
    const port = Number(node.port) || 443;
    const rtt = await tcpRtt(address, port, timeoutMs);
    if (rtt === null) return { address, port, rtt: null, colo: "", region: "", speed: null };
    const trace = await traceEdge(address, port, { servername, timeoutMs });
    return {
      address,
      port,
      rtt,
      colo: trace?.colo || "",
      region: trace?.region || "",
      speed: null,
    };
  });

  const alive = probed.filter((item) => item.rtt !== null);
  const dead = probed.length - alive.length;
  if (alive.length === 0) throw new Error("所有节点都连不上，请检查网络");
  if (dead > 0) console.log(`   ${dead} 个节点连接失败，已跳过`);

  if (speedMb > 0) {
    const bytes = Math.round(speedMb * 1000000);
    console.log(`2/2 测量下载带宽（每个 ${speedMb}MB，并发 2）…`);
    await pool(alive, 2, async (item) => {
      item.speed = await downloadSpeed(item.address, item.port, { servername, bytes, timeoutMs: Math.max(timeoutMs, 15000) });
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

  if (values["no-submit"]) {
    console.log("--no-submit：未回传。");
    return;
  }

  const response = await fetch(`${site}/api/ip-feedback`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ results: alive }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(`回传失败 ${response.status}: ${data.error || "unknown"}`);
  }
  console.log(`已回传 ${data.saved} 条实测数据（${data.storage}）。`);
  console.log(`订阅地址（按你的实测重排）: ${site}/sub?type=v2rayng&t=${readToken}`);
}

main().catch((error) => {
  console.error(`失败: ${error.message}`);
  process.exitCode = 1;
});
