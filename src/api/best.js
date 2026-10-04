import { requireReadAuth } from "../security/auth.js";
import { jsonResponse, unauthorizedResponse } from "../utils/response.js";
import { readBestIpsVersion } from "./kv.js";
import { loadIpScores } from "./ip-feedback.js";
import { filterNodesByColo, parseColoFilter, rankNodesByScore } from "./node-filter.js";

const MAX_NODES = 50;

export async function handleBest(request, env) {
  const auth = requireReadAuth(request, env);
  if (!auth.authorized) return unauthorizedResponse();

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("n") || 20);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_NODES) : 20;
  const version = url.searchParams.get("version") || "";
  const allNodes = await readBestIpsVersion(env.SUB_KV, version);

  const rawColo = url.searchParams.get("colo");
  const { requested: requestedColos, colos } = parseColoFilter(rawColo, request);

  let nodes = allNodes;
  let droppedUnreachable = 0;
  if (url.searchParams.get("rank") !== "off") {
    const { scores } = await loadIpScores(env);
    nodes = rankNodesByScore(nodes, scores);
    droppedUnreachable = allNodes.length - nodes.length;
  }
  const filtered = filterNodesByColo(nodes, colos);

  const slice = filtered.nodes.slice(0, limit);
  const measured = slice.filter((node) => node.userRtt != null).length;

  const filterInfo = rawColo
    ? {
        requested: requestedColos,
        resolved: colos,
        matched: filtered.matched,
        fallback: filtered.fallback || colos.length === 0,
        matchedCount: filtered.matchedCount,
        total: allNodes.length,
      }
    : undefined;

  return jsonResponse({
    nodes: slice,
    total: filtered.nodes.length,
    version: version || "current",
    measured,
    ...(droppedUnreachable > 0 ? { droppedUnreachable } : {}),
    ...(filterInfo ? { filter: filterInfo } : {}),
  });
}
