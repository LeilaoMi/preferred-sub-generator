import { handleHealth } from "../../src/api/health.js";

export async function onRequestGet({ request, env }) {
  return handleHealth(request, env);
}
