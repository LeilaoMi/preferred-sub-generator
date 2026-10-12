#!/usr/bin/env node
// 国内域名体检 + 「IP × 你的域名」组合实测（Globalping HTTPS 测量，中国大陆三网探针）。
//
// 第一步 域名体检：探针直接 HTTPS 访问 https://<域名>/cdn-cgi/trace，
//   判断每个域名在电信 / 联通 / 移动下有没有被 DNS 污染、SNI 阻断（连接被重置）。结果写 CN_HOST_HEALTH。
// 第二步 组合实测：目标写 IP、request.host 写你的域名（Globalping 会同时把它用作 TLS SNI，2026-10-13 实测验证），
//   和 edgetunnel 真实发出的连接一致。一次拿到：是否 1034（IP 不服务你的域名）、是否被重置、落地机房 colo。
//   只在该运营商下没被墙的域名上测，避免把「域名被墙」误判成「IP 不好」。结果并入 CN_PROBE_FEEDBACK。
//
// 没配任何域名时，测订阅自己的域名（<Pages 项目>.pages.dev），零配置也有用。
import { applyInstanceConfig } from "./lib/instance-config.js";
import { readKvValue, writeKvValue } from "./lib/kv.js";
import { sendNotification, notifyTargets } from "./lib/notify.js";
import { CN_PROBE_KEY, ispLabel, mergeEntries, refreshSnapshot } from "./china-probe.js";
import { HOST_HEALTH_KEY, mergeHostHealth, resolveCheckHosts, summarizeHostHealth } from "../src/api/host-health.js";
import { CN_VERIFIED_KEY, SNAPSHOT_ISPS } from "../src/api/cn-verified.js";

const API = "https://api.globalping.io/v1/measurements";
const ISP_MAGIC = { CT: "CN+Chinanet", CU: "CN+China Unicom", CM: "CN+China Mobile" };
const ALERT_STATE_KEY = "CN_HOST_ALERT_STATE";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseTrace(body) {
  const text = String(body || "");
  const colo = (text.match(/colo=([A-Z]{3})/) || [])[1] || "";
  const host = (text.match(/\bh=([^\s]+)/) || [])[1] || "";
  return { colo, host, isTrace: /\bfl=/.test(text) && /\bcolo=/.test(text) };
}

// 一个 HTTPS 探针结果 -> { isp, ok, colo, ms, tcp, error }
export function httpResultToCheck(probeResult) {
  const result = probeResult?.result || {};
  const isp = ispLabel(probeResult?.probe?.network);
  const code = Number(result.statusCode);
  const trace = parseTrace(result.rawBody);
  const timings = result.timings || {};
  const base = { isp, colo: trace.colo, ms: Number.isFinite(Number(timings.total)) ? Number(timings.total) : null, tcp: Number.isFinite(Number(timings.tcp)) ? Number(timings.tcp) : null };
  if (result.status !== "finished") {
    const raw = String(result.rawOutput || "").trim();
    // Globalping 自己的探针超时（不是目标的问题），不计入
    if (/^The measurement timed out/i.test(raw) || result.status === "in-progress") return { ...base, ok: false, error: "probe-timeout", ignore: true };
    const error = /ECONNRESET/i.test(raw) ? "reset" : /ENOTFOUND|EAI_AGAIN/i.test(raw) ? "dns" : /timed out|timeout|ETIMEDOUT/i.test(raw) ? "timeout" : (raw.slice(0, 60) || "failed");
    return { ...base, ok: false, error };
  }
  if (code === 403 && /1034/.test(String(result.rawBody || ""))) return { ...base, ok: false, error: "1034" };
  if (code >= 200 && code < 400 && trace.isTrace) return { ...base, ok: true, error: null };
  // 证书不匹配、被劫持到别的页面等
  return { ...base, ok: false, error: `http-${code || "?"}` };
}

async function createHttp({ target, host, locations, fetchImpl, token }) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = { path: "/cdn-cgi/trace", method: "GET" };
  if (host) request.host = host;
  const response = await fetchImpl(API, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "http", target, locations, measurementOptions: { protocol: "HTTPS", request } }),
  });
  if (response.status === 429) return { rateLimited: true };
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) return { error: `${response.status} ${data?.error?.message || ""}`.trim() };
  return { id: data.id };
}

async function waitMeasurement(id, { fetchImpl, timeoutMs = 40000, pollMs = 1500 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const response = await fetchImpl(`${API}/${id}`);
    const data = await response.json().catch(() => ({}));
    if (data.status && data.status !== "in-progress") return data;
  }
  return null;
}

