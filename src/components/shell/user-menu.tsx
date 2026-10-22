"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// 顶栏右边的「我的」菜单：AI 对你的了解、反馈、管理、邮箱、退出登录收在一起，手机上顶栏也放得下。
// 宽屏上「AI 对你的了解」「反馈」仍然直接放在顶栏（inline 的项菜单里不重复）。

export type MenuItem = { href: string; label: string; inline?: boolean };

export function UserMenu({ email, items, signOut }: { email: string; items: MenuItem[]; signOut: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const link = "shrink-0 rounded-md px-2 py-1 text-muted hover:bg-subtle hover:text-foreground";
  return (
    <>
      {items
        .filter((i) => i.inline)
        .map((i) => (
          <Link key={i.href} href={i.href} className={`${link} max-lg:hidden`}>
            {i.label}
          </Link>
        ))}
      <div ref={ref} className="relative shrink-0">
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" className={`${link} ${open ? "bg-subtle text-foreground" : ""}`}>
          我的 <span className="text-[9px] opacity-60">▼</span>
        </button>
        {open && (
          <div role="menu" className="absolute top-full right-0 z-50 mt-1 w-56 rounded-xl border border-line bg-surface p-1 text-sm shadow-[0_4px_16px_rgb(15_15_15/0.12)]">
            <p className="truncate px-2.5 py-1.5 text-xs text-faint">{email}</p>
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`block rounded-md px-2.5 py-1.5 hover:bg-subtle ${i.inline ? "lg:hidden" : ""}`}
              >
                {i.label}
              </Link>
            ))}
            <div className="mt-1 border-t border-line pt-1 [&>button]:w-full [&>button]:px-2.5 [&>button]:py-1.5 [&>button]:text-left">{signOut}</div>
          </div>
        )}
      </div>
    </>
  );
}
