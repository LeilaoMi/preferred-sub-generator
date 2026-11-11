function stripComment(line) {
  return line.split("#")[0].trim();
}

const DEFAULT_CIDR_SAMPLES = 4;
const DEFAULT_CSV_MIN_SPEED = 0;
const DEFAULT_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const DEFAULT_SOURCE_TIMEOUT_MS = 10000;

function parseUrlCandidate(value) {
  try {
    const url = new URL(value);
    if (!url.hostname) return null;
    return { address: normalizeAddress(url.hostname), port: url.port ? Number(url.port) : null };
  } catch {
    return null;
  }
}

function normalizeAddress(value) {
  return String(value || "").replace(/^\[|\]$/g, "");
}

export function isIPv6(value) {
  const normalized = normalizeAddress(value);
  // 最小修复：:::: 这类全空组不是合法 IPv6，之前仅凭字符集会放行。
  // 完整严格校验不在本 PR 范围，仍以字符集 + 至少一位十六进制 + 不含连续三冒号为准。
  return (
    normalized.includes(":") &&
    /[0-9a-fA-F]/.test(normalized) &&
    /^[0-9a-fA-F:.]+$/.test(normalized) &&
    !normalized.includes(":::")
  );
}

function isIPv4(value) {
  const parts = String(value).split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function ipv4ToNumber(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function numberToIPv4(number) {
  return [24, 16, 8, 0].map((shift) => (number >>> shift) & 255).join(".");
}

export function expandIPv4Cidr(value, maxSamples = 4) {
  const match = String(value).match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match || !isIPv4(match[1])) return [];

  const prefix = Number(match[2]);
  if (prefix < 0 || prefix > 32) return [];

  const base = ipv4ToNumber(match[1]);
  const size = 2 ** (32 - prefix);
  const first = prefix >= 31 ? base : base + 1;
  const last = prefix >= 31 ? base + size - 1 : base + size - 2;
  if (last < first) return [];

  const count = Math.min(maxSamples, last - first + 1);
  if (count === 1) return [{ address: numberToIPv4(first), port: null }];

  return Array.from({ length: count }, (_, index) => {
    const offset = Math.floor(((last - first) * index) / (count - 1));
    return { address: numberToIPv4(first + offset), port: null };
  });
}

function groupsToBigInt(groups) {
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const group of groups) {
    const num = parseInt(group || "0", 16);
    if (!Number.isFinite(num) || num < 0 || num > 0xffff) return null;
    result = (result << 16n) | BigInt(num);
  }
  return result;
}

function ipv6ToBigInt(value) {
  const normalized = normalizeAddress(value);
  if (normalized.includes("::")) {
    const [head, tail] = normalized.split("::");
    const headGroups = head ? head.split(":") : [];
    const tailGroups = tail ? tail.split(":") : [];
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 1) return null;
    return groupsToBigInt([...headGroups, ...Array(fill).fill("0"), ...tailGroups]);
  }
  return groupsToBigInt(normalized.split(":"));
}

function compressIpv6(groups) {
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] === "0") {
      if (runStart < 0) runStart = i;
      const runLen = i - runStart + 1;
      if (runLen > bestLen) { bestLen = runLen; bestStart = runStart; }
    } else {
      runStart = -1;
    }
  }
  if (bestLen < 2) return groups.join(":");
  const before = groups.slice(0, bestStart).join(":");
  const after = groups.slice(bestStart + bestLen).join(":");
  return `${before}::${after}`;
}

function bigIntToIpv6(value) {
  const groups = [];
  let v = value;
  for (let i = 0; i < 8; i += 1) {
    groups.unshift((v & 0xffffn).toString(16));
    v >>= 16n;
  }
  return compressIpv6(groups);
}

