"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { JobPicker, type JobRef } from "@/components/JobPicker";
import {
  Banner,
  Button,
  Card,
  CardSkeletonList,
  Chip,
  EmptyState,
  Input,
  PageHeader,
  SectionLabel,
  StickyActionBar,
  Toggle,
} from "@/components/ui";

interface Line {
  ref: string;
  chargeDate: string;
  rawName: string;
  amount: number;
  projectId: string;
  projectName: string;
  csi: string;
  status: string;
  expId: string;
  notes: string;
  knownAlias: boolean;
  candidates: { id: string; name: string; customer: string }[];
}

interface Statement {
  statementDate: string;
  total: number;
  unresolved: number;
  lines: Line[];
}

interface ProjectRef {
  id: string;
  label: string;
  jtJobId: string;
}

interface SubmitBill {
  expId: string;
  projectId: string;
  projectName: string;
  amount: number;
  lines: number;
  pushed: boolean;
  jtDocId?: string;
  error?: string;
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Per-line edits, keyed by the LSWDD reference number. */
interface Edit {
  projectId: string;
  csi: string;
  learnAlias: boolean;
}

/**
 * LSWDD statement review.
 *
 * The island dump bills us once a month on a single statement carrying dump
 * charges for every job we hauled from — "Charge Miller $18.00" — under
 * informal names that don't always match a job. The Apps Script sweep parses
 * the statement email and stages each charge here; nothing has reached
 * JobTread yet. Assign each line to a job, adjust the cost code if it isn't a
 * plain dump run, and Submit: the lines are grouped by job and each group
 * becomes its own draft vendor bill, so job costing lands where it belongs.
 *
 * Ticking "Remember" teaches the sweep that name, so next month's statement
 * arrives pre-filled.
 */
export default function LswddPage() {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [defaultCsi, setDefaultCsi] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [budgets, setBudgets] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitBill[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/lswdd");
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Request failed");
        return;
      }
      const stmts: Statement[] = json.statements ?? [];
      setStatements(stmts);
      setProjects(json.projects ?? []);
      setDefaultCsi(json.defaultCsi ?? "");

      const seed: Record<string, Edit> = {};
      for (const s of stmts) {
        for (const l of s.lines) {
          seed[l.ref] = {
            projectId: l.projectId,
            csi: l.csi || json.defaultCsi || "",
            // A name the sweep already knows needs no re-teaching; an
            // unrecognised one defaults to being remembered, since typing the
            // same mapping every month is the thing this page exists to stop.
            learnAlias: !l.knownAlias,
          };
        }
      }
      setEdits(seed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The jobs the user has actually picked — used to offer that job's real budget
  // cost codes rather than a free-text CSI that might not exist in its budget.
  const pickedJtJobIds = useMemo(() => {
    const byProject = new Map(projects.map((p) => [p.id, p.jtJobId]));
    const ids = new Set<string>();
    for (const e of Object.values(edits)) {
      const jt = e.projectId ? byProject.get(e.projectId) : "";
      if (jt) ids.add(jt);
    }
    return [...ids].sort();
  }, [edits, projects]);

  useEffect(() => {
    const missing = pickedJtJobIds.filter((id) => !budgets[id]);
    if (missing.length === 0) return;
    let alive = true;
    fetch(`/api/job-budget?jobIds=${missing.join(",")}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j.budgets) return;
        const next: Record<string, string[]> = {};
        for (const [jobId, byCode] of Object.entries(j.budgets as Record<string, object>)) {
          next[jobId] = Object.keys(byCode).sort();
        }
        setBudgets((b) => ({ ...b, ...next }));
      })
      .catch(() => {
        /* budget codes are a convenience — the CSI field still works without them */
      });
    return () => {
      alive = false;
    };
  }, [pickedJtJobIds, budgets]);

  const jobsForPicker: JobRef[] = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.label })),
    [projects],
  );

  const setEdit = (ref: string, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [ref]: { ...prev[ref], ...patch } }));

  async function dismiss(ref: string) {
    if (
      !window.confirm(
        "Exclude this charge from JobTread?\n\nUse this for a dump run that shouldn't be billed to a job. It stays on the statement record but is never sent.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/lswdd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, dismiss: true }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) setError(json.error ?? "Dismiss failed");
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  // The first sweep can pull in months of back statements whose charges were
  // billed and paid long ago. Rather than excluding a dozen lines one at a
  // time, clear the whole month.
  async function dismissStatement(statementDate: string, count: number) {
    if (
      !window.confirm(
        `Exclude the entire ${statementDate} statement?\n\nAll ${count} charges leave the queue and are never sent to JobTread. Use this for an old statement that was already billed and paid.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/lswdd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statementDate }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) setError(json.error ?? "Exclude failed");
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function submit(statement: Statement) {
    const lines = statement.lines
      .filter((l) => edits[l.ref]?.projectId)
      .map((l) => ({
        ref: l.ref,
        projectId: edits[l.ref].projectId,
        csi: edits[l.ref].csi,
        learnAlias: edits[l.ref].learnAlias,
      }));
    if (lines.length === 0) return;

    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/lswdd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Submit failed");
        if (Array.isArray(json.bills)) setResult(json.bills);
        return;
      }
      setResult(json.bills ?? []);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-32 pt-6">
      <PageHeader
        title="LSWDD Statement"
        description="The dump bills one statement a month covering every job. Assign each charge to a job, then submit — each job gets its own draft bill in JobTread."
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading || busy}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {loading && <CardSkeletonList rows={3} />}
      {error && <Banner tone="error">{error}</Banner>}

      {result && (
        <Banner tone={result.every((b) => b.pushed) ? "success" : "warning"} className="mb-4">
          <div className="font-semibold">
            {result.filter((b) => b.pushed).length} of {result.length} draft bill
            {result.length === 1 ? "" : "s"} created in JobTread
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {result.map((b) => (
              <li key={b.expId}>
                {b.pushed ? "✔" : "✖"} {b.projectName || b.projectId} · {money(b.amount)} ·{" "}
                {b.lines} line{b.lines === 1 ? "" : "s"}
                {b.error ? ` — ${b.error}` : ""}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {!loading && !error && statements.length === 0 && (
        <EmptyState>
          No LSWDD charges waiting. The sweep checks for a new statement every 15 minutes.
        </EmptyState>
      )}

      {statements.map((s) => {
        const assignable = s.lines.filter((l) => edits[l.ref]?.projectId).length;
        const byJob = new Map<string, number>();
        for (const l of s.lines) {
          const pid = edits[l.ref]?.projectId;
          if (pid) byJob.set(pid, (byJob.get(pid) ?? 0) + l.amount);
        }

        return (
          <section key={s.statementDate} className="mb-8">
            <SectionLabel>Statement {s.statementDate}</SectionLabel>

            <Card className="mb-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {s.lines.length} charge{s.lines.length === 1 ? "" : "s"} ·{" "}
                  {byJob.size || "no"} job{byJob.size === 1 ? "" : "s"}
                </span>
                <span className="font-mono font-semibold">{money(s.total)}</span>
              </div>
              {s.unresolved > 0 && (
                <div className="mt-2 text-xs text-neutral-500">
                  {s.unresolved} charge{s.unresolved === 1 ? "" : "s"} still need a job.
                </div>
              )}
              <div className="mt-2 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dismissStatement(s.statementDate, s.lines.length)}
                  disabled={busy}
                  title="Already billed and paid — clear this whole statement off the queue"
                >
                  Exclude entire statement
                </Button>
              </div>
            </Card>

            <ul className="space-y-3">
              {s.lines.map((l) => {
                const e = edits[l.ref] ?? { projectId: "", csi: defaultCsi, learnAlias: true };
                const jtJobId = projects.find((p) => p.id === e.projectId)?.jtJobId ?? "";
                const codes = jtJobId ? budgets[jtJobId] : undefined;

                return (
                  <li
                    key={l.ref}
                    className="rounded-xl border border-line bg-white p-4 dark:bg-ink-raised"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">
                          {l.rawName}
                          {l.knownAlias && (
                            <Chip tone="neutral" className="ml-2 align-middle">
                              known name
                            </Chip>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-neutral-500">
                          {l.chargeDate} · ref {l.ref}
                        </div>
                      </div>
                      <div className="font-mono text-sm font-semibold">{money(l.amount)}</div>
                    </div>

                    {l.notes && !e.projectId && (
                      <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                        {l.notes}
                      </div>
                    )}

                    {/* One tap for each name the resolver thought plausible — the
                        common ambiguity is a customer with two jobs. */}
                    {!e.projectId && l.candidates.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {l.candidates.map((c) => (
                          <Button
                            key={c.id}
                            variant="outline"
                            size="sm"
                            onClick={() => setEdit(l.ref, { projectId: c.id })}
                          >
                            {c.customer ? `${c.customer} - ${c.name}` : c.name}
                          </Button>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="min-w-[12rem] flex-1">
                        <JobPicker
                          jobs={jobsForPicker}
                          includeAll={false}
                          placeholder="Pick a job"
                          value={e.projectId}
                          onChange={(id) => setEdit(l.ref, { projectId: id })}
                        />
                      </div>

                      {codes && codes.length > 0 ? (
                        <select
                          className="h-10 rounded-lg border border-line bg-white px-2 font-mono text-xs dark:bg-ink-raised"
                          value={e.csi}
                          onChange={(ev) => setEdit(l.ref, { csi: ev.target.value })}
                          title="Cost code from this job's JobTread budget"
                        >
                          {!codes.includes(e.csi) && <option value={e.csi}>{e.csi} (not in budget)</option>}
                          {codes.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          className="w-32 font-mono text-xs"
                          value={e.csi}
                          onChange={(ev) => setEdit(l.ref, { csi: ev.target.value })}
                          title="Cost code"
                        />
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismiss(l.ref)}
                        disabled={busy}
                        title="Not a job cost — never send this charge to JobTread"
                      >
                        Exclude
                      </Button>
                    </div>

                    {e.projectId && !l.knownAlias && (
                      <div className="mt-2">
                        <Toggle
                          checked={e.learnAlias}
                          onChange={(v) => setEdit(l.ref, { learnAlias: v })}
                          label={`Remember “${l.rawName}” for next month`}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {byJob.size > 0 && (
              <Card className="mt-3">
                <SectionLabel>Bills this will create</SectionLabel>
                <ul className="mt-1 space-y-1 text-sm">
                  {[...byJob.entries()].map(([pid, amt]) => (
                    <li key={pid} className="flex justify-between gap-3">
                      <span className="truncate">
                        {projects.find((p) => p.id === pid)?.label ?? pid}
                      </span>
                      <span className="font-mono">{money(amt)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <StickyActionBar>
              <Button
                className="w-full"
                onClick={() => submit(s)}
                disabled={busy || assignable === 0}
              >
                {busy
                  ? "Sending…"
                  : `Create ${byJob.size} draft bill${byJob.size === 1 ? "" : "s"} in JobTread`}
              </Button>
            </StickyActionBar>
          </section>
        );
      })}
    </main>
  );
}
