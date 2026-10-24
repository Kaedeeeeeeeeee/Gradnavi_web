import { DocumentEditor } from "@/app/(app)/documents/[id]/editor";
import { AspirationDetail, SchoolAspirationDetail } from "@/components/aspirations/aspiration-detail";
import { SearchResults, type CandidateView } from "@/components/aspirations/search-results";
import { projectGuide } from "@/lib/admissions";
import { contactLabel, describeAspiration, languageLabel, matchSchool, nextDeadline, sortAspirations } from "@/lib/aspirations";
import { todayJst } from "@/lib/calendar";
import { decideTrack } from "@/lib/onboarding";
import { candidateKey, describeProfessor } from "@/lib/professors";
import type { DocTab } from "@/lib/shell";
import { getAspiration, getSchoolAspiration, listAspirations } from "@/server/aspirations";
import { CompareView } from "@/components/aspirations/compare-table";
import { getDocumentBundle, listDocuments } from "@/server/documents";
import { getProfile } from "@/server/profile";
import { getProfessorSearch } from "@/server/professor-search";
import { listSavedProfessors, savedKeys } from "@/server/professors";
import { listWatchedSchools } from "@/server/schools";
import { TaskDetail } from "@/components/tasks/task-detail";
import { describeTask } from "@/lib/tasks";
import { summarizeToolCalls } from "@/lib/task-report";
import { getTaskConversation, listToolCalls } from "@/server/conversations";
import { getTodo, taskLinks, watchedSchoolRefs, toTaskView } from "@/server/todos";
import { WebTab } from "./web-tab";

// 文稿栏当前标签的内容（服务器渲染）。title 为 null 表示对应数据已不存在，外壳会关掉这个标签。

export async function renderDocTab(userId: string, tab: DocTab | null): Promise<{ title: string | null; node: React.ReactNode }> {
  // 没有标签时文稿栏不显示
  if (!tab) return { title: null, node: null };
  if (tab.kind === "web") return { title: tab.title, node: <WebTab key={tab.url} url={tab.url} title={tab.title} /> };
  if (tab.kind === "professor") return professorTab(userId, tab.id);
  if (tab.kind === "school") return schoolTab(userId, tab.id);
  if (tab.kind === "task") return taskTab(userId, tab.id);
  if (tab.kind === "search") return searchTab(userId, tab.id);
  if (tab.kind === "compare") return compareTab(userId);
  return documentTab(userId, tab.id);
}

async function documentTab(userId: string, id: string) {
  const [bundle, profile, professors, docs] = await Promise.all([getDocumentBundle(userId, id), getProfile(userId), listSavedProfessors(userId), listDocuments(userId)]);
  if (!bundle) return { title: null, node: null };
  const { doc } = bundle;
  const onboarding = profile?.onboarding;
  const linked = professors.find((p) => p.id === doc.targetProfessor?.professorId);
  return {
    title: doc.title,
    node: (
      <div className="px-6 py-8">
        <DocumentEditor
          key={doc.id}
          doc={{
            id: doc.id,
            kind: doc.kind,
            title: doc.title,
            markdown: doc.markdown,
            version: doc.version,
            targetProfessor: doc.targetProfessor,
            zh: doc.zh,
            outline: doc.outline,
            writeMode: doc.writeMode,
          }}
          track={onboarding ? decideTrack(onboarding) : null}
          professors={professors.map((p) => ({ id: p.id, label: `${p.name}（${p.university}）` }))}
          linkedStatus={linked?.status ?? null}
          suggestions={bundle.suggestions.map((s) => ({ id: s.id, op: s.op, zh: s.zh, summary: s.summary, source: s.source }))}
          comments={bundle.comments.map((c) => ({ id: c.id, quote: c.quote, body: c.body, category: c.category, status: c.status }))}
          parent={bundle.parent && { ...bundle.parent, version: doc.parentVersion }}
          copies={bundle.copies.map((c) => ({ id: c.id, title: c.title, professorName: c.targetProfessor?.name ?? null, parentVersion: c.parentVersion }))}
          attachment={bundle.attachment}
          plans={docs
            .filter((d) => d.kind === "plan")
            .map((d) => ({ id: d.id, title: d.title, professorId: d.targetProfessor?.professorId ?? null, isCopy: !!d.parentId }))}
          versionCount={bundle.versionCount}
        />
      </div>
    ),
  };
}

