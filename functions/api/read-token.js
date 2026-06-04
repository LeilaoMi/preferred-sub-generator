import { handleReadToken } from "../../src/api/read-token.js";

export async function onRequestGet({ request, env }) {
  return handleReadToken(request, env);
}
