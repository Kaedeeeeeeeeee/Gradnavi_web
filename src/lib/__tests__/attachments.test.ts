import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { docxToText, readZipEntry, wordXmlToText } from "../../server/docx-text";
import { attachmentKind, attachmentsForModel, cleanFileName, clipContent, formatSize, MAX_ATTACHMENTS, normalizedType, parseAttachmentRefs, uploadProblem } from "../attachments";

const ID = "0b0f3a3e-5d55-4a3c-9a43-2f8f3c1f7e11";

test("attachmentKind looks at the type and the extension", () => {
  assert.equal(attachmentKind("image/png", "a.png"), "image");
  assert.equal(attachmentKind("", "照片.JPG"), "image");
  assert.equal(attachmentKind("application/pdf", "x"), "pdf");
  assert.equal(attachmentKind("", "简历.pdf"), "pdf");
  assert.equal(attachmentKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "cv"), "docx");
  assert.equal(attachmentKind("text/plain", "a.txt"), "text");
  assert.equal(attachmentKind("", "notes.md"), "text");
  assert.equal(attachmentKind("application/msword", "old.doc"), null);
  assert.equal(attachmentKind("image/heic", "IMG.HEIC"), null);
  assert.equal(attachmentKind("image/svg+xml", "a.svg"), null);
});

test("normalizedType never stores html or a type that disagrees with the kind", () => {
  assert.equal(normalizedType("text", "text/html", "page.html"), "text/plain");
  assert.equal(normalizedType("text", "text/plain", "a.csv"), "text/csv");
  assert.equal(normalizedType("image", "", "a.webp"), "image/webp");
  assert.equal(normalizedType("pdf", "application/pdf", "scan.png"), "application/pdf");
});

test("uploadProblem explains unsupported and oversized files", () => {
  assert.equal(uploadProblem({ name: "cv.pdf", type: "application/pdf", size: 1000 }), null);
  assert.match(uploadProblem({ name: "cv.doc", type: "application/msword", size: 1000 })!, /另存为 PDF 或 \.docx/);
  assert.match(uploadProblem({ name: "a.zip", type: "application/zip", size: 1000 })!, /不是支持的格式/);
  assert.match(uploadProblem({ name: "a.png", type: "image/png", size: 11 * 1024 * 1024 })!, /图片最大 10 MB/);
  assert.match(uploadProblem({ name: "a.pdf", type: "application/pdf", size: 0 })!, /空文件/);
});

test("cleanFileName strips paths and keeps the extension when cutting", () => {
  assert.equal(cleanFileName("C:\\Users\\me\\简历.pdf"), "简历.pdf");
  assert.equal(cleanFileName("  "), "文件");
  const long = cleanFileName(`${"あ".repeat(200)}.docx`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(".docx"));
});

test("formatSize", () => {
  assert.equal(formatSize(500), "500 B");
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(1.5 * 1024 * 1024), "1.5 MB");
  assert.equal(formatSize(15 * 1024 * 1024), "15 MB");
});

test("parseAttachmentRefs keeps valid, unique ids and caps the count", () => {
  assert.deepEqual(parseAttachmentRefs("x"), []);
  assert.deepEqual(parseAttachmentRefs([{ id: "nope" }, { id: ID, name: "a/简历.pdf", mediaType: "application/pdf", size: 12.4 }, { id: ID }]), [
    { id: ID, name: "简历.pdf", mediaType: "application/pdf", size: 12 },
  ]);
  const many = Array.from({ length: 9 }, (_, i) => ({ id: ID.slice(0, -1) + i, name: "a", mediaType: "text/plain", size: 1 }));
  assert.equal(parseAttachmentRefs(many).length, MAX_ATTACHMENTS);
});

test("attachmentsForModel labels each file and flags unreadable ones", () => {
  assert.equal(attachmentsForModel([]), "");
  const text = attachmentsForModel([
    { ref: { id: ID, name: "简历.pdf", mediaType: "application/pdf", size: 1 }, content: "東京大学 卒業" },
    { ref: { id: ID, name: "证书.png", mediaType: "image/png", size: 1 }, content: null },
  ]);
  assert.match(text, /附上了 2 个文件/);
  assert.match(text, /\[附件 1\]《简历\.pdf》（PDF）\n<<<\n東京大学 卒業\n>>>/);
  assert.match(text, /\[附件 2\]《证书\.png》（图片）\n（这个文件没能读出内容/);
  assert.match(clipContent("a".repeat(50), 10), /^a{10}\n\n（文件后面的内容太长/);
});

test("wordXmlToText keeps paragraphs and turns tables into rows", () => {
  const xml = `<?xml version="1.0"?><w:document><w:body>
    <w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>履歴書</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">氏名 </w:t></w:r><w:r><w:tab/><w:t>張 &amp; 李</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>2020</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>北京大学</w:t></w:r></w:p><w:p><w:r><w:t>入学</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>卒業</w:t></w:r><w:r><w:br/><w:t>GPA 3.6</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  assert.equal(wordXmlToText(xml), "履歴書\n氏名 \t張 & 李\n2020 | 北京大学 入学\n | 卒業\nGPA 3.6");
});

/** 测试用：写一个最小的 zip（每个文件 deflate 压缩） */
function makeZip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(content);
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

test("docxToText reads word/document.xml out of the zip", () => {
  const zip = makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>研究計画書</w:t></w:r></w:p></w:body></w:document>" });
  assert.equal(readZipEntry(zip, "missing.xml"), null);
  assert.equal(docxToText(zip), "研究計画書");
  assert.throws(() => docxToText(new Uint8Array([1, 2, 3])), /不是有效的 \.docx/);
});
