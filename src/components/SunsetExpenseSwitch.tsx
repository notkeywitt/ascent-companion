"use client";

import { useState } from "react";

import { JtLink } from "./JtLink";
import { Banner, Button, Card, Checkbox, MetaLine, Spinner } from "./ui";
import { money as moneyN } from "@/lib/money";

// The bulk switch for the Sunset Statements page. Sunset is paid in bulk off
// its statement, from Banner Bank, so its bills are Expenses paid from
// "Checking - Banner Bank" and its credits are JobTread Credits. The intake
// files new ones that way; this lists the DRAFT Sunset bills not yet filed
// that way and switches the ones ticked (GET / POST /api/sunset-expense).

interface Bill {
  id: string;
  jobId: string;
  jobName: string;
  externalId: string;
  issueDate: string;
  cost: number;
  /** "Split" = a purchase AND a return: the returns move onto their own Credit. */
  target: "Expense" | "Credit" | "Split";
}
interface Outcome {
  docId: string;
  ok: boolean;
  reason?: string;
  warning?: string;
}

const BATCH = 5; // bills per POST — a split pages the vendor's bills, so keep a call well inside its limit

const jtDocUrl = (b: Bill) =>
  b.id && b.jobId
    ? `https://app.jobtread.com/jobs/${encodeURIComponent(b.jobId)}/documents/${encodeURIComponent(b.id)}`
    : "";

const fmtDate = (d: string) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

export function SunsetExpenseSwitch() {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "saving">("idle");
  const [bills, setBills] = useState<Bill[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<Outcome[]>([]);
  /** Switched, but with something a person must finish (e.g. a file to attach). */
  const [notes, setNotes] = useState<Outcome[]>([]);
  /** "#invoice · job" per bill, kept past the bill leaving the list. */
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/sunset-expense");
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Could not read the draft Sunset bills");
        setState("idle");
        return;
      }
      setBills(json.bills);
      setPicked(new Set((json.bills as Bill[]).map((b) => b.id)));
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setState("idle");
    }
  }

  async function save() {
    const ids = bills.filter((b) => picked.has(b.id)).map((b) => b.id);
    if (ids.length === 0) return;
    setState("saving");
    setError("");
    setFailed([]);
    setNotes([]);
    setLabels(new Map(bills.map((b) => [b.id, `#${b.externalId || b.id} · ${b.jobName}`])));
    setDone(null);
    setProgress(0);
    const switched = new Set<string>();
    const bad: Outcome[] = [];
    const warned: Outcome[] = [];
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const res = await fetch("/api/sunset-expense", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docIds: ids.slice(i, i + BATCH) }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (json.previewed) throw new Error("JobTread writes are off, so nothing was changed.");
        for (const r of json.results as Outcome[]) {
          if (r.ok) switched.add(r.docId);
          else bad.push(r);
          if (r.ok && r.warning) warned.push(r);
        }
        setProgress(Math.min(ids.length, i + BATCH));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
    setBills((bs) => bs.filter((b) => !switched.has(b.id)));
    setPicked((p) => new Set([...p].filter((id) => !switched.has(id))));
    setFailed(bad);
    setNotes(warned);
    setDone(switched.size);
    setState("ready");
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickedCount = bills.filter((b) => picked.has(b.id)).length;
  const pickedTotal = bills.filter((b) => picked.has(b.id)).reduce((s, b) => s + b.cost, 0);
  const creditCount = bills.filter((b) => picked.has(b.id) && b.target === "Credit").length;
  const splitCount = bills.filter((b) => picked.has(b.id) && b.target === "Split").length;
  const allPicked = bills.length > 0 && pickedCount === bills.length;

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">Draft bills to expenses</div>
          <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Sunset is paid from Banner Bank off the statement. Switch draft Sunset bills to an Expense paid from
            Checking - Banner Bank, and draft Sunset credits to a Credit. A bill with a return has the return split
            onto its own Credit first.
          </div>
        </div>
        {state !== "ready" && state !== "saving" && (
          <Button size="sm" disabled={state === "loading"} onClick={load}>
            {state === "loading" ? "Finding…" : "Find"}
          </Button>
        )}
      </div>

      {error && (
        <Banner tone="error" className="mt-3 !py-2 text-xs">
          {error}
        </Banner>
      )}

      {state === "loading" && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
          <Spinner /> Reading every draft Sunset bill in JobTread…
        </div>
      )}

      {done !== null && (
        <div className="mt-3 text-xs font-semibold text-ok">
          ✓ {done} bill{done === 1 ? "" : "s"} switched.
        </div>
      )}

      {failed.length > 0 && (
        <Banner tone="warning" className="mt-3 !py-2 text-xs">
          <div className="font-semibold">{failed.length} not switched:</div>
          <ul className="mt-1 space-y-0.5">
            {failed.map((f) => (
              <li key={f.docId}>
                {labels.get(f.docId) ?? f.docId} — {f.reason}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {notes.length > 0 && (
        <Banner tone="warning" className="mt-3 !py-2 text-xs">
          <div className="font-semibold">{notes.length} switched, with something to finish:</div>
          <ul className="mt-1 space-y-0.5">
            {notes.map((f) => (
              <li key={f.docId}>
                {labels.get(f.docId) ?? f.docId} — {f.warning}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {(state === "ready" || state === "saving") && (
        <div className="mt-3">
          {bills.length === 0 ? (
            <div className="text-xs font-semibold text-ok">
              ✓ Every draft Sunset bill is already an Expense, and every credit a Credit.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Checkbox
                  label={<span className="text-xs">All</span>}
                  checked={allPicked}
                  disabled={state === "saving"}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(bills.map((b) => b.id)))}
                />
                <MetaLine
                  items={[
                    `${pickedCount} of ${bills.length} picked`,
                    moneyN(pickedTotal),
                    creditCount > 0 ? `${creditCount} credit${creditCount === 1 ? "" : "s"}` : null,
                    splitCount > 0 ? `${splitCount} to split` : null,
                  ]}
                />
              </div>
              <ul className="mt-2 max-h-80 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line">
                {bills.map((b) => {
                  const url = jtDocUrl(b);
                  return (
                    <li key={b.id} className="flex items-center justify-between gap-3 px-2.5 py-2 text-xs tabular-nums">
                      <span className="flex min-w-0 items-center gap-2">
                        <Checkbox
                          aria-label={`Switch #${b.externalId || b.id}`}
                          checked={picked.has(b.id)}
                          disabled={state === "saving"}
                          onChange={() => toggle(b.id)}
                        />
                        {url ? (
                          <JtLink
                            href={url}
                            className="font-medium underline decoration-neutral-300 underline-offset-2 hover:text-accent hover:decoration-accent dark:decoration-neutral-600"
                          >
                            #{b.externalId || b.id} ↗
                          </JtLink>
                        ) : (
                          <span className="font-medium">#{b.externalId || b.id}</span>
                        )}
                        <span className="truncate text-neutral-500 dark:text-neutral-400">
                          {b.jobName}
                          {b.issueDate && ` · ${fmtDate(b.issueDate)}`}
                          {b.target === "Credit" && " · to Credit"}
                          {b.target === "Split" && " · returns split onto a Credit"}
                        </span>
                      </span>
                      <span>{moneyN(b.cost)}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex items-center justify-end gap-2">
                {state === "saving" && (
                  <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                    <Spinner /> Switching {progress} of {pickedCount}…
                  </span>
                )}
                <Button size="sm" disabled={state === "saving" || pickedCount === 0} onClick={save}>
                  Switch {pickedCount} bill{pickedCount === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
