import { requireReadAuth } from "../security/auth.js";
import { jsonResponse, unauthorizedResponse } from "../utils/response.js";
import { readBestIpsVersion } from "./kv.js";

const MAX_NODES = 50;

export async function handleBest(request, env) {
  const auth = requireReadAuth(request, env);
  if (!auth.authorized) return unauthorizedResponse();

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("n") || 20);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_NODES) : 20;
  const version = url.searchParams.get("version") || "";
  const nodes = await readBestIpsVersion(env.SUB_KV, version);

  return jsonResponse({ nodes: nodes.slice(0, limit), total: nodes.length, version: version || "current" });
}
