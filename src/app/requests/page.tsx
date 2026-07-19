"use client";

import { useEffect, useState } from "react";

import { Button, EmptyState, Loading, PageHeader, inputCls } from "@/components/ui";

interface FeatureRequest {
  id: number;
  title: string;
  detail: string;
  requester: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS = ["open", "planned", "done", "declined"];
const statusClass: Record<string, string> = {
  // "open" = needs attention → brand ochre (off-black on ochre passes AA);
  // "planned" stays olive (accent). The rest keep distinct semantic hues.
  open: "text-offblack bg-ochre",
  planned: "text-accent bg-accent/10",
  done: "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-950/50",
  declined: "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800",
};

export default function RequestsPage() {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: "", detail: "", requester: "" });

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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const res = await fetch("/api/feature-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ title: "", detail: "", requester: "" });
      setShowNew(false);
      load();
    }
  }

  async function setStatus(id: number, status: string) {
    const res = await fetch(`/api/feature-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const json = await res.json();
      setRequests((rs) => rs.map((r) => (r.id === id ? json.request : r)));
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Requests"
        description="Ask for panel updates and new features."
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

      {showNew && (
        <form
          onSubmit={create}
          className="mb-5 space-y-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700/60 dark:bg-ink-raised"
        >
          <input
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="What do you want? (required)"
            className={inputCls}
          />
          <textarea
            value={form.detail}
            onChange={(e) => setForm({ ...form, detail: e.target.value })}
            placeholder="Any details — where it goes, how it should work…"
            rows={3}
            className={inputCls}
          />
          <input
            value={form.requester}
            onChange={(e) => setForm({ ...form, requester: e.target.value })}
            placeholder="Your name"
            className={inputCls}
          />
          <Button type="submit" className="w-full">
            Submit request
          </Button>
        </form>
      )}

      {loading && <Loading label="Loading requests…" />}
      {!loading && requests.length === 0 && <EmptyState>No requests yet — be the first.</EmptyState>}

      <ul className="space-y-2">
        {requests.map((r) => (
          <li
            key={r.id}
            className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700/60 dark:bg-ink-raised"
          >
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
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass[r.status] ?? ""}`}
              >
                {r.status}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {STATUS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(r.id, s)}
                  className={
                    "rounded-full px-2.5 py-1 text-xs font-semibold transition " +
                    (r.status === s
                      ? statusClass[s]
                      : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10")
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
