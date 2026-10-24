// 聊天附件：用户在 AI 输入框里上传（按钮、拖进来、粘贴）图片、PDF、Word、文本文件，比如简历、成绩单、证书。
// 文件存在数据库里（按用户），用户消息里只放一个 data-attachments 部分（id、文件名、类型、大小），聊天记录里显示成小卡片；
// 发给模型时换成文件的文字内容（PDF / Word / 文本在本地取文字；图片和扫描版 PDF 交给看图模型转写，记在本轮对话的 credit 上）。
// 前后端和测试共用的纯函数放在这里。

export type AttachmentKind = "image" | "pdf" | "docx" | "text";

/** 消息里保存的附件信息（不含文件内容） */
export type AttachmentRef = { id: string; name: string; mediaType: string; size: number };

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 一个文件发给模型的文字上限（简历、成绩单一般几千字；长 PDF 截断） */
export const MAX_CONTENT_CHARS = 40_000;
const MAX_NAME = 120;

/** 文件选择框的 accept */
export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,.docx,.txt,.md,.csv";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** 按类型和扩展名判断是哪种附件；不支持的返回 null（浏览器给的类型有时为空，所以也看扩展名） */
export function attachmentKind(mediaType: string, name: string): AttachmentKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (IMAGE_TYPES.includes(mediaType) || (!mediaType && ["png", "jpg", "jpeg", "webp", "gif"].includes(ext))) return "image";
  if (mediaType === "application/pdf" || ext === "pdf") return "pdf";
  if (mediaType === DOCX || ext === "docx") return "docx";
  if (mediaType.startsWith("text/") || ["txt", "md", "csv"].includes(ext)) return "text";
  return null;
}

const EXT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  docx: DOCX,
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};
const KIND_TYPES: Record<AttachmentKind, string> = { image: "image/jpeg", pdf: "application/pdf", docx: DOCX, text: "text/plain" };

/** 存进数据库的类型（统一写法；其他 text/* 一律当纯文本，不会被浏览器当网页打开） */
export function normalizedType(kind: AttachmentKind, mediaType: string, name: string): string {
  if (kind === "image" && IMAGE_TYPES.includes(mediaType)) return mediaType;
  const byExt = EXT_TYPES[name.toLowerCase().split(".").pop() ?? ""];
  return byExt && attachmentKind(byExt, "") === kind ? byExt : KIND_TYPES[kind];
}

/** 上传前检查：不支持的类型、太大的文件给出提示，没问题返回 null */
export function uploadProblem(file: { name: string; type: string; size: number }): string | null {
  const kind = attachmentKind(file.type, file.name);
  if (!kind) {
    if (/\.(doc|heic|heif|pages|xls|xlsx|ppt|pptx)$/i.test(file.name)) return `「${file.name}」这种格式还读不了，请另存为 PDF 或 .docx 再发`;
    return `「${file.name}」不是支持的格式（图片、PDF、Word .docx、文本）`;
  }
  if (file.size === 0) return `「${file.name}」是空文件`;
  const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (file.size > limit) return `「${file.name}」太大了（${formatSize(file.size)}），${kind === "image" ? "图片" : "文件"}最大 ${formatSize(limit)}`;
  return null;
}

/** 文件名：去掉路径和控制字符，太长截断（保留扩展名） */
export function cleanFileName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim() || "文件";
  if (base.length <= MAX_NAME) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, MAX_NAME - ext.length) + ext;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** 校验消息里的附件信息（不合格的丢掉；是否属于这个用户由服务器另查） */
export function parseAttachmentRefs(data: unknown): AttachmentRef[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  return data
    .flatMap((a) => {
      if (!a || typeof a !== "object") return [];
      const { id, name, mediaType, size } = a as Record<string, unknown>;
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id) || seen.has(id)) return [];
      seen.add(id);
      return [
        {
          id,
          name: typeof name === "string" ? cleanFileName(name) : "文件",
          mediaType: typeof mediaType === "string" ? mediaType.slice(0, 100) : "application/octet-stream",
          size: typeof size === "number" && size >= 0 ? Math.round(size) : 0,
        },
      ];
    })
    .slice(0, MAX_ATTACHMENTS);
}

const KIND_LABELS: Record<AttachmentKind, string> = { image: "图片", pdf: "PDF", docx: "Word 文档", text: "文本文件" };

export function kindLabel(ref: Pick<AttachmentRef, "mediaType" | "name">): string {
  const kind = attachmentKind(ref.mediaType, ref.name);
  return kind ? KIND_LABELS[kind] : "文件";
}

export function clipContent(text: string, limit = MAX_CONTENT_CHARS): string {
  return text.length > limit ? `${text.slice(0, limit)}\n\n（文件后面的内容太长，省略了）` : text;
}

/** 发给模型的文字：每个文件一段，标出文件名和类型；没读出内容的说明一下，让 AI 请用户换个格式 */
export function attachmentsForModel(items: { ref: AttachmentRef; content: string | null }[]): string {
  if (!items.length) return "";
  const blocks = items.map(({ ref, content }, i) => {
    const head = `[附件 ${i + 1}]《${ref.name}》（${kindLabel(ref)}）`;
    if (content === null) return `${head}\n（这个文件没能读出内容。请告诉用户，并建议换成清晰的图片、PDF 或 .docx 再发。）`;
    if (!content.trim()) return `${head}\n（文件里没有文字）`;
    return `${head}\n<<<\n${content}\n>>>`;
  });
  return `用户在这条消息里附上了 ${items.length} 个文件，下面是文件内容（图片是转写出的文字和画面说明）：\n\n${blocks.join("\n\n")}\n\n（以上是附件。下面是用户这条消息的正文；没有正文时，先简单说说你从文件里看到了什么，再问用户想用它做什么。）`;
}
