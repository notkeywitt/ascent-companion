"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import {
  Banner,
  Button,
  Chip,
  ListCard,
  ListRow,
  SectionLabel,
  type ChipTone,
} from "@/components/ui";
import type { LswddStatementBills } from "@/lib/jobtread";
import { companyToday, forgetFact } from "@/lib/homeFacts";
import {
  lswddApprovalTarget,
  lswddDayLabel,
  lswddLastPayDay,
  lswddPayReminder,
  type LswddPayState,
} from "@/lib/lswddPay";
import { money } from "@/lib/money";

const STATE: Record<LswddPayState, { label: string; tone: ChipTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  approved: { label: "Approved", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Voided", tone: "danger" },
};

/**
 * The newest LSWDD statement's bills in JobTread — one per job — with where
 * each stands (Draft / Approved / Paid) and an "Approve All" button.
 *
 * Approve All posts each draft to /api/bill-status, the same write the
 * Tracking Sheets approve uses: a Bill goes draft → pending ("approved for
 * payment"). The button shows only to a role with the `bill-approve` view,
 * which gates that route.
 *
 * `reloadKey` changes when the page creates bills, so the list re-reads.
 */
export function StatementBills({ reloadKey }: { reloadKey: number }) {
  const access = useAccess();
  const canApprove = access.can("bill-approve");
  const [data, setData] = useState<LswddStatementBills | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetch("/api/lswdd/bills");
      const j = await r.json();
      if (!r.ok || j.error) setError(j.error ?? "Could not read the LSWDD bills.");
      else setData(j as LswddStatementBills);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data || !data.statementDate) return null;

  const drafts = data.bills.filter((b) => b.payState === "draft");
  const unpaid = data.bills.filter((b) => b.payState !== "paid");
  const total = data.bills.reduce((n, b) => n + b.cost, 0);
  const lastPayDay = lswddLastPayDay(data.dueDate);
  const reminder = lswddPayReminder({ today: companyToday(), dueDate: data.dueDate, unpaid: unpaid.length });

  async function approveAll() {
    if (
      !window.confirm(
        `Approve ${drafts.length} LSWDD bill${drafts.length === 1 ? "" : "s"} for payment?\n\n` +
          `${money(drafts.reduce((n, b) => n + b.cost, 0))} in total. Approving sends each bill to QuickBooks and locks its lines in JobTread.`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    let ok = 0;
    let previewed = false;
    const failures: string[] = [];
    // One bill per request, in turn — the same loop the Tracking Sheets batch uses.
    for (const b of drafts) {
      try {
        const r = await fetch("/api/bill-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: b.id, status: lswddApprovalTarget(b) }),
        });
        const j = await r.json();
        if (!r.ok || j.error) failures.push(`${b.jobName}: ${j.error ?? "Approve failed"}`);
        else {
          ok++;
          if (j.previewed) previewed = true;
        }
      } catch (e) {
        failures.push(`${b.jobName}: ${e instanceof Error ? e.message : "Request failed"}`);
      }
    }
    const verb = previewed ? "Would approve" : "Approved";
    setMsg(
      failures.length === 0
        ? { tone: "success", text: `${verb} ${ok} bill${ok === 1 ? "" : "s"}.` }
        : { tone: "error", text: `${verb} ${ok}, ${failures.length} failed: ${failures.slice(0, 2).join("; ")}` },
    );
    forgetFact("lswdd-bills"); // the pay reminder reads the same bills
    setBusy(false);
    await load();
  }

  return (
    <section className="mb-8">
      <SectionLabel>Bills from the {data.statementDate} statement</SectionLabel>

      {reminder && (
        <Banner tone={reminder.overdue ? "error" : "warning"} className="mb-3">
          {reminder.overdue
            ? `Past due. The last open day to pay was ${lswddDayLabel(reminder.lastPayDay)}.`
            : `Pay by ${lswddDayLabel(reminder.lastPayDay)}. LSWDD is open Friday to Monday only.`}
        </Banner>
      )}
      {msg && (
        <Banner tone={msg.tone} className="mb-3">
          {msg.text}
        </Banner>
      )}

      <ListCard>
        {data.bills.map((b) => (
          <ListRow
            key={b.id}
            href={`/bill/${b.id}`}
            label={b.jobName}
            desc={b.number != null ? `Bill #${b.number}` : undefined}
            badge={<Chip tone={STATE[b.payState].tone}>{STATE[b.payState].label}</Chip>}
            trailing={<span className="ml-3 shrink-0 font-mono text-sm font-semibold">{money(b.cost)}</span>}
          />
        ))}
      </ListCard>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-neutral-500">
          {money(total)} · due {lswddDayLabel(data.dueDate)}
          {lastPayDay !== data.dueDate && ` · last open day ${lswddDayLabel(lastPayDay)}`}
        </span>
        {canApprove && drafts.length > 0 && (
          <Button onClick={approveAll} disabled={busy}>
            {busy ? "Approving…" : `Approve All (${drafts.length})`}
          </Button>
        )}
      </div>
    </section>
  );
}