async function measure(args) {
  const created = await createHttp(args);
  if (created.rateLimited) return { rateLimited: true, checks: [] };
  if (!created.id) return { error: created.error, checks: [] };
  const data = await waitMeasurement(created.id, args);
  return { checks: (data?.results || []).map(httpResultToCheck) };
}

// 组合测目标：快照里排名靠前的 IP（综合 + 各运营商），去重后取前 topN
export function pickComboTargets(snapshot, topN) {
  const seen = new Set();
  const out = [];
  const lists = [snapshot?.all, ...SNAPSHOT_ISPS.map((isp) => snapshot?.[isp])];
  for (let i = 0; out.length < topN; i += 1) {
    let progressed = false;
    for (const list of lists) {
      const item = Array.isArray(list) ? list[i] : null;
      if (!item) continue;
      progressed = true;
      if (seen.has(item.address) || out.length >= topN) continue;
      seen.add(item.address);
      out.push({ address: item.address, port: Number(item.port) || 443 });
    }
    if (!progressed) break;
  }
  return out;
}

// 告警只在「被墙名单变化」或「某网已验证节点 < 阈值」时推，同样内容 24 小时内不重复
export function hostAlertDecision({ summary, snapshot, previous, now = Date.now(), minVerified = 10, repeatHours = 24 }) {
  const blocked = summary.flatMap((item) => item.blockedIsps.map((isp) => `${item.host}@${isp}`)).sort();
  const low = SNAPSHOT_ISPS.filter((isp) => Array.isArray(snapshot?.[isp]) && snapshot[isp].length < minVerified).sort();
  const signature = JSON.stringify({ blocked, low });
  const changed = signature !== previous?.signature;
  const lastSent = Date.parse(previous?.lastSentAt || "");
  const hasProblem = blocked.length > 0 || low.length > 0;
  const repeat = hasProblem && Number.isFinite(lastSent) && now - lastSent >= repeatHours * 3600000;
  const notify = (changed && (hasProblem || previous?.hasProblem)) || repeat;
  const names = { CT: "电信", CU: "联通", CM: "移动" };
  const lines = [];
  if (blocked.length) lines.push(`被墙域名：${blocked.map((b) => { const [h, i] = b.split("@"); return `${h}（${names[i]}）`; }).join("、")}`);
  if (low.length) lines.push(`国内已验证节点不足 ${minVerified} 个：${low.map((i) => `${names[i]} ${snapshot[i].length}`).join("、")}`);
  if (!hasProblem) lines.push("已恢复：没有被墙域名，三网已验证节点充足");
  return { notify, signature, hasProblem, text: `[优选订阅] 国内体检\n${lines.join("\n")}` };
}

