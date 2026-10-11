import { deriveReadToken, requireAuth } from "../security/auth.js";
import { jsonResponse } from "../utils/response.js";

export async function handleReadToken(request, env) {
  const readToken = env.SUB_READ_TOKEN || "";
  const configured = Boolean(readToken);

  if (!configured) {
    return jsonResponse({ configured: false });
  }

  const auth = requireAuth(request, env);
  if (!auth.authorized) {
    return jsonResponse({ configured: true });
  }

  // P2-7: 轮换开启时下发派生 token（当期有效），否则下发静态 token
  return jsonResponse({ configured: true, readToken: await deriveReadToken(env) });
}
