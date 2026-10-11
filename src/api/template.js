import { parseVlessUri } from "../parser/vless.js";
import { requireAuth } from "../security/auth.js";
import { checkRateLimit } from "../security/rate-limit.js";
import { jsonResponse } from "../utils/response.js";
import { readRawTemplate, writeTemplate } from "./kv.js";

// 已知在中国大陆被 SNI 阻断 / 高风险的域名后缀
const RISKY_SNI_PATTERNS = [
  { pattern: /(^|\.)workers\.dev$/i, reason: "workers.dev 在中国大陆普遍被 SNI 阻断（RST），节点 TLS 握手会直接被掐断" },
  { pattern: /(^|\.)pages\.dev$/i, reason: "pages.dev 存在被 SNI 干扰的风险" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 校验模板字段。返回 warnings 数组，每项 { field, level, message }。
 * level=error 会阻止保存，level=warn 仅提示。
 */
export function validateTemplateFields(input = {}) {
  const fields = normalizeFields(input);
  const warnings = [];

  if (!UUID_RE.test(fields.uuid || "")) {
    warnings.push({ field: "uuid", level: "error", message: "UUID 缺失或格式不正确（应为 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）" });
  }
  if (!String(fields.host || "").trim()) {
    warnings.push({ field: "host", level: "error", message: "Host 不能为空：它决定节点流量路由到哪个后端" });
  }
  if (String(fields.security || "tls") === "tls" && !String(fields.sni || "").trim()) {
    warnings.push({ field: "sni", level: "error", message: "TLS 模式下 SNI 不能为空" });
  }

  const sni = String(fields.sni || "").trim();
  for (const { pattern, reason } of RISKY_SNI_PATTERNS) {
    if (sni && pattern.test(sni)) {
      warnings.push({
        field: "sni",
        level: "warn",
        message: `SNI 为 ${sni}：${reason}。建议把 SNI 换成自有域名做前置（Host 保持不变）。`,
      });
      break;
    }
  }
  if (String(fields.type || "ws") === "ws" && !String(fields.path || "").trim()) {
    warnings.push({ field: "path", level: "warn", message: "WS 模式下路径为空，确认后端不需要特定路径" });
  }
  return warnings;
}

export function normalizeFields(input = {}) {
  return {
    uuid: String(input.uuid || "").trim(),
    host: String(input.host || "").trim(),
    sni: String(input.sni || "").trim(),
    path: String(input.path || "").trim(),
    port: input.port === "" || input.port == null ? 443 : Number(input.port) || 443,
    security: String(input.security || "tls").trim() || "tls",
    type: String(input.type || "ws").trim() || "ws",
    params: input.params && typeof input.params === "object" ? { ...input.params } : {},
  };
}

/** 分字段 → 与 parseVlessUri 同形的规范模板对象（KV 存 JSON 用） */
export function fieldsToCanonical(input = {}) {
  const f = normalizeFields(input);
  return {
    protocol: "vless",
    uuid: f.uuid,
    address: "",
    port: f.port,
    name: "",
    type: f.type,
    security: f.security,
    host: f.host,
    sni: f.sni,
    path: f.path,
    params: f.params,
  };
}

/** 旧式 vless:// URI → 分字段（导入用） */
export function uriToFields(uri) {
  const parsed = parseVlessUri(uri);
  return normalizeFields({
    uuid: parsed.uuid,
    host: parsed.host,
    sni: parsed.sni,
    path: parsed.path,
    port: parsed.port || 443,
    security: parsed.security,
    type: parsed.type,
    params: parsed.params,
  });
}

function toTemplatePreview(canonical) {
  return {
    uuid: canonical.uuid,
    address: canonical.address,
    port: canonical.port,
    security: canonical.security,
    type: canonical.type,
    host: canonical.host,
    sni: canonical.sni,
    path: canonical.path,
    name: canonical.name,
  };
}

function toTemplateSafeFromCanonical(canonical) {
  const uuid = canonical.uuid || "";
  const masked = uuid.length > 8 ? uuid.slice(0, 8) + "…" : uuid;
  return {
    uuidMasked: masked,
    address: canonical.address,
    port: canonical.port,
    security: canonical.security,
    host: canonical.host,
    sni: canonical.sni,
    name: canonical.name,
  };
}

/** 兼容旧 KV：存的是 vless:// 字符串则解析，存的是 JSON 则直接用 */
function readCanonical(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Empty template");
  if (text.startsWith("vless://")) {
    return fieldsToCanonical(uriToFields(text));
  }
  const obj = JSON.parse(text);
  return fieldsToCanonical(obj);
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
  let canonical;
  try {
    canonical = readCanonical(raw);
  } catch {
    return jsonResponse({ error: "Invalid stored template" }, 500);
  }
  const templateSafe = toTemplateSafeFromCanonical(canonical);
  // 管理端编辑用：返回完整分字段（已通过管理鉴权；订阅链接本身就携带 UUID，不新增暴露面）
  const fields = { ...canonical };
  delete fields.params;
  return jsonResponse({ key, templateSafe, preview: templateSafe, fields, params: canonical.params || {} });
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

  let fields;
  if (body?.fields && typeof body.fields === "object") {
    fields = normalizeFields(body.fields);
  } else {
    // 兼容旧式：直接粘 vless:// 链接，服务端同样解析成分字段再校验，不再静默照抄
    const template = String(body?.template || "").trim();
    if (!template.startsWith("vless://")) {
      return jsonResponse({ error: "需要 fields 对象或 vless:// 链接" }, 400);
    }
    try {
      fields = uriToFields(template);
    } catch {
      return jsonResponse({ error: "Invalid VLESS URI" }, 400);
    }
  }

  const warnings = validateTemplateFields(fields);
  const errors = warnings.filter((w) => w.level === "error");
  if (errors.length > 0) {
    return jsonResponse({ error: errors[0].message, warnings }, 400);
  }

  const canonical = fieldsToCanonical(fields);
  const key = templateKeyFromRequest(request);
  await writeTemplate(env.SUB_KV, JSON.stringify(canonical), key);
  await writeTemplateAudit(env.SUB_KV, request, key);
  return jsonResponse({ saved: true, key, preview: toTemplatePreview(canonical), warnings });
}
