"use client";

import { useCallback, useEffect, useState } from "react";

import { Banner, Button, EmptyState, Loading, PageHeader, inputCls } from "@/components/ui";

interface LogItem {
  timestamp: string;
  level: string;
  expId: string;
  action: string;
  details: string;
  status: string;
}

// The Level column is free-form (writeAuditLog callers set it), so color by
// keyword rather than an enum: red for errors, amber for warnings, olive for the
// rest (INFO and friends). Status gets the same treatment so a "Failed" stands out.
function toneClass(text: string): string {
  const t = text.toLowerCase();
  if (/error|fail|denied|unmatched|critical/.test(t))
    return "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
  if (/warn|skip|retry|defer|mismatch/.test(t))
    return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
}

// The System_Logs audit tab: every writeAuditLog append (push/sync engine,
// ingestion, diagnostics), newest-first. Read-only viewer — filtering happens
// server-side over the full ~2,000-row tab so a search isn't limited to the
// currently-loaded page.
export default function LogsPage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams({ limit: "500" });
      if (query.trim()) sp.set("query", query.trim());
      if (level.trim()) sp.set("level", level.trim());
      const res = await fetch(`/api/logs?${sp.toString()}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) setError(json.error ?? "Request failed");
      else setItems(json.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [query, level]);

  // Load once on mount. Search/level changes are applied via the form submit /
  // Refresh button rather than on every keystroke.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <PageHeader
        title="System Logs"
        description="The audit trail every automation writes — pushes, syncs, ingestion, diagnostics — newest first. Read-only."
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
        className="!mb-4"
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search action, details, ExpID…"
          className={inputCls + " min-w-0 !w-auto flex-1"}
        />
        <input
          type="text"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          placeholder="Level"
          className={inputCls + " !w-28"}
        />
        <Button type="submit" size="sm" className="shrink-0 !py-2" disabled={loading}>
          Search
        </Button>
      </form>

      {loading && <Loading label="Loading log entries…" />}
      {error && <Banner tone="error">{error}</Banner>}
      {!loading && !error && items.length === 0 && <EmptyState>No log entries match.</EmptyState>}

      <ul className="space-y-2">
        {items.map((it, i) => (
          <li
            key={i}
            className="rounded-xl border border-line bg-white p-3 dark:bg-ink-raised"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-neutral-500">{it.timestamp}</span>
              {it.level && (
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold " + toneClass(it.level)
                  }
                >
                  {it.level}
                </span>
              )}
              {it.action && <span className="text-sm font-semibold">{it.action}</span>}
              {it.expId && (
                <span className="font-mono text-xs text-neutral-500">#{it.expId}</span>
              )}
            </div>
            {it.details && (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300">
                {it.details}
              </p>
            )}
            {it.status && (
              <span
                className={
                  "mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                  toneClass(it.status)
                }
              >
                {it.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
