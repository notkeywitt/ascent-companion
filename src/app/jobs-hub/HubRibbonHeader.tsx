"use client";

import { useEffect, useState } from "react";
import { YearRibbon } from "@/components/YearRibbon";
import { COMPANY_TZ } from "@/lib/billing";

/**
 * The Jobs page's head line (owner, 2026-11-14): Home's masthead look, with the
 * year ribbon faded behind it (`YearRibbon`, every job's line).
 *
 *   No job picked:  the date, as Home writes it, and every job line.
 *   A job picked:   "Customer - Job" in place of the date. Its line stays; the
 *                   others fade away.
 *
 * Pinned under the app header from `pad` up, so the picked job's name stays in
 * view (owner, 2026-11-15). The date is read in an effect, not at render: a
 * server in UTC disagrees with the device about the day.
 */
export function HubRibbonHeader({ title, focusId }: { title: string | null; focusId: string | null }) {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

  // ponytail: a copy of HomeMasthead's "Wednesday the 30th"; share it if a third page wants it.
  const dateLine = (() => {
    if (!today) return "";
    const zone = { timeZone: COMPANY_TZ };
    const weekday = today.toLocaleDateString("en-US", { ...zone, weekday: "long" });
    const day = Number(today.toLocaleDateString("en-US", { ...zone, day: "numeric" }));
    const tail =
      day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
    return `${weekday} the ${day}${tail}`;
  })();

  return (
    // Pinned FLUSH under the app header (owner, 2026-11-15): `sticky-below-header`
    // leaves 0.5rem of the page showing through between the two.
    <header
      className="relative z-10 mb-6 flex min-h-16 items-end overflow-hidden border-b border-line bg-cream/95 pb-2 backdrop-blur pad:sticky pad:-mx-7 pad:mb-3 pad:min-h-20 pad:overflow-visible pad:px-7 dark:bg-ink/95"
      style={{ top: "var(--appheader-h)" }}
    >
      <YearRibbon url="/api/jobs-hub/ribbon" focusId={focusId} />
      <h1 className="relative min-h-[26px] truncate text-[17px] font-bold leading-tight tracking-tight pad:text-[21px]">
        {title ?? dateLine}
      </h1>
    </header>
  );
}
