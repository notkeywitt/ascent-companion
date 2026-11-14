"use client";

import { useState } from "react";
import { Button, Dialog, btn } from "@/components/ui";
import { JtLink } from "@/components/JtLink";
import { runSheetOp, type TrackingTarget } from "@/components/TrackingSheetSync";
import { money } from "@/lib/money";
import { sheetWriteBlocked, shortMonth } from "@/lib/monthClose";
import type { MonthClosePreview } from "@/app/api/month-close/route";

/**
 * "Close month" — ONE step per job, once every bill is approved and nothing
 * is staged (OVERHAUL_PLAN Phase 6). It runs, in order, through the routes
 * the separate buttons used to call:
 *
 *   1. refresh the job's Google tracking sheet with the month's bills from
 *      JobTread (op "sync"),
 *   2. file the sheet: copy CURRENT INVOICE into the next free record block
 *      (op "finalize"; the route stamps `finalize`, and the last sheet filed
 *      moves the sheets to the next month),
 *   3. give the job's one customer contact Document Access to any bill of the
 *      month still missing it (/api/document-access),
 *   4. create the month's client invoice as a DRAFT in JobTread
 *      (/api/invoice-draft) and offer to open it.
 *
 * THE ONE CLOSE (the tracking-sheet month close, src/lib/monthClose.ts).
 * Steps 1 and 2 run only when the close preview (/api/month-close) says
 * "copy". A block that already holds the month is left as it is, and both
 * steps are skipped. A broken sheet (another month's labor, no free block, a
 * sheet wired to two jobs) is named, not filed, and steps 3 and 4 still run.
 * /api/tracking-sheet re-checks the same rules on the write.
 *
 * Steps 1 and 2 are skipped for a job with no tracking sheet. They run under
 * the shared per-project runner, back to back. A failed step stops the run.
 * The draft invoice is only created once an invoice does not exist yet, and
 * the host hides this button once one does.
 *
 * A month after the sheets' month is not open yet: the button is disabled
 * with the reason.
 */
type StepState = "todo" | "running" | "done" | "skipped" | "failed";
interface Step {
  key: "sync" | "finalize" | "access" | "invoice";
  label: string;
  state: StepState;
  note?: string;
}

const STEPS: Omit<Step, "state">[] = [
  { key: "sync", label: "Refresh the tracking sheet's bills from JobTread" },
  { key: "finalize", label: "File CURRENT INVOICE into the record block" },
  { key: "access", label: "Give the client access to the month's bills" },
  { key: "invoice", label: "Create the draft invoice in JobTread" },
];

async function postJson(url: string, body: unknown): Promise<Record<string, any>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.error || j?.ok === false) throw new Error(j?.error || `Request failed (${res.status})`);
  return j;
}