export async function runHostCheck({ kv, env = {}, fetchImpl = fetch, token = "", now = new Date(), comboTop = 10, pollMs = 1500 }) {
  const read = async (key) => {
    const raw = await readKvValue({ ...kv, key, fetchImpl });
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const at = now.toISOString();
  const hosts = resolveCheckHosts(env);
  // 组合测只用你明确配置的节点域名（CHECK_HOSTS / VLESS_HOST / VLESS_SNI）。
  // 兜底的 pages.dev 是订阅域名不是节点域名，拿它测 IP 会把 1034 算到 IP 头上。
  const explicitHosts = Boolean(String(env.CHECK_HOSTS || env.VLESS_HOST || env.VLESS_SNI || "").replace(/speed\.cloudflare\.com/g, "").trim());
  if (!hosts.length) {
    console.log("没有可测的域名（CHECK_HOSTS / VLESS_HOST / PAGES_PROJECT 都没有），跳过");
    return { hosts: 0 };
  }
  console.log(`国内域名体检：${hosts.join(", ")}`);
  let rateLimited = false;

  // 第一步：域名体检，每个运营商 2 个探针
  const locations = SNAPSHOT_ISPS.map((isp) => ({ magic: ISP_MAGIC[isp], limit: 2 }));
  const fresh = [];
  for (const host of hosts) {
    if (rateLimited) break;
    const { checks, rateLimited: limited, error } = await measure({ target: host, locations, fetchImpl, token, pollMs });
    if (limited) { rateLimited = true; break; }
    if (error) console.log(`  ${host} 创建失败 ${error}`);
    for (const check of checks) {
      if (!SNAPSHOT_ISPS.includes(check.isp) || check.ignore) continue;
      fresh.push({ host, ...check });
      console.log(`  ${host} ${check.isp} ${check.ok ? `ok ${check.ms}ms ${check.colo}` : `失败 ${check.error}`}`);
    }
  }
  const previousHealth = await read(HOST_HEALTH_KEY);
  const config = { rotate: env.SUB_ROTATE_HOSTS === "1", hosts };
  const health = fresh.length ? mergeHostHealth(previousHealth, fresh, at, config) : { ...(previousHealth || { checkedAt: null, hosts: {} }), config };
  if (fresh.length || JSON.stringify(previousHealth?.config) !== JSON.stringify(config)) await writeKvValue({ ...kv, key: HOST_HEALTH_KEY, value: JSON.stringify(health), fetchImpl });
  const summary = summarizeHostHealth(health, hosts);

  // 第二步：组合实测。每个运营商用一个当前没被墙的域名
  const comboHost = {};
  for (const isp of SNAPSHOT_ISPS) {
    // 只用「ok」状态的域名做组合测；时好时坏的域名会把重置算到 IP 头上
    const item = summary.find((s) => s.isps[isp].state === "ok");
    if (item) comboHost[isp] = item.host;
  }
  const snapshotBefore = await read(CN_VERIFIED_KEY);
  const targets = comboTop > 0 && explicitHosts ? pickComboTargets(snapshotBefore, comboTop) : [];
  const comboEntries = [];
  const groups = {};
  for (const [isp, host] of Object.entries(comboHost)) (groups[host] ||= []).push(isp);
  for (const target of targets) {
    if (rateLimited) break;
    for (const [host, isps] of Object.entries(groups)) {
      const { checks, rateLimited: limited } = await measure({ target: target.address, host, locations: isps.map((isp) => ({ magic: ISP_MAGIC[isp], limit: 1 })), fetchImpl, token, pollMs });
      if (limited) { rateLimited = true; break; }
      for (const check of checks) {
        if (!isps.includes(check.isp) || check.ignore) continue;
        // 组合测 RTT 用 TCP 建连耗时，和 TCP ping 口径一致；1034 / 重置都记为失败
        comboEntries.push({ at, address: target.address, port: target.port, colo: check.colo, region: `CN-${check.isp}`, rtt: check.ok ? (check.tcp ?? null) : null, speed: null, clientHash: "globalping-https", ok: check.ok && check.tcp != null, reason: check.error || undefined });
      }
    }
  }
  if (targets.length) console.log(`组合实测 ${targets.length} 个 IP，得到 ${comboEntries.length} 条，ok ${comboEntries.filter((e) => e.ok).length}`);

  let snapshot = snapshotBefore;
  if (comboEntries.length) {
    const previous = (await read(CN_PROBE_KEY)) || [];
    const merged = mergeEntries(previous, comboEntries, now.getTime());
    await writeKvValue({ ...kv, key: CN_PROBE_KEY, value: JSON.stringify(merged), fetchImpl });
    const pool = [...((await read("BEST_IPS")) || []), ...((await read("CN_PENDING_IPS")) || [])];
    snapshot = await refreshSnapshot({ kv, fetchImpl, entries: merged, pool, now: now.getTime() });
  }

  // 告警（可选）
  if (notifyTargets(env).length) {
    const previousAlert = await read(ALERT_STATE_KEY);
    const decision = hostAlertDecision({ summary, snapshot, previous: previousAlert, now: now.getTime(), minVerified: Number(env.ALERT_MIN_AVAILABLE) || 10 });
    let sentAt = previousAlert?.lastSentAt || null;
    if (decision.notify && await sendNotification({ event: "preferred-sub-generator.cn-health", level: decision.hasProblem ? "warn" : "ok", text: decision.text }, { env, fetchImpl })) sentAt = at;
    await writeKvValue({ ...kv, key: ALERT_STATE_KEY, value: JSON.stringify({ signature: decision.signature, hasProblem: decision.hasProblem, lastSentAt: sentAt }), fetchImpl });
  }

  const blocked = summary.filter((item) => item.blockedIsps.length).map((item) => `${item.host}:${item.blockedIsps.join("/")}`);
  if (blocked.length) console.log(`被墙：${blocked.join(", ")}`);
  if (rateLimited) console.log("Globalping 额度用完，本轮提前结束（已测结果照常写入）");
  return { hosts: hosts.length, hostChecks: fresh.length, combo: comboEntries.length, comboOk: comboEntries.filter((e) => e.ok).length, blocked, rateLimited };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyInstanceConfig();
  const kv = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env.CLOUDFLARE_NAMESPACE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  };
  const comboTop = process.env.CN_COMBO_TOP === undefined || process.env.CN_COMBO_TOP === "" ? 10 : Number(process.env.CN_COMBO_TOP) || 0;
  runHostCheck({ kv, env: process.env, token: process.env.GLOBALPING_TOKEN || "", comboTop })
    .then((r) => console.log(JSON.stringify(r)))
    .catch((error) => {
      console.error(`失败: ${error.message}`);
      process.exitCode = 1;
    });
}
