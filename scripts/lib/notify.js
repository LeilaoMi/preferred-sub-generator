// 手机友好的告警推送：配了哪个就推哪个，一个都没配就什么都不做（零配置不受影响）。
// - UPDATE_WEBHOOK_URL：原样 POST JSON（兼容旧行为）
// - TG_BOT_TOKEN + TG_CHAT_ID：Telegram 机器人
// - BARK_URL：iOS Bark，例如 https://api.day.app/你的key
export function formatAlertText(body = {}) {
  if (body.text) return String(body.text);
  const lines = [`[优选订阅] ${body.level || "info"} ${body.alertType || ""}`.trim()];
  if (Array.isArray(body.reasons) && body.reasons.length) lines.push(`原因: ${body.reasons.join(", ")}`);
  if (body.available != null) lines.push(`可用节点: ${body.available}`);
  if (body.error || body.lastError) lines.push(`错误: ${body.error || body.lastError}`);
  return lines.join("\n");
}

export function notifyTargets(env = process.env) {
  const targets = [];
  if (env.UPDATE_WEBHOOK_URL) targets.push("webhook");
  if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) targets.push("telegram");
  if (env.BARK_URL) targets.push("bark");
  return targets;
}

export async function sendNotification(body, { env = process.env, fetchImpl = fetch } = {}) {
  const text = formatAlertText(body);
  const jobs = [];
  if (env.UPDATE_WEBHOOK_URL) {
    jobs.push(fetchImpl(env.UPDATE_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  }
  if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
    jobs.push(fetchImpl(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text, disable_web_page_preview: true }),
    }));
  }
  if (env.BARK_URL) {
    const base = String(env.BARK_URL).replace(/\/+$/, "");
    jobs.push(fetchImpl(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "优选订阅告警", body: text, group: "preferred-sub" }),
    }));
  }
  if (!jobs.length) return false;
  const results = await Promise.allSettled(jobs);
  let delivered = false;
  for (const result of results) {
    if (result.status === "fulfilled" && result.value?.ok) delivered = true;
    else console.warn(`告警推送失败: ${result.status === "fulfilled" ? result.value?.status : result.reason?.message}`);
  }
  return delivered;
}