export function expandIPv6Cidr(value, maxSamples = 4) {
  const match = String(value).match(/^([0-9a-fA-F:]+)\/(\d{1,3})$/);
  if (!match) return [];
  const base = ipv6ToBigInt(match[1]);
  const prefix = Number(match[2]);
  if (base === null || prefix < 0 || prefix > 128) return [];
  const size = 1n << BigInt(128 - prefix);
  const first = prefix >= 127 ? base : base + 1n;
  const last = prefix >= 127 ? base + size - 1n : base + size - 2n;
  if (last < first) return [];
  const count = BigInt(Math.min(maxSamples, Number(last - first + 1n)));
  if (count === 1n) return [{ address: bigIntToIpv6(first), port: null }];
  return Array.from({ length: Number(count) }, (_, index) => {
    const offset = ((last - first) * BigInt(index)) / (count - 1n);
    return { address: bigIntToIpv6(first + offset), port: null };
  });
}

// 统一 CIDR 展开：先试 IPv4，不匹配再试 IPv6
export function expandCidr(value, maxSamples = 4) {
  const v4 = expandIPv4Cidr(value, maxSamples);
  if (v4.length > 0) return v4;
  return expandIPv6Cidr(value, maxSamples);
}

export function parseCandidate(value) {
  const line = stripComment(String(value || ""));
  if (!line) return null;

  const cidr = expandCidr(line, 1);
  if (cidr.length > 0) return cidr[0];

  const fromUrl = parseUrlCandidate(line);
  if (fromUrl) return fromUrl;

  const bracketHostPort = line.match(/^\[([^\]]+)\]:(\d{1,5})$/);
  if (bracketHostPort) {
    const port = Number(bracketHostPort[2]);
    if (port < 1 || port > 65535 || !isIPv6(bracketHostPort[1])) return null;
    return { address: bracketHostPort[1], port };
  }

  const hostPort = line.match(/^([^\s:/]+):(\d{1,5})$/);
  if (hostPort) {
    const port = Number(hostPort[2]);
    if (port < 1 || port > 65535) return null;
    return { address: hostPort[1], port };
  }

  if (/^[a-zA-Z0-9.-]+$/.test(line) || isIPv4(line) || isIPv6(line)) {
    return { address: normalizeAddress(line), port: null };
  }

  return null;
}

function parseText(text, source, maxCidrSamples = DEFAULT_CIDR_SAMPLES) {
  const candidates = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    // 「IP 端口」两列格式（NiREvil country_proxies/US.txt 这类），整行当成一个 IP:端口
    const pair = line.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,5})$/);
    if (pair && isIPv4(pair[1]) && Number(pair[2]) >= 1 && Number(pair[2]) <= 65535) {
      candidates.push({ address: pair[1], port: Number(pair[2]), source });
      continue;
    }
    for (const token of line.split(/[\s,]+/)) {
      if (!token) continue;
      const cidr = expandCidr(token, maxCidrSamples);
      if (cidr.length > 0) {
        candidates.push(...cidr.map((candidate) => ({ ...candidate, source })));
        continue;
      }
      const candidate = parseCandidate(token);
      if (candidate) candidates.push({ ...candidate, source });
    }
  }
  return candidates;
}

// 网页 / 任意 JSON：直接把正文里出现的 IPv4 全抠出来（wetest 表格、vps789 三网 JSON 之类）
const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
export function parseScrape(text, source) {
  const seen = new Set();
  const out = [];
  for (const address of String(text || "").match(IPV4_RE) || []) {
    if (seen.has(address)) continue;
    seen.add(address);
    out.push({ address, port: null, source });
  }
  return out;
}

