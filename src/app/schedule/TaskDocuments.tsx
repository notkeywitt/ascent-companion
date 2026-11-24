"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, Dialog, Loading } from "@/components/ui";
import { toast } from "@/components/Toast";
import type { DocDetail, TaskDocument } from "@/lib/jobtread/taskDocuments";
import { DOC_TYPE_LABEL, codesLine, docMatches, docTotals, money } from "@/lib/taskDocs";

/**
 * The bills and estimates on one schedule task, inside the Schedule dialog
 * (rules: PAVE_GOTCHAS.md, "Tasks and schedules"). Lists what sits on the task, with a
 * total for bills and for estimates. "Attach" lists the job's documents that
 * sit on no task (drafts only: JobTread's rule);
 * a tap on Attach puts one on this task. "Remove" takes one off. Both go
 * through POST /api/schedule/links (JobTread's own `document.task`). A tap on a
 * document's title opens its details.
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
  const [detailId, setDetailId] = useState("");
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
        <ul className="mb-2 divide-y divide-line-soft rounded-control border border-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-2.5 py-2 text-[13px]">
              <DocText d={d} onOpen={() => setDetailId(d.id)} />
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
        <Attach
          jobId={jobId}
          busy={busy}
          onOpen={setDetailId}
          onPick={(id) => void write(id, taskId)}
          onCancel={() => setAttaching(false)}
        />
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAttaching(true)}>
          Attach a bill or estimate
        </Button>
      )}

      {detailId && <DocDetailDialog id={detailId} onClose={() => setDetailId("")} />}
    </section>
  );
}

/** A row's words: a title that opens the details, then status, date and cost codes. */
function DocText({ d, onOpen }: { d: TaskDocument; onOpen: () => void }) {
  return (
    <div className="min-w-0 flex-1">
      <button
        type="button"
        onClick={onOpen}
        title="Open the details"
        className="block max-w-full truncate text-left font-medium text-accent underline-offset-2 hover:underline"
      >
        {DOC_TYPE_LABEL[d.type]}
        {d.number !== null ? ` #${d.number}` : ""} · {d.accountName || d.name}
      </button>
      <div className="truncate text-[11px] text-neutral-500">
        {d.status}
        {d.issueDate ? ` · ${d.issueDate}` : ""} · {codesLine(d)}
      </div>
    </div>
  );
}

/** The job's documents with no task, filtered by a search box. */
function Attach({
  jobId,
  busy,
  onOpen,
  onPick,
  onCancel,
}: {
  jobId: string;
  busy: string;
  onOpen: (documentId: string) => void;
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
    <div className="rounded-control border border-line p-2">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search draft bills, expenses and estimates"
          aria-label="Search this job's draft bills, expenses and estimates"
          className="min-h-10 w-full rounded-control border border-line bg-white px-3 text-sm dark:bg-ink-raised"
        />
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {failed && <Banner tone="error">{failed}</Banner>}
      {!all && !failed && <Loading label="Loading this job's documents…" />}
      {all && shown.length === 0 && (
        <p className="px-1 py-2 text-[13px] text-neutral-500">
          {all.length === 0 ? "This job has no draft bill, expense, estimate or bid request left to attach." : "No match."}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="max-h-64 divide-y divide-line-soft overflow-y-auto">
          {shown.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-1.5 py-1.5 text-[13px]">
              <DocText d={d} onOpen={() => onOpen(d.id)} />
              <span className="shrink-0 tabular-nums">{money(d.amount)}</span>
              <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => onPick(d.id)}>
                Attach
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A document's details: header facts, then its lines with their cost codes. */
export function DocDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<DocDetail | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    const stop = new AbortController();
    fetch(`/api/schedule/links?detailId=${encodeURIComponent(id)}`, { signal: stop.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || j.error) return setFailed(j.error ?? "The details did not load.");
        setD(j.detail as DocDetail);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setFailed("The details did not load.");
      });
    return () => stop.abort();
  }, [id]);

  const title = d
    ? `${DOC_TYPE_LABEL[d.type]}${d.number !== null ? ` #${d.number}` : ""} · ${d.accountName || d.name}`
    : "Details";

  return (
    <Dialog
      onClose={onClose}
      size="lg"
      title={title}
      description={d ? d.jobName : undefined}
      footer={
        <>
          {d && (
            <a
              href={`https://app.jobtread.com/jobs/${d.jobId}/documents/${d.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mr-auto text-xs font-semibold text-accent hover:underline"
            >
              Open in JobTread
            </a>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {failed && <Banner tone="error">{failed}</Banner>}
      {!d && !failed && <Loading label="Loading the details…" />}
      {d && (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-neutral-500">Status</dt>
            <dd>{d.status}</dd>
            {d.issueDate && (
              <>
                <dt className="text-neutral-500">Date</dt>
                <dd>{d.issueDate}</dd>
              </>
            )}
            {d.dueDate && (
              <>
                <dt className="text-neutral-500">Due</dt>
                <dd>{d.dueDate}</dd>
              </>
            )}
            {d.subject && (
              <>
                <dt className="text-neutral-500">Subject</dt>
                <dd>{d.subject}</dd>
              </>
            )}
            <dt className="text-neutral-500">Total</dt>
            <dd className="font-semibold tabular-nums">
              {money(d.amount)}
              {d.tax > 0 && <span className="font-normal text-neutral-500"> (tax {money(d.tax)})</span>}
            </dd>
            {d.description && (
              <>
                <dt className="text-neutral-500">Notes</dt>
                <dd className="whitespace-pre-wrap">{d.description}</dd>
              </>
            )}
          </dl>

          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {d.lines.length} line{d.lines.length === 1 ? "" : "s"}
            </h4>
            {d.lines.length === 0 ? (
              <p className="text-[13px] text-neutral-500">This document has no lines.</p>
            ) : (
              <ul className="divide-y divide-line-soft rounded-control border border-line">
                {d.lines.map((l, i) => (
                  <li key={i} className="flex items-start gap-2 px-2.5 py-2 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{l.name || "(no name)"}</div>
                      <div className="text-[11px] text-neutral-500">
                        {l.costCode || "No cost code"}
                        {l.quantity !== null && l.unitCost !== null
                          ? ` · ${l.quantity} × ${money(l.unitCost)}`
                          : ""}
                      </div>
                      {l.description && (
                        <div className="mt-0.5 whitespace-pre-wrap text-[12px] text-neutral-600 dark:text-neutral-400">
                          {l.description}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 tabular-nums">{money(l.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
