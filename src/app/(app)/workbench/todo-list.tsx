"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { useAskAi } from "@/components/ai/page-context";
import type { Kickoff } from "@/lib/next-steps";
import { addTodoAction, deleteTodoAction, toggleTodoAction } from "../actions";

type Todo = { id: string; title: string; note: string | null; done: boolean; dueDate: string | null; createdBy: string; kickoff: Kickoff };

export function TodoList({ todos }: { todos: Todo[] }) {
  const [optimistic, setOptimistic] = useOptimistic(todos, (state, { id, done }: { id: string; done: boolean }) =>
    state.map((t) => (t.id === id ? { ...t, done } : t)),
  );
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState("");

  const open = optimistic.filter((t) => !t.done);
  const finished = optimistic.filter((t) => t.done);

  function toggle(id: string, done: boolean) {
    startTransition(async () => {
      setOptimistic({ id, done });
      await toggleTodoAction(id, done);
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {open.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">没有待办了。可以在右侧问 AI 下一步做什么。</li>}
        {open.map((t) => (
          <Item key={t.id} todo={t} onToggle={toggle} />
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = title.trim();
          if (!value) return;
          setTitle("");
          startTransition(() => addTodoAction(value));
        }}
        className="flex gap-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="添加一条待办"
          className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
          添加
        </button>
      </form>

      {finished.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">已完成 {finished.length} 项</summary>
          <ul className="mt-2 space-y-1">
            {finished.map((t) => (
              <Item key={t.id} todo={t} onToggle={toggle} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Item({ todo, onToggle }: { todo: Todo; onToggle: (id: string, done: boolean) => void }) {
  const [, startTransition] = useTransition();
  const askAi = useAskAi();
  const router = useRouter();
  // 和 AI 一起开始这件事：发开场消息到侧边栏，或跳到对应页面（如套磁信编辑器）由页面让 AI 开工
  const start = () => ("href" in todo.kickoff ? router.push(todo.kickoff.href) : askAi(todo.kickoff.prompt));
  return (
    <li className="group flex items-start gap-3 px-4 py-2.5">
      <input type="checkbox" checked={todo.done} onChange={(e) => onToggle(todo.id, e.target.checked)} className="mt-1" />
      <div className="flex-1">
        <p className={`text-sm ${todo.done ? "text-zinc-400 line-through" : ""}`}>
          {todo.title}
          {todo.dueDate && !todo.done && <span className="ml-2 text-xs text-red-600">截止 {todo.dueDate.slice(5)}</span>}
          {todo.createdBy === "ai" && <span className="ml-2 text-xs text-zinc-400">AI 添加</span>}
        </p>
        {todo.note && !todo.done && <p className="text-xs text-zinc-500">{todo.note}</p>}
      </div>
      {!todo.done && (
        <button
          onClick={start}
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:border-zinc-500 dark:border-zinc-700"
        >
          让 AI 开始
        </button>
      )}
      <button
        onClick={() => startTransition(() => deleteTodoAction(todo.id))}
        className="text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-600"
      >
        删除
      </button>
    </li>
  );
}
