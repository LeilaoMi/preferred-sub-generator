export const TLS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];
export const NON_TLS_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];

export function getPortsForSecurity(security) {
  return security === "tls" ? TLS_PORTS : NON_TLS_PORTS;
}
