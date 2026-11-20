"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, EmptyState, Input, Loading, SectionLabel } from "@/components/ui";

/** One row of src/data/changelog.json, which the lander writes on every deploy. */
type Entry = { sha: string; date: string; title: string; plain: string };

const dayKey = (d: Date) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD, local

function dayLabel(key: string): string {
  const now = new Date();
  if (key === dayKey(now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (key === dayKey(y)) return "Yesterday";
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ChangeLogPanel() {
  const [log, setLog] = useState<Entry[] | null>(null);
  const [q, setQ] = useState("");

  // Loaded on open, so the log stays out of the Admin page's first download.
  useEffect(() => {
    import("@/data/changelog.json").then((m) => setLog(m.default as Entry[]));
  }, []);

  const days = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const groups = new Map<string, Entry[]>();
    for (const e of log ?? []) {
      if (needle && !`${e.plain} ${e.title} ${e.sha}`.toLowerCase().includes(needle)) continue;
      const k = dayKey(new Date(e.date));
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    return [...groups].sort(([a], [b]) => b.localeCompare(a));
  }, [log, q]);

  if (!log) return <Loading />;
  return (
    <div className="max-w-2xl space-y-5">
      <Input
        type="search"
        placeholder="Search changes"
        aria-label="Search changes"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {days.length === 0 ? (
        <EmptyState>No change matches.</EmptyState>
      ) : (
        days.map(([key, entries]) => (
          <section key={key} className="space-y-2">
            <SectionLabel>{dayLabel(key)}</SectionLabel>
            <Card pad={false} className="divide-y divide-line-soft">
              {entries.map((e) => (
                <div key={e.sha} className="px-3 py-2.5">
                  <p className="text-[15px] leading-snug">{e.plain}</p>
                  <p className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                    {e.title} · <span className="font-mono">{e.sha.slice(0, 7)}</span>
                  </p>
                </div>
              ))}
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
