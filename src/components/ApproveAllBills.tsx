"use client";

import { useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { Dialog } from "@/components/Dialog";
import { Banner, Button, SectionLabel } from "@/components/ui";
import { billingMonths } from "@/lib/billingMonths";
import { money } from "@/lib/money";

type Draft = { id: string; vendor: string; cost: number; isExpense: boolean; jobName?: string };

/**
 * Admin only, on the Jobs page's All Jobs card: approve every draft bill in
 * the picked billing month, across every job. Reads the month's bills from
 * /api/trackingsheet/all-bills, then one /api/bill-status POST per draft —
 * the same write the Tracking Sheet's batch approve makes (useBillApproval):
 * a Bill moves to Pending, an Expense to Approved.
 */
export function ApproveAllBills({ ym }: { ym: string }) {
  const { role } = useAccess();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (role !== "admin" || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [year, month] = ym.split("-").map(Number);
  const label = billingMonths().find((o) => o.value === ym)?.label ?? ym;

  const open = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/trackingsheet/all-bills?year=${year}&month=${month}&includeInvoiced=1`);
      const d: { error?: string; bills?: (Draft & { status: string })[] } = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || "Could not read the month's bills.");
      setDrafts((d.bills ?? []).filter((b) => b.status === "draft"));
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Could not read the month's bills." });
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!drafts) return;
    setBusy(true);
    let ok = 0;
    let previewed = false;
    const failures: string[] = [];
    for (const b of drafts) {
      try {
        const r = await fetch("/api/bill-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: b.id, status: b.isExpense ? "approved" : "pending" }),
        });
        const j = await r.json();
        if (!r.ok || j.error) failures.push(`${b.vendor}: ${j.error ?? "Approve failed"}`);
        else {
          ok++;
          if (j.previewed) previewed = true;
        }
      } catch (e) {
        failures.push(`${b.vendor}: ${e instanceof Error ? e.message : "Request failed"}`);
      }
    }
    setBusy(false);
    setDrafts(null);
    const verb = previewed ? "Would approve" : "Approved";
    setMsg(
      failures.length === 0
        ? { tone: "success", text: `${verb} ${ok} bill${ok === 1 ? "" : "s"}.` }
        : { tone: "error", text: `${verb} ${ok}, ${failures.length} failed: ${failures.slice(0, 2).join("; ")}` },
    );
  };

  const total = drafts?.reduce((s, b) => s + b.cost, 0) ?? 0;
  return (
    <div className="text-center">
      <Button variant="secondary" className="min-h-11" onClick={open} disabled={busy}>
        {busy && !drafts ? "Reading…" : "Approve All Bills"}
      </Button>
      {msg && (
        <Banner tone={msg.tone} className="mt-1.5 !py-2 text-xs">
          {msg.text}
        </Banner>
      )}
      {drafts && (
        <Dialog
          busy={busy}
          onClose={() => setDrafts(null)}
          title={`Approve ${drafts.length} draft bill${drafts.length === 1 ? "" : "s"}?`}
          description={`${label} · All Jobs. Bills move to Pending (approved for payment); Expenses move straight to Approved (paid).`}
          footer={
            <div className="grid w-full grid-cols-2 gap-2">
              <Button variant="secondary" className="min-h-11 w-full" onClick={() => setDrafts(null)} disabled={busy}>
                Cancel
              </Button>
              <Button className="min-h-11 w-full" onClick={approve} disabled={busy || drafts.length === 0}>
                {busy ? "Approving…" : `Approve ${drafts.length} bill${drafts.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          }
        >
          <ul className="space-y-2">
            {drafts.map((b) => (
              <li
                key={b.id}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm dark:border-neutral-700"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{b.vendor}</span>
                  {b.jobName ? <span className="text-neutral-500 dark:text-neutral-400"> · {b.jobName}</span> : null}
                  <span className="text-neutral-500 dark:text-neutral-400"> → {b.isExpense ? "Approved" : "Pending"}</span>
                </span>
                <span className="shrink-0 tabular-nums font-semibold">{money(b.cost)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 dark:border-neutral-700">
            <SectionLabel>Total</SectionLabel>
            <span className="text-xl font-bold tabular-nums">{money(total)}</span>
          </div>
        </Dialog>
      )}
    </div>
  );
}
