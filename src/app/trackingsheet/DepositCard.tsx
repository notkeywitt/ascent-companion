"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Chip,
  Input,
  ListCard,
  ListRow,
  MetaLine,
  SectionHeading,
  StatementBlock,
} from "@/components/ui";
import type { Recon } from "@/components/InvoiceReconcile";
import {
  suggestDraw,
  type DepositEntry,
  type DepositFlag,
  type DepositLedger,
  type DrawInvoice,
} from "@/lib/deposits";
import type { ClientPaymentRow } from "@/lib/jobtread";

/**
 * The job's DEPOSIT and its client payments, beside the month's invoice panel.
 *
 * Every figure is read live from JobTread through `/api/deposits`; the rules are
 * `src/lib/deposits.ts`. Two forms (assign a deposit payment, enter the opening
 * balance) write only the companion's `deposit_links` row. ONE control writes
 * to JobTread: "Draw from the deposit" sets the month's DRAFT invoice's one
 * Deposit line, through `/api/deposits/apply`, after a confirm — and only when
 * the app's JobTread writes are on. Plan: DEPOSITS_PLAN.md.
 *
 * Hidden on a job with no deposit and no client payment.
 */

interface DepositsPayload {
  jobId: string;
  jobName: string;
  account: { id: string; name: string } | null;
  ledger: DepositLedger;
  clientPayments: ClientPaymentRow[];
  note: string;
  updatedAt: string;
  updatedBy: string;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : "");

function entryLabel(e: DepositEntry): string {
  const inv = e.invoiceNumber != null ? `#${e.invoiceNumber}` : "an invoice";
  switch (e.kind) {
    case "received":
      return e.method === "invoice" ? `Deposit invoice ${inv}` : "Deposit payment";
    case "billed":
      return `Deposit invoice ${inv}, not paid yet`;
    case "billed-draft":
      return `Deposit invoice ${inv} (draft)`;
    case "drawn":
      return e.method === "invoice" ? `Drawn on ${inv}` : `Applied to ${inv}`;
    case "draft":
      return `Drawn on draft ${inv}`;
  }
}

/** "+" adds to the balance, "−" draws it; a deposit billed but unpaid does neither yet. */
const signOf = (e: DepositEntry) => (e.kind === "received" ? "+" : e.kind === "drawn" || e.kind === "draft" ? "−" : "");

function FlagLine({ chip, tone, children }: { chip: string; tone: "warning" | "danger"; children: React.ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
      <Chip tone={tone}>{chip}</Chip>
      <span>{children}</span>
    </p>
  );
}

