import { requireReadAuth } from "../security/auth.js";
import { jsonResponse, unauthorizedResponse } from "../utils/response.js";
import { readBestIpVersions } from "./kv.js";

const MAX_VERSIONS = 100;

export async function handleVersions(request, env) {
  const auth = requireReadAuth(request, env);
  if (!auth.authorized) return unauthorizedResponse();

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("n") || 30);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_VERSIONS) : 30;
  const versions = await readBestIpVersions(env.SUB_KV);

  return jsonResponse({ versions: versions.slice(0, limit), total: versions.length });
}
