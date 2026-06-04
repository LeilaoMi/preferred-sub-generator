import { jsonResponse } from "../utils/response.js";

export async function handleReadToken(_request, env) {
  const token = env.SUB_READ_TOKEN || "";
  return jsonResponse({ readToken: token, configured: Boolean(token) });
}
