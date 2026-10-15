// 给脚本里所有 fetch 加默认超时（KV / Cloudflare API / Globalping / 上游源）。
// 没有超时时一次挂起会一直等到 job 的 20 分钟上限。调用方自带 signal 时不覆盖。
export function installFetchTimeout(ms = Number(process.env.FETCH_TIMEOUT_MS) || 20000) {
  if (globalThis.__fetchTimeoutInstalled || typeof globalThis.fetch !== "function") return;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init = {}) => {
    if (init && init.signal) return original(input, init);
    return original(input, { ...init, signal: AbortSignal.timeout(ms) });
  };
  globalThis.__fetchTimeoutInstalled = true;
}
