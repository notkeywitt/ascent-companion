"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button, EmptyState, FilterChip, Loading, PageHeader } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { FeatureRequestForm } from "@/components/FeatureRequestForm";

interface FeatureRequest {
  id: number;
  title: string;
  detail: string;
  requester: string;
  status: string;
  pushThrough: boolean;
  result: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS = ["open", "planned", "done", "declined"];
const statusClass: Record<string, string> = {
  // "open" = needs attention → filled brand ochre in both themes; "planned"
  // is the same accent tinted. The rest keep distinct semantic hues.
  open: "text-accent-fg bg-accent",
  planned: "text-accent bg-accent/10",
  done: "text-ok bg-green-100 dark:bg-green-950/50",
  declined: "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800",
};

// useSearchParams needs a Suspense boundary, or the build fails to prerender.
export default function RequestsPage() {
  return (
    <Suspense>
      <Requests />
    </Suspense>
  );
}

function Requests() {
  // Status changes are office/admin only (see /api/feature-requests/[id]).
  const { role } = useAccess();
  const canTriage = role === "admin" || role === "office";
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // "all" or one status; the list below shows only that status.
  const [filter, setFilter] = useState<string>("all");
  // ?new=1 opens the form at once (a link straight to "ask for something").
  const [showNew, setShowNew] = useState(useSearchParams().get("new") === "1");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/feature-requests");
      const json = await res.json();
      setRequests(json.requests ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function patch(id: number, body: { status?: string; pushThrough?: boolean }) {
    const res = await fetch(`/api/feature-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      setRequests((rs) => rs.map((r) => (r.id === id ? json.request : r)));
    }
  }

  async function remove(r: FeatureRequest) {
    if (!window.confirm(`Delete “${r.title}”? This cannot be undone.`)) return;
    const res = await fetch(`/api/feature-requests/${r.id}`, { method: "DELETE" });
    if (res.ok) setRequests((rs) => rs.filter((x) => x.id !== r.id));
  }

  const shown = filter === "all" ? requests : requests.filter((r) => r.status === filter);

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6 lg:max-w-[1600px]">
      <PageHeader
        title="Feature Requests"
        actions={
          <Button
            variant={showNew ? "secondary" : "primary"}
            size="sm"
            onClick={() => setShowNew((s) => !s)}
          >
            {showNew ? "Cancel" : "+ Request"}
          </Button>
        }
        className="!mb-4"
      />

      <div className={showNew ? "lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-8" : ""}>
      {showNew && (
        <FeatureRequestForm
          onDone={() => {
            setShowNew(false);
            load();
          }}
          className="mb-5 rounded-card border border-line bg-white p-3 lg:sticky lg:top-4 lg:mb-0 dark:bg-ink-raised"
        />
      )}

      <div className="min-w-0">
      {loading && <Loading label="Loading requests…" />}
      {!loading && requests.length === 0 && (
        <EmptyState>No requests yet — be the first.</EmptyState>
      )}

      {requests.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {["all", ...STATUS].map((s) => (
            <FilterChip key={s} on={filter === s} onClick={() => setFilter(s)}>
              {s} ({s === "all" ? requests.length : requests.filter((r) => r.status === s).length})
            </FilterChip>
          ))}
        </div>
      )}
      {requests.length > 0 && shown.length === 0 && (
        <EmptyState>No {filter} requests.</EmptyState>
      )}

      {/* One hairline list, one column, not a box per request (THEME.md: a hairline, not a box). */}
      {shown.length > 0 && (
      <ul className="divide-y divide-line-soft overflow-hidden rounded-card border border-line bg-white dark:bg-ink-raised">
        {shown.map((r) => (
          <li key={r.id} className="bg-white p-3 dark:bg-ink-raised">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{r.title}</div>
                {r.detail && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
                    {r.detail}
                  </p>
                )}
                {r.requester && (
                  <div className="mt-1 text-xs text-neutral-500">— {r.requester}</div>
                )}
                {r.result && (
                  <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-line pl-2.5 text-[13px] text-neutral-600 dark:text-neutral-400">
                    {r.result}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${statusClass[r.status] ?? ""}`}
              >
                {r.status}
              </span>
            </div>
            {canTriage && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {STATUS.map((s) => (
                  <button
                    key={s}
                    onClick={() => patch(r.id, { status: s })}
                    className={
                      "rounded-pill px-2.5 py-1 text-xs font-semibold transition " +
                      (r.status === s
                        ? statusClass[s]
                        : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10")
                    }
                  >
                    {s}
                  </button>
                ))}
                {/* The express lane: /queue does this one first and ships it alone. */}
                <button
                  onClick={() => patch(r.id, { pushThrough: !r.pushThrough })}
                  aria-pressed={r.pushThrough}
                  className={
                    "ml-auto rounded-pill px-2.5 py-1 text-xs font-semibold transition " +
                    (r.pushThrough
                      ? "text-accent-fg bg-accent"
                      : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10")
                  }
                >
                  Push through
                </button>
                <button
                  onClick={() => remove(r)}
                  className="rounded-pill px-2.5 py-1 text-xs font-semibold text-neutral-500 transition hover:bg-red-50 hover:text-danger dark:hover:bg-red-950/40"
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      )}
      </div>
      </div>
    </main>
  );
}
