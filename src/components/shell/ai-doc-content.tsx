"use client";

import { useAiPageContent } from "@/components/ai/page-context";

/** 服务器渲染的文稿栏内容也能把文字提供给 AI */
export function AiDocContent({ text }: { text: string }) {
  useAiPageContent(text, "doc");
  return null;
}
