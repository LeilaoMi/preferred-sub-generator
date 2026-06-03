import { handleStatus } from "../src/api/status.js";

export async function onRequestGet({ request, env }) {
  return handleStatus(request, env);
}
