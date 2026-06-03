import { handleBest } from "../src/api/best.js";

export async function onRequestGet({ request, env }) {
  return handleBest(request, env);
}
