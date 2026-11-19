"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, Loading } from "@/components/ui";
import { toast } from "@/components/Toast";
import type { TaskDocument } from "@/lib/jobtread/taskDocuments";
import { DOC_TYPE_LABEL, docMatches, docTotals, money } from "@/lib/taskDocs";

/**
 * The bills and estimates on one schedule task, inside the Schedule dialog
 * (docs/plans/SCHEDULE_PLAN.md stage 4). Lists what sits on the task, with a
 * total for bills and for estimates. "Attach" lists the job's documents that
 * sit on no task; a tap puts one on this task. "Remove" takes one off.
 * Both go through POST /api/schedule/links (JobTread's own `document.task`).
 */
export function TaskDocuments({
  taskId,
  jobId,
  docs,
  onChanged,
}: {
  taskId: string;
  jobId: string;
  docs: TaskDocument[];
  /** Called after a link is written, so the page re-reads the links. */
  onChanged: () => void;
}) {
  const [attaching, setAttaching] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const totals = docTotals(docs);

  async function write(documentId: string, to: string | null) {
    setBusy(documentId);
    setError("");
    const r = await fetch("/api/schedule/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId, taskId: to }),
    }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; previewed?: boolean; error?: string } | null;
    setBusy("");
    if (!r?.ok || !j?.ok) return setError(j?.error ?? "Could not save to JobTread.");
    if (j.previewed) return toast("Writes are off. Nothing was saved.");
    toast(to ? "Attached" : "Removed");
    setAttaching(false);
    onChanged();
  }

  return (
    <section className="mt-4 border-t border-line-soft pt-3" aria-label="Bills and estimates">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Bills and estimates</h3>
        {totals.count > 0 && (
          <span className="text-xs tabular-nums text-neutral-500">
            {totals.bills > 0 && `Bills ${money(totals.bills)}`}
            {totals.bills > 0 && totals.estimates > 0 && " · "}
            {totals.estimates > 0 && `Estimates ${money(totals.estimates)}`}
          </span>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {docs.length === 0 && !attaching && (
        <p className="mb-2 text-[13px] text-neutral-500">Nothing is attached to this task yet.</p>
      )}

      {docs.length > 0 && (
        <ul className="mb-2 divide-y divide-line-soft rounded-lg border border-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-2.5 py-2 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {DOC_TYPE_LABEL[d.type]}
                  {d.number !== null ? ` #${d.number}` : ""} · {d.accountName || d.name}
                </div>
                <div className="truncate text-[11px] text-neutral-500">
                  {d.status}
                  {d.issueDate ? ` · ${d.issueDate}` : ""}
                </div>
              </div>
              <span className="shrink-0 tabular-nums">{money(d.amount)}</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy === d.id}
                onClick={() => {
                  if (window.confirm(`Take this ${DOC_TYPE_LABEL[d.type].toLowerCase()} off the task? It stays in JobTread.`))
                    void write(d.id, null);
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {attaching ? (
        <Attach jobId={jobId} busy={busy} onPick={(id) => void write(id, taskId)} onCancel={() => setAttaching(false)} />
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAttaching(true)}>
          Attach a bill or estimate
        </Button>
      )}
    </section>
  );
}

/** The job's documents with no task, filtered by a search box. */
function Attach({
  jobId,
  busy,
  onPick,
  onCancel,
}: {
  jobId: string;
  busy: string;
  onPick: (documentId: string) => void;
  onCancel: () => void;
}) {
  const [all, setAll] = useState<TaskDocument[] | null>(null);
  const [failed, setFailed] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const stop = new AbortController();
    fetch(`/api/schedule/links?jobId=${encodeURIComponent(jobId)}`, { signal: stop.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || j.error) return setFailed(j.error ?? "The documents did not load.");
        setAll(j.documents as TaskDocument[]);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setFailed("The documents did not load.");
      });
    return () => stop.abort();
  }, [jobId]);

  const shown = useMemo(() => (all ?? []).filter((d) => docMatches(d, q)).slice(0, 60), [all, q]);

  return (
    <div className="rounded-lg border border-line p-2">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search this job's bills and estimates"
          aria-label="Search this job's bills and estimates"
          className="min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:bg-ink-raised"
        />
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {failed && <Banner tone="error">{failed}</Banner>}
      {!all && !failed && <Loading label="Loading this job's documents…" />}
      {all && shown.length === 0 && (
        <p className="px-1 py-2 text-[13px] text-neutral-500">
          {all.length === 0 ? "Every document on this job is already on a task." : "No match."}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="max-h-64 divide-y divide-line-soft overflow-y-auto">
          {shown.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => onPick(d.id)}
                className="flex min-h-11 w-full items-center gap-2 px-1.5 py-1.5 text-left text-[13px] transition hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-white/5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {DOC_TYPE_LABEL[d.type]}
                    {d.number !== null ? ` #${d.number}` : ""} · {d.accountName || d.name}
                  </span>
                  <span className="block truncate text-[11px] text-neutral-500">
                    {d.status}
                    {d.issueDate ? ` · ${d.issueDate}` : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{money(d.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
