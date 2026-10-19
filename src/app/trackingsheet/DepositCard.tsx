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
  parseDollars,
  suggestDraw,
  type DepositEntry,
  type DepositLedger,
  type DrawInvoice,
  type EnteredDeposit,
} from "@/lib/deposits";
import type { ClientPaymentRow } from "@/lib/jobtread";
import { money } from "@/lib/money";

/**
 * The job's DEPOSIT and its client payments, beside the month's invoice panel.
 *
 *   Deposit left = Deposit − Previously applied − Draws
 *
 * The deposit is read from JobTread when the job has a paid deposit invoice
 * (Gormley Studio), or entered by hand for one taken before JobTread (Berger).
 * Draws are the negative Deposit lines on the job's client invoices. Rules:
 * `src/lib/deposits.ts`. ONE control writes to JobTread: "Draw from the
 * deposit" sets the month's DRAFT invoice's one Deposit line, through
 * `/api/deposits/apply`, after a confirm — and only when the app's JobTread
 * writes are on.
 */

interface DepositsPayload {
  jobId: string;
  jobName: string;
  ledger: DepositLedger;
  entered: EnteredDeposit | null;
  clientPayments: ClientPaymentRow[];
  note: string;
  updatedAt: string;
  updatedBy: string;
}

const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : "");

