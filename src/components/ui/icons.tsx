// 图标体系（2026-10-23 kaede 同意方案 B）：
// - 图标只回答「这是什么」：导航、卡片标题、分组、日历事件类型、联系进度当前一步、文书类型、AI 的动作、空状态。
// - 普通按钮（保存、取消、同意…）、每条任务（已有状态圆圈）、正文不加；同一行最多一个图标；不用 emoji。
// - 线条图标来自 lucide-react，16px、线宽 1.75，默认 text-muted；只有截止（红）、提醒（橙）这类本来有颜色的状态才上色。
// - 彩色小方块（Tile，Notion 的 9 色）只用在分组、教授、文书前面；教授用名字第一个字。

import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  BookmarkMinus,
  BookmarkPlus,
  Brain,
  CalendarDays,
  CalendarPlus,
  CalendarX,
  Copy,
  FilePlus,
  Globe,
  ListChecks,
  ListPlus,
  Search,
  UserRound,
  UserSearch,
  BookOpen,
  CircleDashed,
  CircleEllipsis,
  ClipboardList,
  Clock,
  FileText,
  Flag,
  GraduationCap,
  House,
  IdCard,
  Landmark,
  Languages,
  Mail,
  MailOpen,
  MessagesSquare,
  NotebookPen,
  PencilLine,
  Send,
  Sparkles,
  CircleX,
} from "lucide-react";
import type { CalendarKind } from "@/lib/calendar";
import type { DocKind } from "@/lib/documents";
import type { TaskArea } from "@/lib/tasks";

export type TileColor = "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";

/** 线条图标；className 里写了 size-* / text-* 就用写的，否则 16px、text-muted */
export function Icon({ icon: C, className = "", label }: { icon: LucideIcon; className?: string; label?: string }) {
  const size = /(^|\s)size-/.test(className) ? "" : "size-4";
  const color = /(^|\s)text-/.test(className) ? "" : "text-muted";
  return <C strokeWidth={1.75} aria-hidden={label ? undefined : true} aria-label={label} className={`shrink-0 ${size} ${color} ${className}`} />;
}

/** Notion 式彩色小方块：放一个字（教授名第一个字）或一个图标 */
export function Tile({ color, icon, text, className = "" }: { color: TileColor; icon?: LucideIcon; text?: string; className?: string }) {
  const C = icon;
  return (
    <span
      aria-hidden
      style={{ background: `var(--doc-${color}-bg)`, color: `var(--doc-${color})` }}
      className={`inline-grid size-5 shrink-0 place-items-center rounded-[5px] text-[11px] font-semibold leading-none ${className}`}
    >
      {C ? <C strokeWidth={1.9} className="size-3.5" /> : text?.trim().charAt(0)}
    </span>
  );
}

const TILE_COLORS: TileColor[] = ["blue", "green", "orange", "purple", "pink", "brown", "red", "yellow"];

/** 按名字固定挑一个颜色（同一位教授在各处颜色一样） */
export function colorFor(key: string): TileColor {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

/** 教授：名字第一个字的彩色方块 */
export function PersonTile({ name, className }: { name: string; className?: string }) {
  return <Tile color={colorFor(name)} text={name} className={className} />;
}

/** 研究科（只有研究科、还没定教授的志愿或分组） */
export function SchoolTile({ className }: { className?: string }) {
  return <Tile color="brown" icon={Landmark} className={className} />;
}

export const NAV_ICONS: Record<string, LucideIcon> = {
  "/workbench": House,
  "/aspirations": GraduationCap,
  "/documents": FileText,
};
export const AI_ICON = Sparkles;

export const DOC_KIND_ICONS: Record<DocKind, { icon: LucideIcon; color: TileColor }> = {
  plan: { icon: NotebookPen, color: "purple" },
  letter: { icon: Mail, color: "blue" },
  intro: { icon: IdCard, color: "green" },
  other: { icon: FileText, color: "gray" },
};

export function DocKindTile({ kind, className }: { kind: DocKind; className?: string }) {
  const k = DOC_KIND_ICONS[kind] ?? DOC_KIND_ICONS.other;
  return <Tile color={k.color} icon={k.icon} className={className} />;
}

/** 日历事件类型：截止 = 旗子（红），考试/面试 = 笔（橙），跟进 = 信封（蓝），其他 = 时钟 */
export const CALENDAR_KIND_ICONS: Record<CalendarKind, { icon: LucideIcon; tone: string }> = {
  deadline: { icon: Flag, tone: "text-danger" },
  exam: { icon: PencilLine, tone: "text-warn" },
  followup: { icon: Mail, tone: "text-info" },
  other: { icon: Clock, tone: "text-muted" },
};

/** 待办分组的固定分类 */
export const CATEGORY_TILES: Record<TaskArea, { icon: LucideIcon; color: TileColor }> = {
  language: { icon: Languages, color: "purple" },
  study: { icon: BookOpen, color: "green" },
  prep: { icon: ClipboardList, color: "orange" },
  other: { icon: CircleEllipsis, color: "gray" },
};

/** 联系进度：只在当前那一步显示图标 */
export const CONTACT_ICONS: Record<string, LucideIcon> = {
  to_contact: CircleDashed,
  contacted: Send,
  replied: MailOpen,
  interview: MessagesSquare,
  accepted: BadgeCheck,
  dropped: CircleX,
};

/** AI 动作记录（工具调用）前面的图标：找教授、查资料、读网页、写文书、写日历、建任务、记住… */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  read_user_md: Brain,
  update_user_md: Brain,
  list_todos: ListChecks,
  add_todos: ListPlus,
  update_todo: ListChecks,
  delete_todo: ListChecks,
  list_documents: FileText,
  read_document: FileText,
  create_document: FilePlus,
  update_document_section: PencilLine,
  replace_document_text: PencilLine,
  update_document: PencilLine,
  propose_outline: PencilLine,
  create_tailored_copy: Copy,
  search_professors: UserSearch,
  list_aspirations: GraduationCap,
  save_professor: BookmarkPlus,
  update_saved_professor: UserRound,
  update_school_requirements: Landmark,
  web_search: Search,
  fetch_page: Globe,
  list_calendar: CalendarDays,
  add_calendar_event: CalendarPlus,
  update_calendar_event: CalendarPlus,
  delete_calendar_event: CalendarX,
  list_watched_schools: Landmark,
  watch_school: BookmarkPlus,
  unwatch_school: BookmarkMinus,
};
