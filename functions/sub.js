import { handleSub } from "../src/api/sub.js";

export async function onRequestGet({ request, env }) {
  return handleSub(request, env);
}
