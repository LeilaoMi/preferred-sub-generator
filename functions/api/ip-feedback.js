import { handleIpFeedbackGet, handleIpFeedbackPost } from "../../src/api/ip-feedback.js";

export async function onRequestGet({ request, env }) {
  return handleIpFeedbackGet(request, env);
}

export async function onRequestPost({ request, env }) {
  return handleIpFeedbackPost(request, env);
}
