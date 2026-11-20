"use client";

import { useState } from "react";
import { Button, Chip, Dialog } from "@/components/ui";
import type { JobCloseStep } from "@/lib/monthCloseServer";

/**
 * "Close month" on an Invoice Status job card — for AFTER the client invoice
 * is sent. One POST to /api/invoicing-summary/close (closeJobMonth in
 * src/lib/monthCloseServer.ts). It writes the job's tracking sheet and the
 * companion DB, never JobTread:
 *   1. files CURRENT INVOICE into the sheet's next record block (unless the
 *      block already holds the month),
 *   2. clears the sheet's sub/vendor bill list and points the Labor tab's A1 at
 *      next month's Labor Report,
 *   3. locks the month in the app: the Tracking Sheet board goes read-only and
 *      the sheet's sync refuses the month.
 * The card then reads "Closed" with an Unlock button. Unlock lifts the lock
 * only: the record block stays filed and the sheet is not put back.
 */
export type ClosedMark = { at: string; by: string } | null;

const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

async function post(body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await fetch("/api/invoicing-summary/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.error) throw new Error(j?.error || `Request failed (${res.status})`);
  return j;
}

export function CloseMonth({
  jobId,
  ym,
  month,
  jobTitle,
  closed,
  onChange,
}: {
  jobId: string;
  ym: string;
  /** "October 2026" */
  month: string;
  jobTitle: string;
  closed: ClosedMark;
  onChange: (next: ClosedMark) => void;
}) {
  const [open, setOpen] = useState<"close" | "unlock" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<JobCloseStep[] | null>(null);

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      if (open === "close") {
        const r = await post({ op: "close", jobId, ym });
        setSteps(r.steps ?? []);
        onChange({ at: new Date().toISOString(), by: "" });
      } else {
        await post({ op: "unlock", jobId, ym });
        onChange(null);
        setOpen(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    if (busy) return;
    setOpen(null);
    setSteps(null);
    setError("");
  };

  return (
    <>
      {closed ? (
        <>
          <Chip tone="success"title={closed.by ? `Closed by ${closed.by}` : undefined}>
            Closed{closed.at ? ` ${day(closed.at)}` : ""}
          </Chip>
          <Button variant="secondary" size="xs" onClick={() => setOpen("unlock")}>
            Unlock
          </Button>
        </>
      ) : (
        <Button size="xs" onClick={() => setOpen("close")}>
          Close month
        </Button>
      )}
      {open && (
        <Dialog
          busy={busy}
          onClose={dismiss}
          title={steps ? "Month closed" : open === "close" ? `Close ${month}?` : `Unlock ${month}?`}
          description={
            <>
              {month}
              {jobTitle ? ` · ${jobTitle}` : ""}.{" "}
              {open === "close"
                ? "Files CURRENT INVOICE into the tracking sheet's record block, clears the sheet's sub/vendor bill list, points the Labor tab at next month's labor report, and locks the month in the app. Nothing is written to JobTread."
                : "Edits to the month are allowed again, and the sheet's 30-minute sync resumes. The record block stays filed. The bill list and the labor link are not put back."}
            </>
          }
          footer={
            steps ? (
              <Button className="min-h-11 w-full" onClick={dismiss}>
                Done
              </Button>
            ) : (
              <div className="grid w-full grid-cols-2 gap-2">
                <Button variant="secondary" className="min-h-11 w-full" onClick={dismiss} disabled={busy}>
                  Cancel
                </Button>
                <Button className="min-h-11 w-full" onClick={run} disabled={busy}>
                  {busy ? (open === "close" ? "Closing…" : "Unlocking…") : open === "close" ? "Close month" : "Unlock"}
                </Button>
              </div>
            )
          }
        >
          {steps ? (
            <ol className="space-y-1.5 text-sm">
              {steps.map((s) => (
                <li key={s.label} className="flex gap-2">
                  <span aria-hidden className="w-4 shrink-0 text-center">
                    {s.state === "done" ? "✓" : "–"}
                  </span>
                  <span>
                    {s.label}
                    {s.note && <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">{s.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {open === "close" ? "This writes to the job's Google tracking sheet." : "This writes nothing to the sheet."}
            </p>
          )}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </Dialog>
      )}
    </>
  );
}
