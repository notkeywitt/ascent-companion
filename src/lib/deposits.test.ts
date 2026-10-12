/**
 * JOB DEPOSITS — the ledger rules, pinned to real jobs (live JobTread, read
 * 2026-10-11). Deposit left = Deposit − Previously applied − Draws.
 *
 * If a rule change moves one of these balances, the change is wrong or this
 * file must say why.
 */
import { describe, expect, it } from "vitest";
import {
  buildDepositLedger,
  planDepositDraw,
  suggestDraw,
  type DepositInputs,
  type DepositInvoice,
  type DrawInvoice,
} from "./deposits";

const inv = (o: Partial<DepositInvoice> & { id: string }): DepositInvoice => ({
  number: null,
  name: "Monthly Invoice",
  status: "approved",
  issueDate: null,
  priceWithTax: 0,
  amountPaid: 0,
  jobId: "j",
  ...o,
});

// Berger — Bunkhouse. $128,842 paid before JobTread; one draw in JobTread so
// far: −$20,000 on #320. The office enters the deposit and what was applied
// before JobTread.
const berger = (previouslyApplied = 72000): DepositInputs => ({
  entered: { amount: 128842, previouslyApplied },
  lines: [
    { id: "l320", price: -20000, isTaxable: false, invoice: inv({ id: "i320", number: 320, issueDate: "2026-08-31", priceWithTax: 106750.68, amountPaid: 106750.68 }) },
  ],
});

// Gormley — Studio. Deposit invoice #8, $270,975, paid in full by three
// QuickBooks payments on 2026-10-08. Its line is (wrongly) taxable.
const studio = (amountPaid = 270975): DepositInputs => ({
  entered: null,
  lines: [
    { id: "l8", price: 270975, isTaxable: true, invoice: inv({ id: "i8", number: 8, name: "Deposit", issueDate: "2026-10-01", priceWithTax: 270975, amountPaid }) },
  ],
});

// Ferron — Otis Perkins. A draw in JobTread, no deposit entered yet. #385 is void.
const ferron = (): DepositInputs => ({
  entered: null,
  lines: [
    { id: "l386", price: -20000, isTaxable: false, invoice: inv({ id: "i386", number: 386, issueDate: "2026-08-31" }) },
    { id: "l385", price: -20000, isTaxable: false, invoice: inv({ id: "i385", number: 385, status: "denied", issueDate: "2026-09-11" }) },
  ],
});

describe("buildDepositLedger", () => {
  it("Berger: entered deposit, less previously applied, less JobTread draws", () => {
    expect(buildDepositLedger(berger())).toMatchObject({
      source: "entered",
      deposit: 128842,
      previouslyApplied: 72000,
      drawn: 20000,
      left: 36842,
      flags: [],
      hasDeposit: true,
    });
  });

  it("Studio: the deposit is the paid part of the deposit invoice", () => {
    const l = buildDepositLedger(studio());
    expect(l).toMatchObject({ source: "jobtread", deposit: 270975, previouslyApplied: 0, drawn: 0, left: 270975 });
    expect(l.flags).toEqual([{ kind: "taxable-line", invoiceNumber: 8 }]);
  });

  it("a deposit invoice half paid counts half, and shows the rest unpaid", () => {
    const l = buildDepositLedger(studio(135487.5));
    expect(l.deposit).toBe(135487.5);
    expect(l.entries[0]).toMatchObject({ kind: "deposit", amount: 135487.5, unpaid: 135487.5 });
  });

  it("a hand-entered deposit replaces the deposit invoice", () => {
    const l = buildDepositLedger({ ...studio(), entered: { amount: 300000, previouslyApplied: 0 } });
    expect(l).toMatchObject({ source: "entered", deposit: 300000, left: 300000 });
  });

  it("Ferron: a draw with no deposit recorded leaves Left unknown; the void drops out", () => {
    expect(buildDepositLedger(ferron())).toMatchObject({ source: null, drawn: 20000, left: null, hasDeposit: true });
  });

  it("a draft's draw is shown, not counted", () => {
    const input = berger();
    input.lines.push({ id: "lD", price: -20000, isTaxable: false, invoice: inv({ id: "iD", number: 400, status: "draft", issueDate: "2026-09-30" }) });
    expect(buildDepositLedger(input)).toMatchObject({ drawn: 20000, onDraft: 20000, left: 36842 });
  });

  it("flags a deposit drawn past zero", () => {
    expect(buildDepositLedger(berger(120000)).flags).toEqual([{ kind: "overdrawn", by: 11158 }]);
  });

  it("a job with nothing deposit-shaped has no deposit, so the card collapses", () => {
    expect(buildDepositLedger({ entered: null, lines: [] }).hasDeposit).toBe(false);
  });
});

