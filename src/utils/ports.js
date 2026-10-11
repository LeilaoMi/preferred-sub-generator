export const TLS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];
export const NON_TLS_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];

function parsePortList(value) {
  if (value == null || String(value).trim() === "") return null;
  const ports = String(value).split(",")
    .map((part) => Number(part.trim()))
    .filter((port) => Number.isFinite(port) && port > 0 && port <= 65535);
  return ports.length > 0 ? [...new Set(ports)] : null;
}

function readPreferredPortsEnv(env = {}) {
  if (env.SUB_PREFERRED_PORTS != null) return env.SUB_PREFERRED_PORTS;
  if (typeof process !== "undefined") return process.env?.SUB_PREFERRED_PORTS;
  return undefined;
}

// P1-3: 返回生效的优选端口顺序；SUB_PREFERRED_PORTS 未设置时返回 null（调用方用默认逻辑）
export function getPreferredPortOrder(env = {}) {
  return parsePortList(readPreferredPortsEnv(env));
}

// P1-3: SUB_PREFERRED_PORTS="443,8443,2053" 可覆盖整张端口表；未设置时按 security 取默认表
export function getPortsForSecurity(security, env = {}) {
  return getPreferredPortOrder(env) || (security === "tls" ? TLS_PORTS : NON_TLS_PORTS);
}
