import { handleCnVerified } from "../src/api/cn-verified-endpoint.js";

export async function onRequestGet({ request, env }) {
  return handleCnVerified(request, env);
}
