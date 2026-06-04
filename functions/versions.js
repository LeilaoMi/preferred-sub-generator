import { handleVersions } from "../src/api/versions.js";

export async function onRequestGet({ request, env }) {
  return handleVersions(request, env);
}
