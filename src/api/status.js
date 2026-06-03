import { jsonResponse } from "../utils/response.js";
import { readStatus } from "./kv.js";

export async function handleStatus(request, env) {
  const status = await readStatus(env.SUB_KV);
  const fallbackActive = Boolean(status.protectedByPrevious);
  const lastError = status.lastError || null;

  return jsonResponse({
    updatedAt: status.updatedAt || null,
    available: status.available || 0,
    newAvailable: status.newAvailable || 0,
    sourceCount: status.sourceCount || 0,
    checked: status.checked || 0,
    fallbackActive,
    lastError,
    status: lastError ? (fallbackActive ? "fallback" : "error") : "ok",
  });
}
