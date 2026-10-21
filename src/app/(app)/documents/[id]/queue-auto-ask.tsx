"use client";

import { useState } from "react";
import { queueAutoAsk } from "@/components/shell/pending-ask";

export function QueueAutoAsk({ docId }: { docId: string }) {
  // 在渲染时登记（比 OpenTabOnMount 的 effect 早），编辑器挂载时取走
  useState(() => typeof window !== "undefined" && queueAutoAsk(docId, "letter"));
  return null;
}