export function DepositCard({
  jobId,
  recon,
  writes = false,
}: {
  jobId: string;
  recon: Recon | null;
  /** The app's JobTread writes are on: show the draw controls. */
  writes?: boolean;
}) {
  const [data, setData] = useState<DepositsPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPayments, setShowPayments] = useState(false);
  const [opening, setOpening] = useState<{ amount: string; asOf: string; note: string } | null>(null);
  /** Typed draw amounts, per draft invoice id. Unset = the suggested amount. */
  const [drawInput, setDrawInput] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    setOpening(null);
    (async () => {
      try {
        const res = await fetch(`/api/deposits?jobId=${encodeURIComponent(jobId)}`);
        const j = await res.json();
        if (!live) return;
        if (res.ok) setData(j);
        else setError(j.error ?? "Failed");
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Network error");
      }
    })();
    return () => {
      live = false;
    };
  }, [jobId]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/deposits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, ...body }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Failed");
        setData(j);
        setOpening(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setBusy(false);
      }
    },
    [jobId],
  );

  /** Draw `amount` from the deposit onto a draft invoice — a JobTread write. */
  const applyDraw = async (inv: DrawInvoice, amount: number, current: number) => {
    const num = inv.number ?? "?";
    const what =
      amount === 0
        ? `Remove the ${money(current)} Deposit line from draft #${num} in JobTread?`
        : `${current ? "Change" : "Add"} the Deposit line on draft #${num} to −${money(amount)} in JobTread?`;
    if (!window.confirm(what)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/deposits/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: inv.id, amount }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setData(j);
      setDrawInput((d) => {
        const next = { ...d };
        delete next[inv.id];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <Banner tone="warning" className="mt-3 text-xs">
        Couldn&apos;t read the deposit from JobTread: {error}
      </Banner>
    );
  }
  if (!data) return null;

  const { ledger, clientPayments, account } = data;
  if (!ledger.hasDeposit && clientPayments.length === 0) return null;

  const thisMonth = new Set((recon?.invoices ?? []).map((i) => i.id));
  const paidTotal = clientPayments.reduce((s, p) => s + p.amount, 0);
  const unlinked = ledger.flags.filter(
    (f): f is Extract<DepositFlag, { kind: "unlinked-application" }> => f.kind === "unlinked-application",
  );
  const openOpening = () =>
    setOpening({
      amount: ledger.opening != null ? String(ledger.opening) : "",
      asOf: ledger.openingAsOf ?? "",
      note: data.note,
    });

  return (
    <Card className="mt-3">
      {ledger.hasDeposit && (
        <>
          <SectionHeading trailing={account ? <MetaLine items={[account.name]} /> : undefined}>Deposit</SectionHeading>
          <StatementBlock
            rule={false}
            className="mt-2"
            label="Deposit left"
            value={ledger.left == null ? "—" : money(ledger.left)}
            sub={
              <MetaLine
                items={[
                  ledger.agreed ? `agreed ${money(ledger.agreed)}` : null,
                  ledger.opening != null ? `opening ${money(ledger.opening)} on ${ledger.openingAsOf}` : null,
                  ledger.received ? `received ${money(ledger.received)}` : null,
                  `drawn ${money(ledger.drawn)}`,
                  ledger.onDraft ? `${money(ledger.onDraft)} on a draft` : null,
                  ledger.billedUnpaid ? `${money(ledger.billedUnpaid)} billed, unpaid` : null,
                ]}
              />
            }
          />

          <div className="mt-3 space-y-1.5">
            {ledger.unassigned.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-2">
                <FlagLine chip="No job" tone="warning">
                  A {money(u.amount)} deposit{u.description ? ` (“${u.description}”)` : ""} paid {day(u.paidAt)} sits
                  on {account?.name ?? "the customer"}&apos;s account. JobTread cannot say which job it is for.
                </FlagLine>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: "assign-payment", paymentId: u.id })}>
                  It&apos;s this job&apos;s deposit
                </Button>
              </div>
            ))}
            {ledger.flags.map((f, i) => {
              switch (f.kind) {
                case "no-receipt":
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <FlagLine chip="No receipt" tone="warning">
                        {money(f.drawn)} drawn with no deposit recorded in JobTread. Enter the deposit left when the job
                        moved to JobTread (from the tracking sheet).
                      </FlagLine>
                      {!opening && (
                        <Button size="sm" variant="outline" onClick={openOpening}>
                          Enter opening balance
                        </Button>
                      )}
                    </div>
                  );
                case "overdrawn":
                  return (
                    <FlagLine key={i} chip="Overdrawn" tone="danger">
                      Drawn {money(f.by)} more than the deposit received.
                    </FlagLine>
                  );
                case "double-draw":
                  return (
                    <FlagLine key={i} chip="Drawn twice" tone="danger">
                      This deposit is drawn by invoice line AND by payment. One of them double-counts.
                    </FlagLine>
                  );
                case "taxable-line":
                  return (
                    <FlagLine key={i} chip="Taxable" tone="warning">
                      The deposit line on {f.invoiceNumber != null ? `#${f.invoiceNumber}` : "an invoice"} is marked
                      taxable. Deposit lines are not taxed.
                    </FlagLine>
                  );
                default:
                  return null;
              }
            })}
            {unlinked.length > 0 && (
              <FlagLine chip="Not in QuickBooks" tone="warning">
                {unlinked.map((u) => `#${u.invoiceNumber ?? "?"} ${money(u.amount)}`).join(", ")} applied from the
                deposit in JobTread only. Check QuickBooks shows these invoices paid.
              </FlagLine>
            )}
          </div>

          {opening && (
            <form
              className="mt-3 grid gap-2 rounded-lg border border-line-soft p-2.5 pad:grid-cols-[1fr_1fr_2fr_auto]"
              onSubmit={(ev) => {
                ev.preventDefault();
                post({ action: "set-opening", amount: Number(opening.amount), asOf: opening.asOf, note: opening.note });
              }}
            >
              <Input
                inputMode="decimal"
                placeholder="Deposit left ($)"
                aria-label="Deposit left when the job moved to JobTread"
                value={opening.amount}
                onChange={(e) => setOpening({ ...opening, amount: e.target.value })}
              />
              <Input
                type="date"
                aria-label="Date that balance was true on"
                value={opening.asOf}
                onChange={(e) => setOpening({ ...opening, asOf: e.target.value })}
              />
              <Input
                placeholder="Source, e.g. tracking sheet, Sept '26 block"
                aria-label="Where you got this number"
                value={opening.note}
                onChange={(e) => setOpening({ ...opening, note: e.target.value })}
              />
              <div className="flex gap-1.5">
                <Button size="sm" type="submit" disabled={busy || !opening.amount || !opening.asOf}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpening(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {writes &&
            (recon?.invoices ?? [])
              .filter((i) => i.status === "draft")
              .map((i) => {
                // What this draft already draws: a CD line counted as "draft".
                const current = ledger.entries
                  .filter((e) => e.kind === "draft" && e.invoiceId === i.id)
                  .reduce((s, e) => s + e.amount, 0);
                if (ledger.left == null && !current) return null;
                const inv: DrawInvoice = {
                  id: i.id,
                  number: Number(i.number) || null,
                  status: i.status,
                  priceWithTax: i.total,
                  inQbo: false, // a draft never is; the server checks again
                  depositLines: current ? [{ id: "current", price: -current }] : [],
                };
                const value = drawInput[i.id] ?? String(suggestDraw(ledger, inv));
                const amount = Number(value);
                return (
                  <div key={i.id} className="mt-3 rounded-lg border border-line-soft p-2.5">
                    <MetaLine
                      items={[
                        `Draft #${i.number}`,
                        `total ${money(i.total)}`,
                        current ? `draws ${money(current)} now` : "no deposit drawn yet",
                      ]}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input
                        inputMode="decimal"
                        className="w-36"
                        aria-label={`Deposit to draw on draft #${i.number}`}
                        value={value}
                        onChange={(e) => setDrawInput((d) => ({ ...d, [i.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        disabled={busy || value.trim() === "" || !Number.isFinite(amount) || amount < 0 || amount === current}
                        onClick={() => applyDraw(inv, amount, current)}
                      >
                        {current ? "Change the draw" : "Draw from the deposit"}
                      </Button>
                      {current > 0 && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => applyDraw(inv, 0, current)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

          {ledger.entries.length > 0 && (
            <ListCard className="mt-3">
              {ledger.entries.map((e) => (
                <ListRow
                  key={e.key}
                  label={<span className={e.beforeOpening ? "text-neutral-400" : ""}>{entryLabel(e)}</span>}
                  desc={
                    <MetaLine
                      items={[
                        day(e.date),
                        e.invoiceName || null,
                        e.method === "payment" && e.kind === "drawn" ? "payment applied" : null,
                        e.invoiceId && thisMonth.has(e.invoiceId) ? "this month" : null,
                        e.beforeOpening ? "before the opening balance" : null,
                      ]}
                    />
                  }
                  trailing={
                    <span className={`tabular-nums text-sm ${e.beforeOpening ? "text-neutral-400" : ""}`}>
                      {signOf(e)}
                      {money(e.amount)}
                    </span>
                  }
                />
              ))}
            </ListCard>
          )}

          {ledger.opening != null && !opening && (
            <MetaLine
              className="mt-2"
              items={[
                `Opening balance from ${data.updatedBy || "the office"}${data.note ? `: ${data.note}` : ""}`,
                <button key="c" type="button" className="underline" onClick={openOpening}>
                  Change
                </button>,
                <button key="x" type="button" className="underline" disabled={busy} onClick={() => post({ action: "clear-opening" })}>
                  Clear
                </button>,
              ]}
            />
          )}
          {ledger.opening == null && !opening && !ledger.flags.some((f) => f.kind === "no-receipt") && (
            <MetaLine
              className="mt-2"
              items={[
                <button key="o" type="button" className="underline" onClick={openOpening}>
                  Deposit older than JobTread? Enter its opening balance
                </button>,
              ]}
            />
          )}
        </>
      )}

      {clientPayments.length > 0 && (
        <div className={ledger.hasDeposit ? "mt-4" : ""}>
          <SectionHeading
            onToggle={() => setShowPayments((v) => !v)}
            open={showPayments}
            trailing={<MetaLine items={[`${money(paidTotal)} applied to this job's invoices`]} />}
          >
            Client payments ({clientPayments.length})
          </SectionHeading>
          {showPayments && (
            <ListCard className="mt-2">
              {clientPayments.map((p) => (
                <ListRow
                  key={p.applicationId}
                  label={`${money(p.amount)} to #${p.invoiceNumber ?? "?"}`}
                  desc={
                    <MetaLine
                      items={[
                        day(p.paidAt),
                        p.source === "qbo" ? "QuickBooks" : p.source || "JobTread",
                        p.description,
                        p.paymentAmount > p.amount + 0.005 ? `part of ${money(p.paymentAmount)}` : null,
                        !p.linkedToQbo && p.inQbo ? "not linked in QuickBooks" : null,
                      ]}
                    />
                  }
                  trailing={<span className="text-xs text-neutral-500 dark:text-neutral-400">{p.invoiceName}</span>}
                />
              ))}
            </ListCard>
          )}
        </div>
      )}

      {error && (
        <Banner tone="error" className="mt-3 text-xs">
          {error}
        </Banner>
      )}
    </Card>
  );
}