export function CloseMonth({
  jobId,
  ym,
  month,
  jobTitle,
  target,
  pinnedYm,
  writes,
  onClosed,
}: {
  jobId: string;
  ym: string;
  /** "October 2026" */
  month: string;
  jobTitle: string;
  /** The job's tracking sheet, or null for a job without one. */
  target: TrackingTarget | null;
  /** The month the 30-minute push holds; "" while unknown. */
  pinnedYm: string;
  writes: boolean;
  /** The month changed in JobTread: the host re-reads it. */
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [invoice, setInvoice] = useState<{ url?: string; price?: number } | null>(null);
  // One month at a time: a month after the sheets' month is not open yet.
  const notOpen = Boolean(target && pinnedYm && ym > pinnedYm);

  const mark = (key: Step["key"], state: StepState, note?: string) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, state, note } : s)));

  const run = async () => {
    setBusy(true);
    setInvoice(null);
    setSteps(STEPS.map((s) => ({ ...s, state: "todo" })));
    const [y, m] = ym.split("-").map(Number);
    try {
      if (target) {
        // The preview decides: copy, leave a filed block, or skip a broken
        // sheet (src/lib/monthClose.ts). A skipped sheet does not stop the
        // client access or the draft invoice.
        mark("sync", "running", "Checking the sheet…");
        const q = new URLSearchParams({ ym, projectId: target.projectId }).toString();
        const pv = await fetch(`/api/month-close?${q}`, { cache: "no-store" }).then((r) => r.json());
        if (pv?.error) throw new Error(pv.error);
        const row = (pv as MonthClosePreview).rows?.[0];
        if (!row) throw new Error("The sheet could not be checked.");
        if (row.plan.action === "filed") {
          mark("sync", "skipped", "The month is already filed on the sheet.");
          if (!row.closedAt) await postJson("/api/month-close", { op: "markFiled", projectId: target.projectId, ym });
          mark("finalize", "skipped", row.plan.reasons.join(" "));
        } else if (row.plan.action === "skip") {
          mark("sync", "skipped", "Not filed. Fix the sheet, then close again.");
          mark("finalize", "failed", row.plan.reasons.join(" "));
        } else {
          mark("sync", "running");
          const r = await runSheetOp(target.projectId, "sync", m, y);
          mark("sync", "done", `${r.rowCount ?? 0} rows · ${money(Number(r.total) || 0)}`);
          mark("finalize", "running");
          const f = await runSheetOp(target.projectId, "finalize", m, y);
          mark(
            "finalize",
            "done",
            `Filed as "${f.monthLabel ?? ""}" at ${f.targetRange ?? ""}.` +
              (f.advanced ? ` Every sheet is closed: the sheets moved to ${shortMonth(String(f.advanced))}.` : ""),
          );
        }
      } else {
        mark("sync", "skipped", "No tracking sheet on this job.");
        mark("finalize", "skipped");
      }

      mark("access", "running");
      const q = new URLSearchParams({ jobId, ym }).toString();
      const a = await fetch(`/api/document-access?${q}`, { cache: "no-store" }).then((r) => r.json());
      if (a?.error) throw new Error(a.error);
      const contacts: { membershipId: string; name: string; granted: number }[] = a?.contacts ?? [];
      const billCount: number = a?.billCount ?? 0;
      if (contacts.length === 1) {
        const [c] = contacts;
        if (billCount > 0 && c.granted < billCount) {
          const g = await postJson("/api/document-access", { jobId, ym, membershipId: c.membershipId });
          mark("access", "done", `${c.name}: ${g.previewed ? "would add to" : "added to"} ${g.previewed ? g.wouldAdd : g.added} bill${(g.previewed ? g.wouldAdd : g.added) === 1 ? "" : "s"}.`);
        } else mark("access", "done", `${c.name} already has every bill.`);
      } else {
        mark("access", "skipped", contacts.length === 0 ? "No customer contact on this job; add one in JobTread." : "Several contacts — pick in Give Document Access.");
      }

      mark("invoice", "running");
      const inv = await postJson("/api/invoice-draft", { jobId, ym });
      setInvoice({ url: inv.url, price: inv.price });
      mark("invoice", "done", `${inv.previewed ? "Would create" : "Created"} a draft for ${money(Number(inv.price) || 0)} before tax.`);
      onClosed();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setSteps((prev) => prev.map((s) => (s.state === "running" ? { ...s, state: "failed", note: msg } : s)));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setSteps([]);
    setInvoice(null);
  };
  const finished = steps.length > 0 && !busy;
  const failed = steps.some((s) => s.state === "failed");

  return (
    <>
      <Button
        className="min-h-11"
        disabled={notOpen}
        onClick={() => setOpen(true)}
      >
        Close month
      </Button>
      {notOpen && (
        <p className="basis-full text-center text-[12px] text-neutral-500 dark:text-neutral-400">
          {sheetWriteBlocked(ym, pinnedYm)}
        </p>
      )}
      {open && (
        <Dialog
          busy={busy}
          onClose={close}
          title={finished ? (failed ? "Close month needs a fix" : "Month closed") : `Close ${month}?`}
          description={
            <>
              {month}
              {jobTitle ? ` · ${jobTitle}` : ""}.{" "}
              {target
                ? "Checks the tracking sheet, refreshes its bills from JobTread, files CURRENT INVOICE into its next record block, gives the client access to the bills, and creates the draft invoice in JobTread. A block that already holds the month is left as it is."
                : "Gives the client access to the bills and creates the draft invoice in JobTread."}{" "}
              The invoice stays a draft: review and send it there.
            </>
          }
          footer={
            finished ? (
              <div className="grid w-full grid-cols-2 gap-2">
                <Button variant="secondary" className="min-h-11 w-full" onClick={close}>
                  Close
                </Button>
                {invoice?.url ? (
                  <JtLink href={invoice.url} className={btn("primary", "md", "min-h-11 w-full")}>
                    Open the invoice ↗
                  </JtLink>
                ) : failed ? (
                  <Button className="min-h-11 w-full" onClick={run}>
                    Try again
                  </Button>
                ) : (
                  <JtLink
                    href={`https://app.jobtread.com/jobs/${jobId}/documents`}
                    className={btn("primary", "md", "min-h-11 w-full")}
                  >
                    Open in JobTread ↗
                  </JtLink>
                )}
              </div>
            ) : (
              <div className="grid w-full grid-cols-2 gap-2">
                <Button variant="secondary" className="min-h-11 w-full" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button className="min-h-11 w-full" onClick={run} disabled={busy}>
                  {busy ? "Closing…" : "Close month"}
                </Button>
              </div>
            )
          }
        >
          {steps.length > 0 ? (
            <ol className="space-y-1.5 text-sm">
              {steps.map((s) => (
                <li key={s.key} className="flex gap-2">
                  <span aria-hidden className="w-4 shrink-0 text-center tabular-nums">
                    {s.state === "done" ? "✓" : s.state === "failed" ? "✕" : s.state === "running" ? "…" : s.state === "skipped" ? "–" : ""}
                  </span>
                  <span className={s.state === "todo" ? "text-neutral-400" : s.state === "failed" ? "text-danger" : ""}>
                    {s.label}
                    {s.note && (
                      <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">{s.note}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              This writes to the live JobTread org and to the Google sheet.
            </p>
          )}
          {!writes && (
            <p className="mt-2 text-[11px] text-warn">
              Writes are disabled on this deployment — the invoice and the access are preview only.
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}