function findHeaderIndex(header, names) {
  const normalized = header.map((cell) => String(cell || "").trim().toLowerCase());
  for (const name of names) {
    const index = normalized.indexOf(String(name).toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function resolveColumnIndex(header, names, fallbackIndex) {
  const found = findHeaderIndex(header, names);
  return found >= 0 ? found : fallbackIndex;
}

// P0-2: 按表头名定位列，找不到表头时回退固定索引，避免上游 CSV 加列导致静默错位
export function parseCsv(text, source, minSpeed = DEFAULT_CSV_MIN_SPEED, options = {}) {
  const rows = String(text || "").trim().split(/\r?\n/);
  if (rows.length < 2) return [];

  const header = rows[0].split(",").map((column) => column.trim());
  const addressIndex = resolveColumnIndex(header, ["ip", "ip地址", "address", "host"], 0);
  const portIndex = resolveColumnIndex(header, ["port", "端口"], 1);
  const tlsIndex = resolveColumnIndex(header, ["tls"], 3);
  const coloIndex = resolveColumnIndex(header, ["datacenter", "数据中心", "colo"], 4);
  const speedIndex = resolveColumnIndex(header, ["speed", "速度", "速度(mb/s)", "mb/s"], header.length - 1);
  const remarkIndex = typeof options.remarkColumn === "number"
    ? options.remarkColumn
    : resolveColumnIndex(header, ["remark", "备注", "城市", "city"], -1);

  return rows.slice(1).flatMap((row) => {
    const columns = row.split(",").map((column) => column.trim());
    const address = columns[addressIndex];
    const port = Number(columns[portIndex]);
    const tls = columns[tlsIndex];
    const colo = columns[coloIndex];
    const speed = Number(columns[speedIndex]);

    if (!address || !Number.isFinite(port) || port <= 0 || port > 65535) return [];
    if (Number.isFinite(speed) && speed < minSpeed) return [];

    return [{
      address,
      port,
      source,
      tls: String(tls).toLowerCase() === "true",
      colo: colo || "",
      speed: Number.isFinite(speed) ? speed : null,
      ...(remarkIndex >= 0 && columns[remarkIndex] ? { remark: columns[remarkIndex] } : {}),
    }];
  });
}

function parseJson(value, source, maxCidrSamples = DEFAULT_CIDR_SAMPLES) {
  const parsed = JSON.parse(value);
  const items = Array.isArray(parsed) ? parsed : parsed.items || parsed.nodes || parsed.ips || [];
  return items
    .flatMap((item) => {
      if (typeof item === "string") {
        const cidr = expandCidr(item, maxCidrSamples);
        return cidr.length > 0 ? cidr : [parseCandidate(item)].filter(Boolean);
      }
      if (item?.address || item?.host || item?.ip) {
        return [{ address: item.address || item.host || item.ip, port: item.port ? Number(item.port) : null }];
      }
      return [];
    })
    .filter(Boolean)
    .map((candidate) => ({ ...candidate, source }));
}

export function uniqueCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const key = `${candidate.address}:${candidate.port || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function getSourceType(source, url) {
  return (typeof source === "object" && source.type) || (url.endsWith(".csv") ? "csv" : "auto");
}

function getSourceName(source, url) {
  return typeof source === "string" ? source : source.name || url;
}

function getMaxBytes(source, defaultMaxBytes = DEFAULT_MAX_SOURCE_BYTES) {
  const value = typeof source === "object" && source.maxBytes ? Number(source.maxBytes) : defaultMaxBytes;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_SOURCE_BYTES;
}

async function readResponseText(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`source too large: ${contentLength} bytes`);
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) throw new Error(`source too large: >${maxBytes} bytes`);
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error(`source too large: >${maxBytes} bytes`);
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

// 反代源按国家标签筛：只留 `IP:端口#US...` 这类注释里带目标国家代码的行（zip.cm.edu.kg / countrymerge 格式）
export function filterLinesByCountry(text, country) {
  const code = String(country || "").trim().toUpperCase();
  if (!code) return String(text || "");
  const re = new RegExp(`(^|[^A-Z])${code}([^A-Z]|$)`);
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => {
      const hash = line.indexOf("#");
      return hash >= 0 && re.test(line.slice(hash + 1).toUpperCase());
    })
    .join("\n");
}

// 源级别的后过滤：ports 只留指定端口（没写端口的按 443 算）；relayOnly 去掉混进来的 Cloudflare 官方段 IP
export function applySourceFilters(candidates, source) {
  if (typeof source !== "object" || !source) return candidates;
  const ports = Array.isArray(source.ports) && source.ports.length ? new Set(source.ports.map(Number)) : null;
  const cfRanges = source.relayOnly ? CLOUDFLARE_IPV4_RANGES.map(parseV4Cidr) : null;
  return candidates.filter((candidate) => {
    if (ports && !ports.has(Number(candidate.port) || 443)) return false;
    if (cfRanges && isIPv4(candidate.address) && ipv4InRanges(candidate.address, cfRanges)) return false;
    return true;
  }).map((candidate) => (ports && !candidate.port ? { ...candidate, port: 443 } : candidate));
}

async function readLocalFile(path) {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);
  // FOFA 导出有时是 .gz（或手机上传时被压缩），按 gzip 魔数自动解压
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const { gunzipSync } = await import("node:zlib");
    return gunzipSync(buf).toString("utf8");
  }
  return buf.toString("utf8");
}