function entryLabel(e: DepositEntry): string {
  const inv = e.invoiceNumber != null ? `#${e.invoiceNumber}` : "an invoice";
  switch (e.kind) {
    case "deposit":
      return `Deposit invoice ${inv}`;
    case "drawn":
      return `Drawn on ${inv}`;
    case "draft":
      return `Drawn on draft ${inv}`;
  }
}

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
  /** The hand-entered deposit form, open. */
  const [form, setForm] = useState<{ amount: string; applied: string; note: string } | null>(null);
  /** Typed draw amounts, per draft invoice id. Unset = the suggested amount. */
  const [drawInput, setDrawInput] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    setForm(null);
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
        setForm(null);
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

  const { ledger, clientPayments, entered } = data;

  const thisMonth = new Set((recon?.invoices ?? []).map((i) => i.id));
  const paidTotal = clientPayments.reduce((s, p) => s + p.amount, 0);
  const openForm = () =>
    setForm({
      amount: entered ? String(entered.amount) : "",
      applied: entered ? String(entered.previouslyApplied) : "",
      note: data.note,
    });
  /** The payments that paid a deposit invoice: the deposit's link to JobTread. */
  const paidBy = (invoiceId: string) => clientPayments.filter((p) => p.invoiceId === invoiceId);

  const enterForm = form && (
    <form
      className="mt-3 grid gap-2 rounded-lg border border-line-soft p-2.5 pad:grid-cols-[1fr_1fr_2fr_auto]"
      onSubmit={(ev) => {
        ev.preventDefault();
        post({
          action: "set-deposit",
          amount: parseDollars(form.amount),
          previouslyApplied: parseDollars(form.applied),
          note: form.note,
        });
      }}
    >
      <Input
        inputMode="decimal"
        placeholder="Deposit ($)"
        aria-label="Deposit the client paid"
        value={form.amount}
        onChange={(e) => setForm({ ...form, amount: e.target.value })}
      />
      <Input
        inputMode="decimal"
        placeholder="Previously applied ($)"
        aria-label="Deposit applied to invoices before JobTread"
        value={form.applied}
        onChange={(e) => setForm({ ...form, applied: e.target.value })}
      />
      <Input
        placeholder="Note, e.g. from the tracking sheet"
        aria-label="Note"
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
      />
      <div className="flex gap-1.5">
        <Button size="sm" type="submit" disabled={busy || !(parseDollars(form.amount) > 0)}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setForm(null)}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 pad:col-span-4">
        Previously applied is what was drawn outside JobTread. Draws on JobTread invoices are counted below — do not
        include them.
      </p>
    </form>
  );

  if (!ledger.hasDeposit && clientPayments.length === 0) {
    return (
      <div className="mt-3">
        {form ? (
          <Card>{enterForm}</Card>
        ) : (
          <MetaLine
            items={[
              <button key="e" type="button" className="underline" onClick={openForm}>
                Enter a deposit
              </button>,
            ]}
          />
        )}
      </div>
    );
  }

  return (
    <Card className="mt-3">
      {ledger.hasDeposit || form ? (
        <>
          <SectionHeading>Deposit</SectionHeading>
          <StatementBlock
            rule={false}
            className="mt-2"
            label="Deposit left"
            value={ledger.left == null ? "—" : money(ledger.left)}
            sub={
              <MetaLine
                items={[
                  ledger.source ? `deposit ${money(ledger.deposit)}` : "no deposit recorded",
                  ledger.previouslyApplied ? `previously applied ${money(ledger.previouslyApplied)}` : null,
                  `drawn ${money(ledger.drawn)}`,
                  ledger.onDraft ? `${money(ledger.onDraft)} on a draft` : null,
                ]}
              />
            }
          />

          <div className="mt-3 space-y-1.5">
            {ledger.source == null && ledger.drawn > 0 && (
              <FlagLine chip="No deposit" tone="warning">
                {money(ledger.drawn)} drawn, but no deposit is recorded. Enter the deposit and what was applied before
                JobTread.
              </FlagLine>
            )}
            {ledger.flags.map((f, i) =>
              f.kind === "overdrawn" ? (
                <FlagLine key={i} chip="Overdrawn" tone="danger">
                  Drawn {money(f.by)} more than the deposit.
                </FlagLine>
              ) : (
                <FlagLine key={i} chip="Taxable" tone="warning">
                  The deposit line on {f.invoiceNumber != null ? `#${f.invoiceNumber}` : "an invoice"} is marked
                  taxable. Deposit lines are not taxed.
                </FlagLine>
              ),
            )}
          </div>

          {enterForm}

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
                const amount = parseDollars(value);
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

          {(ledger.entries.length > 0 || ledger.previouslyApplied > 0) && (
            <ListCard className="mt-3">
              {ledger.source === "entered" && (
                <ListRow
                  label="Deposit, entered by hand"
                  desc={
                    <MetaLine
                      items={[data.updatedBy || null, day(data.updatedAt), data.note || null]}
                    />
                  }
                  trailing={<span className="tabular-nums text-sm">+{money(ledger.deposit)}</span>}
                />
              )}
              {ledger.previouslyApplied > 0 && (
                <ListRow
                  label="Previously applied"
                  desc={<MetaLine items={["before JobTread"]} />}
                  trailing={<span className="tabular-nums text-sm">−{money(ledger.previouslyApplied)}</span>}
                />
              )}
              {ledger.entries.map((e) => {
                // A deposit invoice counts only when the deposit comes from JobTread.
                const muted = e.kind === "deposit" && ledger.source !== "jobtread";
                const payments = e.kind === "deposit" ? paidBy(e.invoiceId) : [];
                return (
                  <ListRow
                    key={e.key}
                    label={<span className={muted ? "text-neutral-400" : ""}>{entryLabel(e)}</span>}
                    desc={
                      <MetaLine
                        items={[
                          day(e.date),
                          e.invoiceName || null,
                          payments.length
                            ? `paid by ${payments.length === 1 ? "1 payment" : `${payments.length} payments`}, ${day(payments.at(-1)?.paidAt)}`
                            : null,
                          e.unpaid ? `${money(e.unpaid)} not paid yet` : null,
                          muted ? "not counted: the deposit is entered by hand" : null,
                          thisMonth.has(e.invoiceId) ? "this month" : null,
                        ]}
                      />
                    }
                    trailing={
                      <span className={`tabular-nums text-sm ${muted ? "text-neutral-400" : ""}`}>
                        {e.kind === "deposit" ? "+" : "−"}
                        {money(e.amount)}
                      </span>
                    }
                  />
                );
              })}
            </ListCard>
          )}

          {!form && ledger.source !== "jobtread" && (
            <MetaLine
              className="mt-2"
              items={
                entered
                  ? [
                      <button key="c" type="button" className="underline" onClick={openForm}>
                        Change the deposit
                      </button>,
                      <button
                        key="x"
                        type="button"
                        className="underline"
                        disabled={busy}
                        onClick={() => window.confirm("Clear the deposit entered by hand?") && post({ action: "clear-deposit" })}
                      >
                        Clear
                      </button>,
                    ]
                  : [
                      <button key="e" type="button" className="underline" onClick={openForm}>
                        Enter a deposit
                      </button>,
                    ]
              }
            />
          )}
        </>
      ) : (
        !form && (
          <MetaLine
            items={[
              <button key="e" type="button" className="underline" onClick={openForm}>
                Enter a deposit
              </button>,
            ]}
          />
        )
      )}

      {clientPayments.length > 0 && (
        <div className="mt-4">
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
