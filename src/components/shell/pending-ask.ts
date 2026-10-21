// 打开文书后要自动让 AI 做的事（如从找教授“写套磁信”进来要写初稿）。
// 文书在文稿栏由服务器渲染，进入时带不了参数，所以先记在这里，编辑器挂载后取走（只取一次）。

type AutoAsk = "letter";

const pending = new Map<string, AutoAsk>();

export function queueAutoAsk(docId: string, ask: AutoAsk) {
  pending.set(docId, ask);
}

export function takeAutoAsk(docId: string): AutoAsk | null {
  const ask = pending.get(docId) ?? null;
  pending.delete(docId);
  return ask;
}