describe("planDepositDraw — a draw on a draft invoice", () => {
  const ledger = () => buildDepositLedger(berger()); // $36,842 left
  const draft = (o: Partial<DrawInvoice> = {}): DrawInvoice => ({
    id: "iSep",
    number: 400,
    status: "draft",
    priceWithTax: 95000,
    inQbo: false,
    depositLines: [],
    ...o,
  });

  it("adds one deposit line for a fresh draw", () => {
    expect(planDepositDraw(ledger(), draft(), 20000)).toEqual({
      ok: true, mode: "create", lineId: null, from: 0, to: 20000, max: 36842,
    });
  });

  it("changes the line an invoice already carries, and 0 removes it", () => {
    const inv = draft({ priceWithTax: 75000, depositLines: [{ id: "cd1", price: -20000 }] });
    expect(planDepositDraw(ledger(), inv, 25000)).toMatchObject({ ok: true, mode: "update", lineId: "cd1", from: 20000, to: 25000 });
    expect(planDepositDraw(ledger(), inv, 0)).toMatchObject({ ok: true, mode: "delete", lineId: "cd1" });
    expect(planDepositDraw(ledger(), inv, 20000)).toMatchObject({ ok: true, mode: "noop" });
  });

  it("refuses more than is left", () => {
    expect(planDepositDraw(ledger(), draft(), 36842.01)).toEqual({
      ok: false, error: "Only $36,842.00 of the deposit is left to draw.",
    });
  });

  it("counts other drafts' draws as already spoken for", () => {
    const l = ledger();
    l.entries.push({ key: "x", kind: "draft", date: "2026-09-30", amount: 30000, invoiceId: "iOther", invoiceNumber: 401, invoiceName: "", invoiceStatus: "draft" });
    expect(planDepositDraw(l, draft(), 10000)).toEqual({ ok: false, error: "Only $6,842.00 of the deposit is left to draw." });
  });

  it("refuses more than the invoice total, so the invoice never goes negative", () => {
    expect(planDepositDraw(ledger(), draft({ priceWithTax: 6750.68 }), 7000)).toEqual({
      ok: false, error: "That is more than #400's total of $6,750.68.",
    });
  });

  it("refuses anything but a draft that QuickBooks has not seen", () => {
    expect(planDepositDraw(ledger(), draft({ status: "pending" }), 100)).toMatchObject({ ok: false });
    expect(planDepositDraw(ledger(), draft({ inQbo: true }), 100)).toMatchObject({ ok: false });
  });

  it("refuses a deposit invoice, and an invoice with two deposit lines", () => {
    expect(planDepositDraw(ledger(), draft({ depositLines: [{ id: "d", price: 17000 }] }), 100)).toMatchObject({ ok: false });
    const two = draft({ depositLines: [{ id: "a", price: -1 }, { id: "b", price: -2 }] });
    expect(planDepositDraw(ledger(), two, 100)).toMatchObject({ ok: false });
  });

  it("refuses a draw on a job with no deposit recorded", () => {
    expect(planDepositDraw(buildDepositLedger(ferron()), draft(), 20000)).toEqual({
      ok: false, error: "No deposit is recorded for this job yet. Enter the deposit first.",
    });
  });

  it("refuses a negative or non-numeric amount", () => {
    expect(planDepositDraw(ledger(), draft(), -5)).toMatchObject({ ok: false });
    expect(planDepositDraw(ledger(), draft(), Number.NaN)).toMatchObject({ ok: false });
  });
});

describe("suggestDraw", () => {
  const inv: DrawInvoice = { id: "i", number: 1, status: "draft", priceWithTax: 95000, inQbo: false, depositLines: [] };

  it("repeats the job's last draw", () => {
    expect(suggestDraw(buildDepositLedger(berger()), inv)).toBe(20000);
  });

  it("whole invoice when nothing was drawn yet, never above what is left", () => {
    expect(suggestDraw(buildDepositLedger(studio()), { ...inv, priceWithTax: 12000 })).toBe(12000);
    expect(suggestDraw(buildDepositLedger(studio(10000)), inv)).toBe(10000);
  });
});
