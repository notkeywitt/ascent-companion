"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Card, SectionLabel, Spinner } from "@/components/ui";

/**
 * The admin action bar at the top of the launcher — a curated, one-tap subset of
 * the script jobs on /actions, for the ones the office runs most often.
 *
 * TO ADD A BUTTON: add ONE entry to ADMIN_ACTIONS below. `tasks` holds
 * COMPANION_TASKS keys (the registry in Diagnostics.js in the Apps Script repo)
 * and they run IN ORDER through POST /api/actions, so a single button can chain
 * several script jobs. Nothing else in this file or on the Home page changes.
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

const ADMIN_ACTIONS: AdminAction[] = [
  {
    id: "scan-jt-invoice-tags",
    label: "Scan JT Invoice Tags",
    tasks: ["scanJtInvoiceCaptureTags"],
  },
  {
    id: "sync-vendors-projects-jobs",
    label: "Sync Vendors / Projects / Jobs",
    tasks: ["syncVendorsFromJobTread", "syncProjectsFromJobTread"],
  },
];

type Status = "idle" | "busy" | "done" | "error";
type RunState = { status: Status; note?: string; lockBusy?: boolean };

export function AdminActionBar() {
  const [runs, setRuns] = useState<Record<string, RunState>>({});

  async function run(action: AdminAction) {
    setRuns((r) => ({ ...r, [action.id]: { status: "busy" } }));

    const notes: string[] = [];
    let lockBusy = false;

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
    </section>
  );
}
