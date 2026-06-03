import { handleTemplateGet, handleTemplatePost } from "../../src/api/template.js";

export async function onRequestGet({ request, env }) {
  return handleTemplateGet(request, env);
}

export async function onRequestPost({ request, env }) {
  return handleTemplatePost(request, env);
}
