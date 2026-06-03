import { parseVlessUri } from "../parser/vless.js";
import { requireAuth } from "../security/auth.js";
import { checkRateLimit } from "../security/rate-limit.js";
import { jsonResponse } from "../utils/response.js";
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

function toTemplateSafe(uri) {
  const parsed = parseVlessUri(uri);
  const uuid = parsed.uuid || "";
  const masked = uuid.length > 8 ? uuid.slice(0, 8) + "…" : uuid;
  return {
    uuidMasked: masked,
    address: parsed.address,
    port: parsed.port,
    security: parsed.security,
    host: parsed.host,
    sni: parsed.sni,
    name: parsed.name,
  };
}

function getClientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
}

async function writeTemplateAudit(kv, request, key = "TEMPLATE") {
  const audit = {
    lastTemplateUpdatedAt: new Date().toISOString(),
    lastTemplateKey: key,
    lastTemplateUpdateIp: getClientIp(request),
    lastTemplateUpdateUserAgent: request.headers.get("user-agent") || "unknown",
  };
  await kv.put("TEMPLATE_AUDIT", JSON.stringify(audit, null, 2));
}

function denyUnauthorized(request, env) {
  const rate = checkRateLimit(request);
  if (!rate.allowed) return jsonResponse({ error: rate.error }, rate.status);

  const auth = requireAuth(request, env);
  if (auth.authorized) return null;
  return jsonResponse({ error: auth.reason }, auth.reason === "Missing SUB_TOKEN" ? 500 : 401);
}

function templateKeyFromRequest(request) {
  const slot = new URL(request.url).searchParams.get("slot") || "";
  if (!slot) return "TEMPLATE";
  if (!/^\d{1,2}$/.test(slot)) return "TEMPLATE";
  const n = Number(slot);
  return n >= 1 && n <= 5 ? `TEMPLATE_${n}` : "TEMPLATE";
}

export async function handleTemplateGet(request, env) {
  const denied = denyUnauthorized(request, env);
  if (denied) return denied;

  const key = templateKeyFromRequest(request);
  const raw = await readRawTemplate(env.SUB_KV, key);
  return jsonResponse({ key, templateSafe: toTemplateSafe(raw), preview: toTemplatePreview(raw) });
}

export async function handleTemplatePost(request, env) {
  const denied = denyUnauthorized(request, env);
  if (denied) return denied;

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

  const key = templateKeyFromRequest(request);
  await writeTemplate(env.SUB_KV, template, key);
  await writeTemplateAudit(env.SUB_KV, request, key);
  return jsonResponse({ saved: true, key, preview });
}
