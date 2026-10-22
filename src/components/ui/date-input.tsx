"use client";

import { useRef } from "react";
import { formatDate } from "@/lib/calendar";

// 日期框：显示和页面上其他地方一样的「10/24 周六」，点开用浏览器自带的日期选择器。
// 浏览器自带的日期框按系统语言显示（英文系统是 mm/dd/yyyy），所以原生框藏起来，只借它的选择器。

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

export function DateInput({ value, onChange, placeholder = "选日期", clearable = false, required, disabled, className = "", title }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = ref.current;
    if (!el || disabled) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };
  return (
    <span className={`relative inline-flex min-w-0 items-center ${className}`} title={title}>
      <button type="button" onClick={open} disabled={disabled} className={`min-w-0 flex-1 truncate text-left tabular-nums ${value ? "" : "text-faint"}`}>
        {value ? formatDate(value) : placeholder}
      </button>
      {clearable && value && !disabled && (
        <button type="button" onClick={() => onChange("")} className="ml-1 shrink-0 text-faint hover:text-foreground" aria-label="清除日期">
          ×
        </button>
      )}
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0"
      />
    </span>
  );
}
