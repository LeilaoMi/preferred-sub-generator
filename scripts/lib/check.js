import net from "node:net";
import tls from "node:tls";

function finishSocket(socket, startedAt, resolve, result) {
  socket.destroy();
  if (result === null) {
    resolve(null);
    return;
  }
  resolve({ latency: Date.now() - startedAt, ...result });
}

export function parseCfRayColo(value) {
  const match = String(value || "").match(/^[a-f0-9]+-([A-Z]{3})$/i);
  return match ? match[1].toUpperCase() : "";
}

export function checkTcp(address, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host: address, port });
    let done = false;

    function finish(ok) {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok ? Date.now() - startedAt : null);
    }

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function parseHeaders(buffer) {
  const headers = {};
  for (const line of buffer.split(/\r?\n/).slice(1)) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

export function checkHttpEdge(address, port, { host, tlsEnabled, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = tlsEnabled
      ? tls.connect({ host: address, port, servername: host, rejectUnauthorized: false })
      : net.createConnection({ host: address, port });
    let done = false;
    let buffer = "";

    function finish(result) {
      if (done) return;
      done = true;
      finishSocket(socket, startedAt, resolve, result);
    }

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      if (!tlsEnabled) {
        socket.write(`GET /cdn-cgi/trace HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      }
    });
    socket.once("secureConnect", () => {
      socket.write(`GET /cdn-cgi/trace HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\r\n\r\n")) {
        const headers = parseHeaders(buffer);
        const colo = parseCfRayColo(headers["cf-ray"]);
        finish({ colo, edgeVerified: Boolean(colo) });
      }
    });
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
    socket.once("end", () => {
      if (!done && buffer) {
        const headers = parseHeaders(buffer);
        const colo = parseCfRayColo(headers["cf-ray"]);
        finish({ colo, edgeVerified: Boolean(colo) });
      }
    });
  });
}

export async function checkEdge(address, port, options = {}) {
  const result = await checkHttpEdge(address, port, options);
  if (result) return result;

  const latency = await checkTcp(address, port, options.timeoutMs || 3000);
  return latency === null ? null : { latency, colo: "", edgeVerified: false };
}

function normalizeCheckResult(result) {
  if (result === null || result === undefined) return null;
  if (typeof result === "number") return { latency: result, colo: "", edgeVerified: false };
  if (typeof result === "object" && typeof result.latency === "number") {
    return {
      latency: result.latency,
      colo: result.colo || "",
      edgeVerified: Boolean(result.edgeVerified || result.colo),
    };
  }
  return null;
}

export async function checkCandidates(candidates, ports, { checkOne = checkEdge, concurrency = 20, checkOptions = {} } = {}) {
  const tasks = [];
  for (const candidate of candidates) {
    const candidatePorts = candidate.port ? [candidate.port] : ports;
    for (const port of candidatePorts) {
      tasks.push({ address: candidate.address, port, source: candidate.source || "unknown" });
    }
  }

  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      const checked = normalizeCheckResult(await checkOne(task.address, task.port, checkOptions));
      if (checked) {
        results.push({ ...task, ...checked });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results.sort((a, b) => a.latency - b.latency);
}
