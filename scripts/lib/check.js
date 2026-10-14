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

    // 硬超时：setTimeout 只管空闲，连接被对端静默关闭时不会触发
    const hardTimer = setTimeout(() => finish(false), timeoutMs + 1000);
    socket.once("close", () => { clearTimeout(hardTimer); finish(false); });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => { clearTimeout(hardTimer); finish(true); });
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

function parseStatusCode(buffer) {
  const match = String(buffer).match(/^HTTP\/1\.[01] (\d{3})/);
  return match ? Number(match[1]) : 0;
}

// 边缘 IP 必须对该 zone 返回 2xx。Cloudflare 对“只服务部分 zone”的 IP 会返回
// 403 + error code（如 1034），这类响应同样带 cf-ray，不能仅凭 cf-ray 判定可用。
function isZoneServingResponse(buffer) {
  const status = parseStatusCode(buffer);
  // 解析不出状态码（空回包、非 HTTP、被中间设备截断）一律判失败，不能当作可用
  if (status === 0) return false;
  return status >= 200 && status < 300;
}

function edgeResult(buffer) {
  if (!isZoneServingResponse(buffer)) return null;
  const headers = parseHeaders(buffer);
  const colo = parseCfRayColo(headers["cf-ray"]);
  return { colo, edgeVerified: Boolean(colo) };
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
        finish(edgeResult(buffer));
      }
    });
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
    // 对端不回包直接关闭（反代 IP 常见）时，之前 promise 永不 resolve，
    // 事件循环清空后整个 update-kv 静默以 0 退出、KV 一个字都没写。
    socket.once("end", () => finish(buffer ? edgeResult(buffer) : null));
    socket.once("close", () => finish(buffer ? edgeResult(buffer) : null));
    const hardTimer = setTimeout(() => finish(null), timeoutMs * 2 + 1000);
    socket.once("close", () => clearTimeout(hardTimer));
  });
}

// 三层健康检查之三：WebSocket 握手（借鉴 whypuss/cfnew-ycat 的思路）
// 前两层（TCP/TLS）通过后，验证 WS 升级是否成功
export function checkWsHandshake(address, port, { host, path = "/", timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = tls.connect({ host: address, port, servername: host, rejectUnauthorized: false });
    let done = false;
    let buffer = "";

    function finish(ok) {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok ? Date.now() - startedAt : null);
    }

    const key = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64").slice(0, 24);
    const hardTimer = setTimeout(() => finish(false), timeoutMs + 1000);
    socket.setTimeout(timeoutMs);
    socket.once("secureConnect", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\r\n\r\n")) {
        clearTimeout(hardTimer);
        // 101 = Switching Protocols，WS 握手成功
        finish(/^HTTP\/1\.[01] 101/.test(buffer));
      }
    });
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => { clearTimeout(hardTimer); finish(false); });
  });
}

// 三层健康检查：TCP → TLS → WS，逐层深入
// 返回 { latency, colo, edgeVerified, wsOk }，任一层失败返回 null
export async function checkThreeLayer(address, port, options = {}) {
  const { host, path = "/", timeoutMs = 5000 } = options;

  // 第一层：TCP 连通性
  const tcpLatency = await checkTcp(address, port, timeoutMs);
  if (tcpLatency === null) return null;

  // 第二层：TLS + HTTP（复用现有逻辑）
  const tlsResult = await checkHttpEdge(address, port, { host, tlsEnabled: true, timeoutMs });
  if (!tlsResult) return null;

  // 第三层：WS 握手（可选，失败不阻断，只标记）
  const wsLatency = await checkWsHandshake(address, port, { host, path, timeoutMs });

  return {
    latency: tlsResult.latency,
    colo: tlsResult.colo,
    edgeVerified: tlsResult.edgeVerified,
    wsOk: wsLatency !== null,
    wsLatency,
  };
}

export async function checkEdge(address, port, options = {}) {
  const result = await checkHttpEdge(address, port, options);
  if (result) return result;

  if (options.requireCfRay && !options.allowTcpOnly) return null;

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

// P1-8: 抖动 = 多次延迟采样的标准差；<2 个样本时记 0
function latencyJitter(latencies) {
  if (!Array.isArray(latencies) || latencies.length < 2) return 0;
  const mean = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  const variance = latencies.reduce((sum, value) => sum + (value - mean) ** 2, 0) / latencies.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

export async function checkCandidates(candidates, ports, { checkOne = checkEdge, concurrency = 20, checkOptions = {}, requireCfRay = false, allowTcpOnly = true, jitterSamples = 1 } = {}) {
  const tasks = [];
  for (const candidate of candidates) {
    const candidatePorts = candidate.port ? [candidate.port] : ports;
    for (const port of candidatePorts) {
      tasks.push({ address: candidate.address, port, source: candidate.source || "unknown", speed: candidate.speed ?? null });
    }
  }

  const sampleCount = Math.max(1, Math.floor(Number(jitterSamples) || 1));
  const results = [];
  let cursor = 0;

  async function checkTaskSamples(task) {
    const latencies = [];
    let best = null;
    for (let i = 0; i < sampleCount; i += 1) {
      const checked = normalizeCheckResult(await checkOne(task.address, task.port, { ...checkOptions, requireCfRay, allowTcpOnly }));
      if (!checked) return null;
      if (!best || checked.latency < best.latency) best = checked;
      latencies.push(checked.latency);
    }
    return { ...best, jitter: latencyJitter(latencies) };
  }

  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      const checked = await checkTaskSamples(task);
      if (checked) {
        if (requireCfRay && !checked.edgeVerified && !allowTcpOnly) continue;
        results.push({ ...task, ...checked });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results.sort((a, b) => {
    // 优先按带宽(speed)降序：有带宽数据的排前面，带宽高的优先
    // 无 speed 的回退按延迟升序，保持对 text/json 源的兼容
    const aSpeed = a.speed == null ? null : (Number.isFinite(Number(a.speed)) ? Number(a.speed) : null);
    const bSpeed = b.speed == null ? null : (Number.isFinite(Number(b.speed)) ? Number(b.speed) : null);
    if (aSpeed !== null || bSpeed !== null) {
      if (aSpeed === null) return 1;   // 无带宽的排后面
      if (bSpeed === null) return -1;  // 有带宽的排前面
      if (aSpeed !== bSpeed) return bSpeed - aSpeed;  // 带宽高的优先
    }
    // 都无带宽或带宽相同时，按延迟升序
    return a.latency - b.latency;
  });
}
