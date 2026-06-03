import { parseVlessUri } from "../parser/vless.js";
import { isAuthorized } from "../security/auth.js";
import { jsonResponse, unauthorizedResponse } from "../utils/response.js";
import { readRawTemplate, writeTemplate } from "./kv.js";

function toTemplatePreview(uri) {
  const parsed = parseVlessUri(uri);
  return {
    uuid: parsed.uuid,
    address: parsed.address,
    port: parsed.port,
    security: parsed.security,
    type: parsed.type,
    host: parsed.host,
    sni: parsed.sni,
    path: parsed.path,
    name: parsed.name,
  };
}

export async function handleTemplateGet(request, env) {
  if (!isAuthorized(request, env)) return unauthorizedResponse();

  const raw = await readRawTemplate(env.SUB_KV);
  return jsonResponse({ template: raw, preview: toTemplatePreview(raw) });
}

export async function handleTemplatePost(request, env) {
  if (!isAuthorized(request, env)) return unauthorizedResponse();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const template = String(body?.template || "").trim();
  if (!template.startsWith("vless://")) {
    return jsonResponse({ error: "Template must be a vless:// URI" }, 400);
  }

  let preview;
  try {
    preview = toTemplatePreview(template);
  } catch {
    return jsonResponse({ error: "Invalid VLESS URI" }, 400);
  }

  await writeTemplate(env.SUB_KV, template);
  return jsonResponse({ saved: true, preview });
}
