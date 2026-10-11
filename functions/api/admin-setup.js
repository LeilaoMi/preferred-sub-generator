import { handleAdminSetupGet, handleAdminSetupPost } from "../../src/api/admin-setup.js";

export async function onRequestGet({ request, env }) {
  return handleAdminSetupGet(request, env);
}

export async function onRequestPost({ request, env }) {
  return handleAdminSetupPost(request, env);
}
