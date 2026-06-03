function stripComment(line) {
  return line.split("#")[0].trim();
}

const DEFAULT_CIDR_SAMPLES = 4;
const DEFAULT_CSV_MIN_SPEED = 0;

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

function isIPv6(value) {
  const normalized = normalizeAddress(value);
  return normalized.includes(":") && /^[0-9a-fA-F:.]+$/.test(normalized);
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

export function parseCandidate(value) {
  const line = stripComment(String(value || ""));
  if (!line) return null;

  const cidr = expandIPv4Cidr(line, 1);
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
  for (const raw of String(text || "").split(/\r?\n|,|\s+/)) {
    const line = stripComment(raw);
    if (!line) continue;
    const cidr = expandIPv4Cidr(line, maxCidrSamples);
    if (cidr.length > 0) {
      candidates.push(...cidr.map((candidate) => ({ ...candidate, source })));
      continue;
    }
    const candidate = parseCandidate(line);
    if (candidate) candidates.push({ ...candidate, source });
  }
  return candidates;
}

function parseCsv(text, source, minSpeed = DEFAULT_CSV_MIN_SPEED) {
  const rows = String(text || "").trim().split(/\r?\n/);
  if (rows.length < 2) return [];

  return rows.slice(1).flatMap((row) => {
    const columns = row.split(",").map((column) => column.trim());
    const address = columns[0];
    const port = Number(columns[1]);
    const tls = columns[3];
    const colo = columns[4];
    const speed = Number(columns.at(-1));

    if (!address || !Number.isFinite(port) || port <= 0 || port > 65535) return [];
    if (Number.isFinite(speed) && speed < minSpeed) return [];

    return [{
      address,
      port,
      source,
      tls: String(tls).toLowerCase() === "true",
      colo: colo || "",
      speed: Number.isFinite(speed) ? speed : null,
    }];
  });
}

function parseJson(value, source, maxCidrSamples = DEFAULT_CIDR_SAMPLES) {
  const parsed = JSON.parse(value);
  const items = Array.isArray(parsed) ? parsed : parsed.items || parsed.nodes || parsed.ips || [];
  return items
    .flatMap((item) => {
      if (typeof item === "string") {
        const cidr = expandIPv4Cidr(item, maxCidrSamples);
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

export async function collectCandidates({ manualText = "", remoteSources = [], fetchImpl = fetch } = {}) {
  const candidates = [...parseText(manualText, "edge-manual")];

  for (const source of remoteSources) {
    const url = typeof source === "string" ? source : source.url;
    if (!url) continue;

    const response = await fetchImpl(url);
    if (!response.ok) continue;
    const body = await response.text();
    const sourceName = typeof source === "string" ? source : source.name || url;
    const maxCidrSamples = typeof source === "object" && source.cidrSamples ? Number(source.cidrSamples) : DEFAULT_CIDR_SAMPLES;
    const minSpeed = typeof source === "object" && source.minSpeed ? Number(source.minSpeed) : DEFAULT_CSV_MIN_SPEED;
    const sourceType = getSourceType(source, url);

    if (sourceType === "csv") {
      candidates.push(...parseCsv(body, sourceName, minSpeed));
      continue;
    }

    try {
      candidates.push(...parseJson(body, sourceName, maxCidrSamples));
    } catch {
      candidates.push(...parseText(body, sourceName, maxCidrSamples));
    }
  }

  return uniqueCandidates(candidates);
}
