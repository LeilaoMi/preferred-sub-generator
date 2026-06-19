import { handleSpeedtestFeedbackGet, handleSpeedtestFeedbackPost } from "../../src/api/speedtest-feedback.js";

export async function onRequestGet({ request, env }) {
  return handleSpeedtestFeedbackGet(request, env);
}

export async function onRequestPost({ request, env }) {
  return handleSpeedtestFeedbackPost(request, env);
}
