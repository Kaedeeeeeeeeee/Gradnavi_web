import "server-only";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { env } from "@/lib/env";
import { demoModel } from "./demo-model";

// 换模型只改环境变量：DEEPSEEK_API_KEY / DEEPSEEK_MODEL / DEEPSEEK_BASE_URL
export function getChatModel() {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return demoModel;
  const deepseek = createDeepSeek({ apiKey, baseURL: env.DEEPSEEK_BASE_URL });
  return deepseek(env.DEEPSEEK_MODEL);
}

/** 读图片用的模型（DeepSeek flash 支持图片输入，不支持直接读 PDF） */
export function getVisionModel() {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return demoModel;
  const deepseek = createDeepSeek({ apiKey, baseURL: env.DEEPSEEK_BASE_URL });
  return deepseek(env.DEEPSEEK_VISION_MODEL);
}

export const isDemoMode = () => !env.DEEPSEEK_API_KEY;
