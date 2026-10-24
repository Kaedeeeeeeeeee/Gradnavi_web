import { inflateRawSync } from "node:zlib";

// Word（.docx）取文字：.docx 是 zip，正文在 word/document.xml。只需要读一个文件，
// 所以用 node:zlib 自己解 zip，不另装依赖。段落换行，表格（日本的履歴書多是表格）每行一行、格子之间用「 | 」隔开。
// 旧的 .doc（二进制格式）读不了，上传时就提示另存为 .docx / PDF。

const MAX_XML_BYTES = 30 * 1024 * 1024;

/** 从 zip 里取出一个文件；没有这个文件返回 null */
export function readZipEntry(zip: Uint8Array, name: string): Uint8Array | null {
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  // 文件末尾的「中央目录结束」记录（后面可能跟最长 65535 字节的注释）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 .docx 文件");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("不是有效的 .docx 文件");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (method === 0) return new Uint8Array(data);
    if (method === 8) return new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES }));
    throw new Error("不支持的 .docx 压缩方式");
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** word/document.xml → 纯文字 */
export function wordXmlToText(xml: string): string {
  let out = "";
  let inText = false;
  let cell = 0;
  let inProps = false;
  // 末尾的空格 / 分隔符去掉（endsWith + slice 不会复制整串）
  const trimEnd = (suffix: string) => {
    while (out.endsWith(suffix)) out = out.slice(0, -suffix.length);
  };
  for (const m of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>|([^<]+)/g)) {
    const [, close, tag, selfClose, text] = m;
    if (text !== undefined) {
      if (inText) out += decodeEntities(text);
      continue;
    }
    if (tag === "w:t") inText = !close && !selfClose;
    // 段落属性里的 <w:tab> 是制表位设置，不是正文里的 Tab
    else if (tag === "w:pPr") inProps = !close && !selfClose;
    else if (tag === "w:tab" && !close && !inProps) out += "\t";
    else if ((tag === "w:br" || tag === "w:cr") && !close) out += "\n";
    else if (tag === "w:p" && (close || selfClose)) out += cell ? " " : "\n";
    else if (tag === "w:tc" && !selfClose) {
      // 格子里的几段用空格连起来，格子之间用「 | 」
      if (close) {
        cell--;
        trimEnd(" ");
        out += " | ";
      } else cell++;
    } else if (tag === "w:tr" && close) {
      trimEnd(" | ");
      out += "\n";
    }
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function docxToText(data: Uint8Array): string {
  const xml = readZipEntry(data, "word/document.xml");
  if (!xml) throw new Error("不是有效的 .docx 文件");
  return wordXmlToText(new TextDecoder().decode(xml));
}
