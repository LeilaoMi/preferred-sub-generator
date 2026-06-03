import { jsonResponse } from "../utils/response.js";
import { readBestIps } from "./kv.js";

const MAX_NODES = 50;

export async function handleBest(request, env) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("n") || 20);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_NODES) : 20;
  const nodes = await readBestIps(env.SUB_KV);

  return jsonResponse({ nodes: nodes.slice(0, limit), total: nodes.length });
}
