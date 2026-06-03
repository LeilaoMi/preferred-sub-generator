import { jsonResponse } from "../utils/response.js";
import { readStatus } from "./kv.js";

export async function handleStatus(request, env) {
  const status = await readStatus(env.SUB_KV);

  return jsonResponse({
    updatedAt: status.updatedAt || null,
    available: status.available || 0,
    sourceCount: status.sourceCount || 0,
    lastError: status.lastError ? "检测失败，已保留上次可用结果" : null,
  });
}