// 本地源：file 指向单个文件；dir 指向文件夹，读里面所有 .txt/.csv/.gz（手机网页直接上传 FOFA 导出即可）
async function readLocalSource(source) {
  if (source.file) return readLocalFile(source.file);
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(source.dir).catch(() => [])).filter((name) => /\.(txt|csv|gz)$/i.test(name)).sort();
  const texts = await Promise.all(names.map((name) => readLocalFile(`${source.dir}/${name}`)));
  return texts.join("\n");
}

async function fetchRemoteSource(source, { fetchImpl, maxSourceBytes }) {
  const file = typeof source === "object" && source ? source.file || source.dir : "";
  const url = typeof source === "string" ? source : source.url || file;
  const sourceName = getSourceName(source, url);
  const startedAt = Date.now();
  const fail = (error, status = 0) => ({
    health: { name: sourceName, ok: false, status, candidates: 0, ms: Date.now() - startedAt, error },
    candidates: [],
  });
  if (!url) return fail("missing url");

  try {
    let body;
    let status = 200;
    if (file) {
      // 仓库内文件或文件夹（如 sources/relay/fofa/，FOFA 导出的 CSV 直接传进去）
      body = await (typeof source.readFileImpl === "function" ? source.readFileImpl(file) : readLocalSource(source));
    } else {
      // P0-1: 单源超时，挂掉的源不拖死整轮抓取；signal 透传给 fetchImpl，mock 忽略多余参数也不会炸
      const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(DEFAULT_SOURCE_TIMEOUT_MS) : undefined;
      const response = await fetchImpl(url, signal ? { signal } : undefined);
      if (!response.ok) {
        return fail(`HTTP ${response.status}`, response.status);
      }
      status = response.status;
      body = await readResponseText(response, getMaxBytes(source, maxSourceBytes));
    }
    if (typeof source === "object" && source.country) body = filterLinesByCountry(body, source.country);
    const maxCidrSamples = typeof source === "object" && source.cidrSamples ? Number(source.cidrSamples) : DEFAULT_CIDR_SAMPLES;
    const minSpeed = typeof source === "object" && source.minSpeed ? Number(source.minSpeed) : DEFAULT_CSV_MIN_SPEED;
    const sourceType = getSourceType(source, url);
    let parsed;

    if (sourceType === "scrape") {
      parsed = parseScrape(body, sourceName);
    } else if (sourceType === "csv") {
      const remarkColumn = typeof source === "object" && typeof source.remarkColumn === "number" ? source.remarkColumn : undefined;
      parsed = parseCsv(body, sourceName, minSpeed, { remarkColumn });
    } else {
      try {
        parsed = parseJson(body, sourceName, maxCidrSamples);
      } catch {
        parsed = parseText(body, sourceName, maxCidrSamples);
      }
    }

    parsed = applySourceFilters(parsed, source);
    return {
      health: { name: sourceName, ok: true, status, candidates: parsed.length, ms: Date.now() - startedAt },
      candidates: parsed,
    };
  } catch (error) {
    return fail(error.message);
  }
}

