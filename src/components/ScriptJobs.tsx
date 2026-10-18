"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, Card, Loading, SectionLabel, Spinner } from "@/components/ui";
import {
  InvoiceSweepResultModal,
  isSweepResult,
  type SweepResult,
} from "@/components/InvoiceSweepResult";

/** Registry task whose result opens the sweep notice modal. */
const SWEEP_TASK = "scanJtInvoiceCaptureTags";

// The Actions page renders one button per script job, driven entirely by the
// Apps Script COMPANION_TASKS registry (GET /api/actions). To add a button, add
// an entry to that registry — nothing here changes.
interface Task {
  key: string;
  label: string;
  group: string;
  description?: string;
  lock?: boolean;
}

type RunState = {
  status: "idle" | "busy" | "done" | "error";
  note?: string;
  lockBusy?: boolean;
};

/**
 * Run-now buttons for Apps Script jobs, filtered by key. The Actions page that
 * listed all six retired 2026-10-18 (CONSOLIDATION_PLAN.md stage 6): each
 * button now sits beside the thing it updates — the email scans on Inbox, the
 * project, vendor and expenditure-summary syncs in Tracking Sheets' Company
 * tools.
 */
export function ScriptJobs({ keys, title }: { keys: string[]; title?: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  // The invoice sweep's per-email result, shown in a notice modal after the run.
  const [sweep, setSweep] = useState<SweepResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/actions");
        const j = await res.json();
        if (!res.ok || j.ok === false) setLoadError(j.error ?? `HTTP ${res.status}`);
        else setTasks(((j.tasks ?? []) as Task[]).filter((t) => keys.includes(t.key)));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Network error");
      }
    })();
  }, []);

  // Group in registry order; preserve first-seen group order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Task[]>();
    (tasks ?? []).forEach((t) => {
      if (!map.has(t.group)) {
        map.set(t.group, []);
        order.push(t.group);
      }
      map.get(t.group)!.push(t);
    });
    return order.map((g) => ({ group: g, tasks: map.get(g)! }));
  }, [tasks]);

  async function run(task: Task) {
    setRuns((r) => ({ ...r, [task.key]: { status: "busy" } }));
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task.key }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) {
        setRuns((r) => ({ ...r, [task.key]: { status: "error", note: j.error ?? `HTTP ${res.status}` } }));
      } else if (j.lockBusy) {
        setRuns((r) => ({
          ...r,
          [task.key]: { status: "done", lockBusy: true, note: j.note ?? "Lock busy — nothing ran." },
        }));
      } else {
        setRuns((r) => ({ ...r, [task.key]: { status: "done", note: j.note ?? "Done." } }));
        // The sweep returns a detailed per-email result — show the notice modal.
        if (task.key === SWEEP_TASK && isSweepResult(j.result)) setSweep(j.result);
      }
    } catch (e) {
      setRuns((r) => ({
        ...r,
        [task.key]: { status: "error", note: e instanceof Error ? e.message : "Network error" },
      }));
    }
  }

  return (
    <div>
      {title && <SectionLabel className="mb-2">{title}</SectionLabel>}

      {loadError && <Banner tone="error">{loadError}</Banner>}
      {!tasks && !loadError && <Loading label="Loading…" />}

      {groups.map(({ group, tasks: groupTasks }) => (
        <section key={group} className="mb-4">
          {!title && <SectionLabel className="mb-2">{group}</SectionLabel>}
          <Card pad={false} className="divide-y divide-line-soft overflow-hidden">
            {groupTasks.map((t) => {
              const st: RunState = runs[t.key] ?? { status: "idle" };
              return (
                <div key={t.key} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">{t.label}</div>
                    {t.description && (
                      <div className="mt-0.5 text-xs text-neutral-500">{t.description}</div>
                    )}
                    {st.note && (
                      <div
                        className={
                          "mt-1 text-xs " +
                          (st.status === "error"
                            ? "text-red-600 dark:text-red-400"
                            : st.lockBusy
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400")
                        }
                      >
                        {st.note}
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={() => run(t)}
                    disabled={st.status === "busy"}
                    variant={st.status === "error" ? "danger" : "primary"}
                    size="sm"
                    className="shrink-0"
                  >
                    {st.status === "busy" ? (
                      <>
                        <Spinner className="border-white/40 border-t-white" /> Running…
                      </>
                    ) : st.status === "done" ? (
                      "Run again"
                    ) : st.status === "error" ? (
                      "Retry"
                    ) : (
                      "Run"
                    )}
                  </Button>
                </div>
              );
            })}
          </Card>
        </section>
      ))}

      <InvoiceSweepResultModal result={sweep} onClose={() => setSweep(null)} />
    </div>
  );
}
