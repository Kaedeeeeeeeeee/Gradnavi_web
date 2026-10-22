"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDate, monthGrid, shiftMonth, todayJst } from "@/lib/calendar";

// 日期框：显示和页面上其他地方一样的「10/24 周六」，点开是自己画的小月历（中文、周一开头，和主页日历同一套样式）。
// 不用浏览器自带的选择器：它按系统语言显示，样式也和别的界面不一样。
// 卡片会裁掉溢出的内容，所以弹层挂到 body 上、按日期框的位置摆放。

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** 没选日期时显示的字 */
  placeholder?: string;
  /** 可以清空（可选的日期） */
  clearable?: boolean;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const POPOVER_WIDTH = 256;

export function DateInput({ value, onChange, placeholder = "选日期", clearable = false, required, disabled, className = "", title }: Props) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <span ref={anchor} className={`relative inline-flex min-w-0 items-center ${className}`} title={title}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`min-w-0 flex-1 truncate text-left tabular-nums ${value ? "" : "text-faint"}`}
      >
        {value ? formatDate(value) : placeholder}
      </button>
      {clearable && value && !disabled && (
        <button type="button" onClick={() => onChange("")} className="ml-1 shrink-0 text-faint hover:text-foreground" aria-label="清除日期">
          ×
        </button>
      )}
      {/* 只为了表单的「必填」校验 */}
      {required && (
        <input tabIndex={-1} aria-hidden required value={value} onChange={() => {}} className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0" />
      )}
      {open && (
        <Picker
          anchor={anchor}
          value={value}
          clearable={clearable}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

function Picker({
  anchor,
  value,
  clearable,
  onPick,
  onClose,
}: {
  anchor: React.RefObject<HTMLSpanElement | null>;
  value: string;
  clearable: boolean;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const today = todayJst();
  const [month, setMonth] = useState((value || today).slice(0, 7));
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // 放在日期框下面；下面放不下就放上面，右边超出就往左挪
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const h = panel.current?.offsetHeight ?? 300;
      const below = r.bottom + 4;
      const top = below + h > window.innerHeight - 8 && r.top - h - 4 > 8 ? r.top - h - 4 : below;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8));
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);

  const [y, m] = month.split("-");
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="选日期"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: POPOVER_WIDTH }}
      className="fixed z-50 rounded-xl border border-line bg-surface p-2 text-sm text-foreground shadow-[0_8px_24px_rgb(15_15_15/0.12)]"
    >
      <div className="flex items-center px-1 pb-1">
        <span className="font-medium tabular-nums">
          {y} 年 {Number(m)} 月
        </span>
        <span className="ml-auto flex gap-0.5">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded px-2 text-muted hover:bg-subtle hover:text-foreground" aria-label="上个月">
            ‹
          </button>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded px-2 text-muted hover:bg-subtle hover:text-foreground" aria-label="下个月">
            ›
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-faint">
            {d}
          </div>
        ))}
        {monthGrid(month)
          .flat()
          .map(({ date, inMonth }) => {
            const selected = date === value;
            return (
              <button
                key={date}
                type="button"
                onClick={() => onPick(date)}
                aria-label={date}
                aria-pressed={selected}
                className={`mx-auto flex size-8 items-center justify-center rounded-full tabular-nums ${
                  selected
                    ? "bg-primary text-on-primary"
                    : `hover:bg-subtle ${date === today ? "font-semibold text-accent" : inMonth ? "" : "text-faint"}`
                }`}
              >
                {Number(date.slice(8))}
              </button>
            );
          })}
      </div>
      <div className="mt-1 flex border-t border-line px-1 pt-1.5 text-xs">
        <button type="button" onClick={() => onPick(today)} className="rounded px-1.5 py-0.5 text-accent hover:bg-subtle">
          今天
        </button>
        {clearable && value && (
          <button type="button" onClick={() => onPick("")} className="ml-auto rounded px-1.5 py-0.5 text-muted hover:bg-subtle hover:text-foreground">
            清除
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
