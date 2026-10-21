import { DocumentEditor } from "@/app/(app)/documents/[id]/editor";
import { createLetterAction, createPlanAction } from "@/app/(app)/professors/actions";
import { detectPlanField } from "@/lib/documents";
import { answerField, decideTrack } from "@/lib/onboarding";
import { describeProfessor, PROFESSOR_STATUS_LABELS, professorAffiliation } from "@/lib/professors";
import type { DocTab } from "@/lib/shell";
import { getDocument } from "@/server/documents";
import { getProfile } from "@/server/profile";
import { getSavedProfessor, listSavedProfessors } from "@/server/professors";
import { TaskDetail } from "@/components/tasks/task-detail";
import { describeTask } from "@/lib/tasks";
import { getTaskConversation } from "@/server/conversations";
import { getTodo, taskLinks, toTaskView } from "@/server/todos";
import { AiDocContent } from "./ai-doc-content";
import { OpenTabLink } from "./app-shell";
import { WebTab } from "./web-tab";

// 文稿栏当前标签的内容（服务器渲染）。title 为 null 表示对应数据已不存在，外壳会关掉这个标签。

export async function renderDocTab(userId: string, tab: DocTab | null): Promise<{ title: string | null; node: React.ReactNode }> {
  // 没有标签时文稿栏不显示
  if (!tab) return { title: null, node: null };
  if (tab.kind === "web") return { title: tab.title, node: <WebTab key={tab.url} url={tab.url} title={tab.title} /> };
  if (tab.kind === "professor") return professorTab(userId, tab.id);
  if (tab.kind === "task") return taskTab(userId, tab.id);
  return documentTab(userId, tab.id);
}

async function documentTab(userId: string, id: string) {
  const [doc, profile, professors] = await Promise.all([getDocument(userId, id), getProfile(userId), listSavedProfessors(userId)]);
  if (!doc) return { title: null, node: null };
  const onboarding = profile?.onboarding;
  const linked = professors.find((p) => p.id === doc.targetProfessor?.professorId);
  return {
    title: doc.title,
    node: (
      <div className="px-4 py-6">
        <DocumentEditor
          key={doc.id}
          doc={{
            id: doc.id,
            kind: doc.kind,
            title: doc.title,
            markdown: doc.markdown,
            version: doc.version,
            targetProfessor: doc.targetProfessor,
          }}
          planField={detectPlanField(doc.markdown, answerField(onboarding) ?? "humanities")}
          track={onboarding ? decideTrack(onboarding) : null}
          professors={professors.map((p) => ({ id: p.id, label: `${p.name}（${p.university}）` }))}
          linkedStatus={linked?.status ?? null}
        />
      </div>
    ),
  };
}

async function professorTab(userId: string, id: string) {
  const p = await getSavedProfessor(userId, id);
  if (!p) return { title: null, node: null };
  const btn = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-500 dark:border-zinc-700";
  return {
    title: p.name,
    node: (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <AiDocContent text={`教授详情（教授清单）：\n${describeProfessor(p)}`} />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <p className="text-sm text-zinc-500">
            {professorAffiliation(p)} · {PROFESSOR_STATUS_LABELS[p.status]}
            {p.followUpDate && ` · 跟进 ${p.followUpDate}`}
          </p>
        </div>
        {p.research && <p className="text-sm leading-relaxed">{p.research}</p>}
        {p.papers.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-sm font-medium">代表论文</h2>
            <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400" lang="ja">
              {p.papers.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        )}
        {p.acceptsInternational && <p className="text-sm text-zinc-600 dark:text-zinc-400">留学生：{p.acceptsInternational}</p>}
        {p.note && <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm whitespace-pre-wrap dark:bg-zinc-900">备注：{p.note}</p>}
        {p.sources.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-sm font-medium">来源（在文稿栏打开）</h2>
            <ul className="space-y-1 text-sm">
              {p.sources.map((s) => (
                <li key={s.url}>
                  <OpenTabLink tab={{ kind: "web", url: s.url, title: s.title }} href={s.url} className="text-blue-600 hover:underline dark:text-blue-400">
                    {s.title}
                  </OpenTabLink>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          <form action={createLetterAction.bind(null, p.id)}>
            <button className={btn}>写套磁信</button>
          </form>
          <form action={createPlanAction.bind(null, p.id)}>
            <button className={btn}>以这位教授为目标写计划书</button>
          </form>
        </div>
      </div>
    ),
  };
}

async function taskTab(userId: string, id: string) {
  const row = await getTodo(userId, id);
  if (!row) return { title: null, node: null };
  const [links, conversation] = await Promise.all([taskLinks(userId, row), getTaskConversation(userId, id)]);
  const task = toTaskView(row);
  const aiText = `任务详情（用户正在看）：\n${describeTask(task, { professor: links.professor?.label, document: links.document?.title, school: links.school?.name })}`;
  return { title: row.title, node: <TaskDetail key={row.id} task={task} links={links} started={!!conversation} aiText={aiText} /> };
}

