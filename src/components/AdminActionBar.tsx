"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Card, SectionLabel, Spinner, btn } from "@/components/ui";
import {
  InvoiceSweepResultModal,
  isSweepResult,
  type SweepResult,
} from "@/components/InvoiceSweepResult";

/** Registry task whose result opens the sweep notice modal. */
const SWEEP_TASK = "scanJtInvoiceCaptureTags";

/**
 * The admin action bar at the bottom of the launcher — a curated, one-tap subset
 * of the script jobs on /actions (for the ones the office runs most often), plus
 * quick-jump links to the queues admins work most.
 *
 * TO ADD A RUN BUTTON: add ONE entry to ADMIN_ACTIONS below. `tasks` holds
 * COMPANION_TASKS keys (the registry in Diagnostics.js in the Apps Script repo)
 * and they run IN ORDER through POST /api/actions, so a single button can chain
 * several script jobs. Nothing else in this file or on the Home page changes.
 *
 * TO ADD A QUICK-JUMP LINK: add an entry to NAV_LINKS — these navigate (no
 * script run), carrying the selected job on the query string just like the
 * launcher's own links.
 *
 * Rendered only for users who can see the `actions` view (admin by default) —
 * the same gate the /actions page and the /api/actions route sit behind, so a
 * field or office account never sees these buttons nor can POST behind them.
 */

interface AdminAction {
  /** Local id — react key + run-state identity only; never sent to Apps Script. */
  id: string;
  label: string;
  /** COMPANION_TASKS keys, run in this order. */
  tasks: string[];
}

/** Direct-access shortcuts to the two busiest queues — both now views of Client
 *  Invoicing. These NAVIGATE (styled as outline links), not run-in-place like
 *  ADMIN_ACTIONS. */
const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Needs Coding", href: "/recode?tab=drafts" },
  { label: "Invoicing", href: "/recode" },
];

const ADMIN_ACTIONS: AdminAction[] = [
  {
    id: "scan-jt-invoice-tags",
    label: "Import Tagged Invoices",
    tasks: [SWEEP_TASK],
  },
  {
    id: "sync-vendors-projects-jobs",
    label: "Sync Vendors / Projects / Jobs",
    tasks: ["syncVendorsFromJobTread", "syncProjectsFromJobTread"],
  },
  {
    id: "sync-expenditure-summary",
    label: "Sync Expenditure Summary",
    tasks: ["generateMonthlyExpenditureSummary"],
  },
];

type Status = "idle" | "busy" | "done" | "error";
type RunState = { status: Status; note?: string; lockBusy?: boolean };

export function AdminActionBar({ jobQs = "" }: { jobQs?: string }) {
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  // The invoice sweep's per-email result, shown in a notice modal after the run.
  const [sweep, setSweep] = useState<SweepResult | null>(null);

  async function run(action: AdminAction) {
    setRuns((r) => ({ ...r, [action.id]: { status: "busy" } }));

    const notes: string[] = [];
    let lockBusy = false;
    let sweepResult: SweepResult | null = null;

    // Sequential, never parallel: the sync tasks share one Apps Script script
    // lock, so firing them together would just make the second report lock-busy.
    for (const task of action.tasks) {
      try {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task }),
        });
        const j = await res.json();
        if (!res.ok || j.ok === false) {
          setRuns((r) => ({
            ...r,
            [action.id]: { status: "error", note: j.error ?? `HTTP ${res.status}` },
          }));
          return;
        }
        // A lock-busy task did NOT run — carry that through so a partial chain
        // never reads as a clean success.
        if (j.lockBusy) lockBusy = true;
        if (j.note) notes.push(j.note);
        // The sweep returns a detailed per-email result; hold it for the modal.
        if (task === SWEEP_TASK && isSweepResult(j.result)) sweepResult = j.result;
      } catch (e) {
        setRuns((r) => ({
          ...r,
          [action.id]: {
            status: "error",
            note: e instanceof Error ? e.message : "Network error",
          },
        }));
        return;
      }
    }

    setRuns((r) => ({
      ...r,
      [action.id]: { status: "done", lockBusy, note: notes.join(" · ") || "Done." },
    }));
    if (sweepResult) setSweep(sweepResult);
  }

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <SectionLabel>Admin Actions</SectionLabel>
        <Link
          href="/actions"
          className="shrink-0 text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
        >
          All actions ›
        </Link>
      </div>

      {/* Quick-jump links — direct access to the queues admins work most. */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        {NAV_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href + jobQs}
            className={btn("outline", "md", "min-h-[44px]")}
          >
            {l.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ADMIN_ACTIONS.map((a) => {
          const st: RunState = runs[a.id] ?? { status: "idle" };
          return (
            <Card key={a.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{a.label}</div>
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
                onClick={() => run(a)}
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
            </Card>
          );
        })}
      </div>

      <InvoiceSweepResultModal result={sweep} onClose={() => setSweep(null)} />
    </section>
  );
}
