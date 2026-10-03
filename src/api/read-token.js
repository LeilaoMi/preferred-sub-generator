import { requireAuth } from "../security/auth.js";
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

  return jsonResponse({ configured: true, readToken });
}
