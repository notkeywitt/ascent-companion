"use client";

import { useState } from "react";
import { Banner, Button } from "@/components/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" + "b" → "Oct 16–31". */
function periodLabel(ym: string, half: "a" | "b"): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const last = new Date(y, m, 0).getDate();
  return `${MONTHS[m - 1]} ${half === "a" ? "1–15" : `16–${last}`}`;
}

/**
 * "Email time entries" — POST /api/employee-time/email, which saves the pay
 * period's email to Casey, Ty and Sara as a Gmail draft, with EVERY employee's
 * JobTread time for the period attached as JobTread's CSV. The period is the
 * one the Timesheets tab is showing. A second press replaces that period's
 * draft with the latest, overwriting edits made in Gmail. Admin and office
 * only; the route checks the role again.
 *
 * The parent keys this on the period, so a result never outlives the period
 * it was made for.
 */
export function TimeEntriesEmailButton({ ym, half }: { ym: string; half: "a" | "b" }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{
    draftUrl: string;
    updated: boolean;
    subject: string;
    entries: number;
    running: number;
  } | null>(null);
  const label = periodLabel(ym, half);

  const run = async () => {
    setRunning(true);
    setError("");
    setDone(null);
    try {
      const res = await fetch("/api/employee-time/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ym, half }),
      });
      const j = await res.json();
      if (!res.ok || j.error) setError(j.error || `HTTP ${res.status}`);
      else setDone(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        className="min-h-11 w-full"
        onClick={run}
        disabled={running}
        title="Save the pay period's time entries email to Casey, Ty and Sara as a Gmail draft, every employee's JobTread time attached as a CSV. Pressed again, it replaces this period's draft with the latest."
      >
        {running ? "Drafting email…" : `${done ? "Update" : "Email"} ${label} time entries`}
      </Button>
      {error && <Banner tone="error">Time entries email: {error}</Banner>}
      {done && (
        <Banner tone={done.running ? "warning" : "success"}>
          <a href={done.draftUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
            Open the draft in Gmail ↗
          </a>{" "}
          · {done.subject} · {done.updated ? "Updated this period's draft with the latest" : "New draft"} ·{" "}
          {done.entries} {done.entries === 1 ? "entry" : "entries"} for all employees. Nothing is sent until you
          send it.
          {done.running > 0 && (
            <div className="mt-1 text-[12px]">
              {done.running} {done.running === 1 ? "entry is" : "entries are"} still clocked in, so the End column is
              blank. Press again once they clock out.
            </div>
          )}
        </Banner>
      )}
    </div>
  );
}
