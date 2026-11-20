/**
 * The deposit checks (DEPOSITS_PLAN.md, Stage 5), on Berger- and Studio-shaped
 * evidence.
 */
import { describe, expect, it } from "vitest";
import { buildDepositLedger, type DepositInvoice } from "@/lib/deposits";
import { depositLineTaxableCheck, depositLineUncodedCheck, depositOverdrawnCheck } from "./checks/deposits";
import type { InvoiceEvidence, InvoiceLine, JobEvidence, MonthEvidence } from "./types";

const global = { tolerance: 0.005 };
const month = {} as MonthEvidence;

const line = (o: Partial<InvoiceLine> & { id: string }): InvoiceLine => ({
  name: "Deposit", description: "", code: "CD", codeName: "Contract Deposit",
  cost: 0, unitCost: 0, quantity: 1, unitPrice: 0, price: 0, isTaxable: false, ...o,
});

const invoice = (lines: InvoiceLine[], taxRate = 0): InvoiceEvidence => ({
  id: "i400", number: "400", name: "October billing", status: "draft", issueDate: "2026-10-31", dueDate: "",
  cost: 0, price: 0, priceWithTax: 0, tax: 0, taxRate, amountPaid: 0, balance: 0,
  lines, billIds: [], jtUrl: "https://app.jobtread.com/x",
});

const job = (o: Partial<JobEvidence> = {}): JobEvidence => ({
  jobId: "J", jobName: "Bunkhouse", customerName: "Berger", neverInvoiced: false, invoices: [], bills: [],
  folder: null, uninvoicedBillsCost: 0, uninvoicedTimeCost: 0, draftBillsCost: 0, draftBillCount: 0,
  draftBills: [], labor: [], ...o,
});

const inv = (o: Partial<DepositInvoice> & { id: string }): DepositInvoice => ({
  number: null, name: "", status: "approved", issueDate: "2026-08-31", priceWithTax: 0, amountPaid: 0, jobId: "J", ...o,
});

// Berger: $128,842 deposit, $92,000 applied before JobTread, $20,000 drawn on #320.
const ledger = (draft: number, entered = true) =>
  buildDepositLedger({
    entered: entered ? { amount: 128842, previouslyApplied: 92000 } : null,
    lines: [
      { id: "l320", price: -20000, isTaxable: false, invoice: inv({ id: "i320", number: 320 }) },
      { id: "lD", price: -draft, isTaxable: false, invoice: inv({ id: "iD", number: 400, status: "draft", issueDate: "2026-10-31" }) },
    ],
  });

const overdrawn = (j: JobEvidence) => depositOverdrawnCheck.run({ config: {}, global, month, job: j });

describe("deposit-overdrawn", () => {
  it("silent while the draft fits what is left ($16,842)", () => {
    expect(overdrawn(job({ deposit: ledger(16842) }))).toEqual([]);
  });

  it("an error when the draft draws past what is left", () => {
    const [f] = overdrawn(job({ deposit: ledger(20000) }));
    expect(f).toMatchObject({ kind: "deposit-overdrawn", severity: "error", amount: 3158 });
  });

  it("a warning when draws exist and no deposit is recorded (Ferron)", () => {
    const [f] = overdrawn(job({ deposit: ledger(0, false) }));
    expect(f).toMatchObject({ kind: "deposit-unrecorded", amount: 20000 });
  });

  it("says nothing when the ledger was not read", () => {
    expect(overdrawn(job())).toEqual([]);
  });
});

describe("deposit lines", () => {
  const run = (check: typeof depositLineTaxableCheck, i: InvoiceEvidence) =>
    check.run({ config: {}, global, month, job: job(), invoice: i });

  it("flags a taxable CD line (Studio #8)", () => {
    const f = run(depositLineTaxableCheck, invoice([line({ id: "l8", price: 270975, isTaxable: true })]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "deposit-line-taxable", amount: 270975 });
  });

  it("passes a non-taxable CD line", () => {
    expect(run(depositLineTaxableCheck, invoice([line({ id: "l", price: -20000 })]))).toEqual([]);
  });

  it("flags a Deposit line coded to work, not CD", () => {
    const f = run(depositLineUncodedCheck, invoice([line({ id: "l", price: -20000, code: "01 00 00", codeName: "General" })]));
    expect(f[0]).toMatchObject({ kind: "deposit-line-uncoded", amount: 20000 });
  });

  it("leaves a CD line, and a Direct Deposit fee, alone", () => {
    const i = invoice([
      line({ id: "a", price: -20000 }),
      line({ id: "b", name: "Direct deposit fee", code: "01 00 00", price: 25 }),
    ]);
    expect(run(depositLineUncodedCheck, i)).toEqual([]);
  });
});
