"use client";

import { monthLabel } from "@/lib/billingMonths";

/**
 * The billing month as a heading you can tap: a caret and the month in bold,
 * with a native select laid over them, invisible. Home's masthead and the
 * Tracking Sheet page's phone title line both use it.
 *
 * Why the select is invisible rather than styled: a native select is as wide
 * as its LONGEST option, which left a gap between the caret and a short month.
 * The visible text sizes to the month in force; the select only catches the
 * tap and opens the OS month wheel. The caret sits LEFT of the month so the
 * month's last character stays flush with whatever is right-aligned below it.
 */
export function MonthPicker({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel = "Billing month",
  className = "",
}: {
  /** "2026-10". */
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** On the outer label — placement, and a tone such as the stale red. */
  className?: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? monthLabel(value);
  return (
    <label
      className={`relative flex items-center gap-1.5 rounded focus-within:ring-2 focus-within:ring-accent/25 ${className}`}
    >
      <span aria-hidden className="text-[10px] text-neutral-400 dark:text-neutral-500">
        ▾
      </span>
      <span aria-hidden className="whitespace-nowrap text-[21px] font-bold leading-tight tracking-tight">
        {value ? current : ""}
      </span>
      <select
        value={value}
        disabled={disabled || !value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
      >
        {/* The month in force first, so one that has scrolled off the list
            still shows what it is. */}
        {value && !options.some((o) => o.value === value) && (
          <option value={value}>{current}</option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