async function professorTab(userId: string, id: string) {
  const [a, documents] = await Promise.all([getAspiration(userId, id, todayJst()), listDocuments(userId)]);
  if (!a?.professor) return { title: null, node: null };
  // 关联这位教授的文书（定制版计划书、套磁信）
  const related = documents.filter((d) => d.targetProfessor?.professorId === id).map((d) => ({ id: d.id, title: d.title }));
  return {
    title: a.professor.name,
    node: <AspirationDetail key={id} a={{ ...a, professor: a.professor }} documents={related} aiText={`志愿详情（用户正在看）：\n${describeAspiration(a)}`} />,
  };
}

async function schoolTab(userId: string, id: string) {
  const a = await getSchoolAspiration(userId, id, todayJst());
  if (!a?.school) return { title: null, node: null };
  // 研究科已经关联了教授：显示那条志愿（教授 + 研究科）
  if (a.professor) return professorTab(userId, a.professor.id);
  const title = `${a.school.university} ${a.school.name}`;
  return { title, node: <SchoolAspirationDetail key={id} a={{ ...a, school: a.school }} aiText={`志愿详情（用户正在看，只有研究科）：\n${describeAspiration(a)}`} /> };
}

async function searchTab(userId: string, id: string) {
  const search = await getProfessorSearch(userId, id);
  if (!search) return { title: null, node: null };
  const today = todayJst();
  // 候选教授所在的研究科用户已经关注了：卡片上带出入试要点和截止日（监控结果只属于这个用户）
  const [saved, watched] = await Promise.all([savedKeys(userId, search.candidates), listWatchedSchools(userId, today)]);
  const savedBy = new Map(saved.map((p) => [candidateKey(p), p]));
  const schools = watched.map((w) => w.school);
  const guides = new Map(watched.flatMap((w) => (w.guide ? [[w.school.id, w.guide] as const] : [])));
  const candidates: CandidateView[] = search.candidates.map((c) => {
    const key = candidateKey(c);
    const p = savedBy.get(key);
    const school = matchSchool(c, schools);
    const guide = school ? guides.get(school.id) : undefined;
    const items = school && guide ? projectGuide({ schoolId: school.id, schoolName: school.name, admissionYear: guide.admissionYear, events: guide.events }, today).items : [];
    const deadline = nextDeadline(items, today);
    return {
      key,
      candidate: c,
      saved: p ? { id: p.id, status: p.status } : null,
      rejected: key in search.rejected ? search.rejected[key] : null,
      school: school
        ? {
            name: school.name,
            contact: contactLabel(school.requirements),
            language: languageLabel(school.requirements),
            deadline: deadline ? { date: deadline.date, tentative: deadline.tentative } : null,
          }
        : null,
    };
  });
  const aiText = [
    `找教授的候选卡片（用户正在看，第 ${search.id.slice(0, 8)} 轮）：关键词「${search.keywords}」，学校：${search.schools.join("、") || "不限"}${search.preference ? `，要求：${search.preference}` : ""}`,
    ...candidates.map(
      (c) =>
        `- ${describeProfessor(c.candidate)}${c.saved ? `【已加入志愿，教授 ID：${c.saved.id}】` : ""}${c.rejected !== null ? `【用户标了不合适：${c.rejected || "没说原因"}】` : ""}`,
    ),
  ].join("\n");
  return {
    title: `找教授：${search.keywords}`.slice(0, 40),
    node: (
      <SearchResults
        key={search.id}
        search={{ id: search.id, keywords: search.keywords, schools: search.schools, preference: search.preference, demo: search.demo, createdAt: search.createdAt.toISOString() }}
        candidates={candidates}
        aiText={aiText}
      />
    ),
  };
}

async function compareTab(userId: string) {
  const list = sortAspirations((await listAspirations(userId, todayJst())).filter((a) => a.professor?.status !== "dropped"));
  return { title: "对比志愿", node: <CompareView list={list} /> };
}

async function taskTab(userId: string, id: string) {
  const row = await getTodo(userId, id);
  if (!row) return { title: null, node: null };
  const [links, conversation, schools] = await Promise.all([taskLinks(userId, row), getTaskConversation(userId, id), watchedSchoolRefs(userId)]);
  const task = toTaskView(row);
  // 待你确认：列出 AI 在这个任务的对话里做了什么，每条能直接打开
  const report = task.status === "review" ? summarizeToolCalls(conversation ? await listToolCalls(conversation.id) : []) : null;
  const aiText = `任务详情（用户正在看）：\n${describeTask(task, { professor: links.professor?.label, document: links.document?.title, school: links.school?.name })}`;
  return { title: row.title, node: <TaskDetail key={row.id} task={task} links={links} schools={schools} started={!!conversation} aiText={aiText} report={report} /> };
}

