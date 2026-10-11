import { requireAuthAsync } from "../security/auth.js";
import { checkRateLimit } from "../security/rate-limit.js";
import { jsonResponse } from "../utils/response.js";
import { getNodeConfig, validateNodeConfig } from "../config/nodes.js";

// 模板已改为环境变量离散配置（对标竞品），不再有 KV 模板。
// /api/template 保留 GET 供探测脚本读取当前 SNI/Host，POST 已下线。

function toTemplateSafe(config) {
  const uuid = config.uuid || "";
  const masked = uuid.length > 8 ? uuid.slice(0, 8) + "…" : uuid;
  return {
    uuidMasked: masked,
    address: "",
    port: config.port,
    security: config.security,
    host: config.host,
    sni: config.sni,
    name: "",
  };
}

async function denyUnauthorized(request, env) {
  const rate = checkRateLimit(request);
  if (!rate.allowed) return jsonResponse({ error: rate.error }, rate.status);

  const auth = await requireAuthAsync(request, env);
  if (auth.authorized) return null;
  return jsonResponse({ error: auth.reason }, auth.reason === "Missing SUB_TOKEN" ? 500 : 401);
}

export async function handleTemplateGet(request, env) {
  const denied = await denyUnauthorized(request, env);
  if (denied) return denied;

  let config;
  try {
    config = getNodeConfig(env);
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
  const warnings = validateNodeConfig(config);
  const templateSafe = toTemplateSafe(config);
  // 管理端展示用完整字段（已通过管理鉴权；订阅链接本身就携带 UUID，不新增暴露面）
  const fields = { ...config };
  return jsonResponse({ key: "ENV", templateSafe, preview: templateSafe, fields, warnings });
}

export async function handleTemplatePost(request, env) {
  const denied = await denyUnauthorized(request, env);
  if (denied) return denied;

  return jsonResponse(
    {
      error: "模板已改为环境变量离散配置（VLESS_UUID / VLESS_SNI / VLESS_HOST / VLESS_PATH 等），请在 Cloudflare Dashboard 的 Pages 项目设置中修改，不再支持接口写入。",
    },
    410,
  );
}