export async function collectCandidatesWithHealth({ manualText = "", remoteSources = [], fetchImpl = fetch, maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES, extraBlacklist = "", allowRelay = true } = {}) {
  const manualCandidates = parseText(manualText, "edge-manual");
  const candidates = [...manualCandidates];
  const sourceHealth = [{ name: "edge-manual", ok: true, status: 200, candidates: manualCandidates.length, ms: 0 }];

  // P0-1: 并行抓取所有远程源，单源失败只记 health 不阻断；顺序与输入一致
  const settled = await Promise.allSettled(
    remoteSources.map((source) => fetchRemoteSource(source, { fetchImpl, maxSourceBytes })),
  );
  for (const entry of settled) {
    if (entry.status === "fulfilled") {
      candidates.push(...entry.value.candidates);
      sourceHealth.push(entry.value.health);
    } else {
      sourceHealth.push({ name: "unknown", ok: false, status: 0, candidates: 0, ms: 0, error: entry.reason?.message || String(entry.reason) });
    }
  }

  // 稳定优先：默认放行社区源里的反代 IP（cmliu 源几乎全是 Oracle/AWS/Linode 等反代 IP，
  // 这正是它在国内稳定的原因）。ALLOW_RELAY=0 时只保留 Cloudflare 官方段 IPv4。
  // 标了 cfOnly 的源始终只保留 Cloudflare 官方段（不受 ALLOW_RELAY 影响）；
  // ALLOW_RELAY=0 时所有远程源都只保留官方段。
  const cfOnlySources = new Set(
    remoteSources
      .filter((source) => typeof source === "object" && (source.cfOnly || !allowRelay))
      .map((source) => getSourceName(source, source.url)),
  );
  const blacklist = [...DEFAULT_EDGE_BLACKLIST, ...String(extraBlacklist || "").split(",").map((item) => item.trim()).filter(Boolean)];
  const { candidates: filtered, dropped } = filterEdgeCandidates(uniqueCandidates(candidates), { cfOnlySources, blacklist });
  return { candidates: filtered, sourceHealth, dropped };
}

export async function collectCandidates(options = {}) {
  const result = await collectCandidatesWithHealth(options);
  return result.candidates;
}

// Cloudflare 官方 IPv4 段（https://www.cloudflare.com/ips-v4/，AS13335 入口）。
// 社区源（cmliu 等）里混有 Oracle/腾讯云等中转 IP；source.cfOnly=true 时只保留落在这些段里的 IPv4，
// 域名（优选域名）原样保留——它们靠国内 DNS 按运营商选线，最终也要经本机实测才会排前面。
export const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];

// 网段黑名单默认为空，用环境变量 EDGE_BLACKLIST（逗号分隔 CIDR）按需追加，
// 例如你在本机实测中发现整段不通时。
export const DEFAULT_EDGE_BLACKLIST = [];

function parseV4Cidr(cidr) {
  const match = String(cidr).trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match || !isIPv4(match[1])) return null;
  const prefix = Number(match[2]);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (ipv4ToNumber(match[1]) & mask) >>> 0, mask };
}

export function ipv4InRanges(address, ranges) {
  if (!isIPv4(address)) return false;
  const value = ipv4ToNumber(address);
  return ranges.some((cidr) => {
    const parsed = typeof cidr === "string" ? parseV4Cidr(cidr) : cidr;
    return parsed && ((value & parsed.mask) >>> 0) === parsed.base;
  });
}

export function filterEdgeCandidates(candidates, { cfOnlySources = new Set(), blacklist = DEFAULT_EDGE_BLACKLIST } = {}) {
  const cfRanges = CLOUDFLARE_IPV4_RANGES.map(parseV4Cidr);
  const black = blacklist.map(parseV4Cidr).filter(Boolean);
  const dropped = { blacklisted: 0, notCloudflare: 0 };
  const kept = candidates.filter((candidate) => {
    const address = candidate?.address;
    if (!isIPv4(address)) return true;
    if (ipv4InRanges(address, black)) { dropped.blacklisted += 1; return false; }
    if (cfOnlySources.has(candidate.source) && !ipv4InRanges(address, cfRanges)) { dropped.notCloudflare += 1; return false; }
    return true;
  });
  return { candidates: kept, dropped };
}
