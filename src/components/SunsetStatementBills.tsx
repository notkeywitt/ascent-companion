"use client";

import { useState } from "react";

import { JtLink } from "./JtLink";
import { Banner, Button, Card, Checkbox, MetaLine, Spinner } from "./ui";
import { money as moneyN } from "@/lib/money";

// "Create Bills" on the Sunset Statements page. Each unpaid statement becomes
// one draft Bill on the Office job, coded 88 70 00: the statement total, less
// the printed prompt discount (GET / POST /api/sunset-statement-bills).

const OFFICE_JOB_ID = "22PXevQbM9FQ"; // same as OFFICE_JOB_ID in src/lib/jobtread.ts
const BATCH = 3; // statements per POST — each also fetches and uploads its PDF

interface Statement {
  expId: string;
  project: string;
  statementDate: string;
  statementNumber: string;
  total: string;
  discount: string;
  net: string;
}
interface Outcome {
  expId: string;
  ok: boolean;
  docId?: string;
  reason?: string;
  warning?: string;
}

const jtDocUrl = (docId: string) =>
  `https://app.jobtread.com/jobs/${encodeURIComponent(OFFICE_JOB_ID)}/documents/${encodeURIComponent(docId)}`;

const fmtDate = (d: string) => {
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
    return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (/^\d{4}-\d{1,2}$/.test(d)) {
    const [y, m] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return d;
};

const num = (v: string) => Number(v) || 0;

export function SunsetStatementBills() {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "saving">("idle");
  const [statements, setStatements] = useState<Statement[]>([]);
  const [unread, setUnread] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState(0);
  const [created, setCreated] = useState<Outcome[]>([]);
  const [failed, setFailed] = useState<Outcome[]>([]);
  /** "#statement · project" per statement, kept past it leaving the list. */
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");

  async function load() {
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/sunset-statement-bills");
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Could not read the statements");
        setState("idle");
        return;
      }
      setStatements(json.statements);
      setUnread(json.unread ?? 0);
      setPicked(new Set((json.statements as Statement[]).map((s) => s.expId)));
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setState("idle");
    }
  }

  async function save() {
    const ids = statements.filter((s) => picked.has(s.expId)).map((s) => s.expId);
    if (ids.length === 0) return;
    setState("saving");
    setError("");
    setCreated([]);
    setFailed([]);
    setLabels(
      new Map(statements.map((s) => [s.expId, `#${s.statementNumber || s.expId}${s.project ? ` · ${s.project}` : ""}`])),
    );
    setProgress(0);
    const made: Outcome[] = [];
    const bad: Outcome[] = [];
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const res = await fetch("/api/sunset-statement-bills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expIds: ids.slice(i, i + BATCH) }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (json.previewed) throw new Error("JobTread writes are off, so nothing was created.");
        for (const r of json.results as Outcome[]) (r.ok ? made : bad).push(r);
        setProgress(Math.min(ids.length, i + BATCH));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
    const done = new Set(made.map((r) => r.expId));
    setStatements((ss) => ss.filter((s) => !done.has(s.expId)));
    setPicked((p) => new Set([...p].filter((id) => !done.has(id))));
    setCreated(made);
    setFailed(bad);
    setState("ready");
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = statements.filter((s) => picked.has(s.expId));
  const pickedNet = chosen.reduce((sum, s) => sum + num(s.total) - num(s.discount), 0);
  const allPicked = statements.length > 0 && chosen.length === statements.length;
  const warned = created.filter((r) => r.warning);

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">Statement bills</div>
          <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Create one draft Bill per unpaid statement on the Office job, coded {"88 70 00"}. Each bill is the
            statement total less the prompt discount, with the statement PDF attached.
          </div>
        </div>
        {state !== "ready" && state !== "saving" && (
          <Button size="sm" disabled={state === "loading"} onClick={load}>
            {state === "loading" ? "Finding…" : "Create Bills"}
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
          <Spinner /> Reading the statements and the Office job&apos;s bills…
        </div>
      )}

      {created.length > 0 && (
        <div className="mt-3 text-xs">
          <div className="font-semibold text-ok">
            ✓ {created.length} bill{created.length === 1 ? "" : "s"} created on the Office job.
          </div>
          <ul className="mt-1 space-y-0.5">
            {created.map((r) => (
              <li key={r.expId}>
                {r.docId ? (
                  <JtLink
                    href={jtDocUrl(r.docId)}
                    className="underline decoration-neutral-300 underline-offset-2 hover:text-accent hover:decoration-accent dark:decoration-neutral-600"
                  >
                    {labels.get(r.expId) ?? r.expId} ↗
                  </JtLink>
                ) : (
                  (labels.get(r.expId) ?? r.expId)
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warned.length > 0 && (
        <Banner tone="warning" className="mt-3 !py-2 text-xs">
          <div className="font-semibold">{warned.length} created, with something to finish:</div>
          <ul className="mt-1 space-y-0.5">
            {warned.map((r) => (
              <li key={r.expId}>
                {labels.get(r.expId) ?? r.expId} — {r.warning}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {failed.length > 0 && (
        <Banner tone="warning" className="mt-3 !py-2 text-xs">
          <div className="font-semibold">{failed.length} not created:</div>
          <ul className="mt-1 space-y-0.5">
            {failed.map((r) => (
              <li key={r.expId}>
                {labels.get(r.expId) ?? r.expId} — {r.reason}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {(state === "ready" || state === "saving") && (
        <div className="mt-3">
          {unread > 0 && (
            <div className="mb-2 text-xs text-warn">
              {unread} unpaid statement{unread === 1 ? " is" : "s are"} not read yet, so {unread === 1 ? "it is" : "they are"}{" "}
              left out. Let the list below finish reading, then try again.
            </div>
          )}
          {statements.length === 0 ? (
            <div className="text-xs font-semibold text-ok">✓ Every read, unpaid statement already has a bill.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Checkbox
                  label={<span className="text-xs">All</span>}
                  checked={allPicked}
                  disabled={state === "saving"}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(statements.map((s) => s.expId)))}
                />
                <MetaLine items={[`${chosen.length} of ${statements.length} picked`, moneyN(pickedNet)]} />
              </div>
              <ul className="mt-2 max-h-80 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line">
                {statements.map((s) => (
                  <li key={s.expId} className="flex items-center justify-between gap-3 px-2.5 py-2 text-xs tabular-nums">
                    <span className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        aria-label={`Create a bill for statement ${s.statementNumber || s.expId}`}
                        checked={picked.has(s.expId)}
                        disabled={state === "saving"}
                        onChange={() => toggle(s.expId)}
                      />
                      <span className="font-medium">#{s.statementNumber || s.expId}</span>
                      <span className="truncate text-neutral-500 dark:text-neutral-400">
                        {s.project}
                        {s.statementDate && ` · ${fmtDate(s.statementDate)}`}
                        {num(s.discount) > 0 && ` · ${moneyN(num(s.total))} less ${moneyN(num(s.discount))}`}
                      </span>
                    </span>
                    <span>{moneyN(num(s.total) - num(s.discount))}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-end gap-2">
                {state === "saving" && (
                  <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                    <Spinner /> Creating {progress} of {chosen.length}…
                  </span>
                )}
                <Button size="sm" disabled={state === "saving" || chosen.length === 0} onClick={save}>
                  Create {chosen.length} bill{chosen.length === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
