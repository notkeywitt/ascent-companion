/**
 * JOB DEPOSITS — the ledger rules, pinned to the six real jobs they were
 * written from (live JobTread, read 2026-10-05; see DEPOSITS_PLAN.md §4).
 *
 * Each job exercises one way the office records a deposit. If a rule change
 * moves one of these balances, the change is wrong or the plan must say why.
 */
import { describe, expect, it } from "vitest";
import {
  buildDepositLedger,
  NO_LINKS,
  paymentOwner,
  type CustomerPayment,
  type DepositInputs,
  type DepositInvoice,
  type DepositLinks,
} from "./deposits";

const inv = (o: Partial<DepositInvoice> & { id: string }): DepositInvoice => ({
  number: null,
  name: "Monthly Invoice",
  status: "approved",
  issueDate: null,
  priceWithTax: 0,
  amountPaid: 0,
  jobId: null,
  ...o,
});

const app = (id: string, amount: number, linked: boolean, invoice: DepositInvoice) => ({
  id,
  amount,
  isLinkedToQbo: linked,
  createdAt: `${invoice.issueDate ?? "2026-01-01"}T12:00:00.000Z`,
  invoice,
});

const qboPayment = (id: string, amount: number, apps: CustomerPayment["applications"]): CustomerPayment => ({
  id,
  amount,
  paidAt: "2026-09-17T07:00:00.000Z",
  description: "Payment received in QuickBooks Online",
  source: "qbo",
  qboId: "1",
  applications: apps,
});

const links = (o: Partial<DepositLinks> = {}): DepositLinks => ({ ...NO_LINKS, ...o });

// ── the six jobs ─────────────────────────────────────────────────────────────

const VELORUM_PRECON = "22PYuNAh6Agh";
const velorum = (): DepositInputs => {
  const job = (o: Partial<DepositInvoice> & { id: string }) => inv({ jobId: VELORUM_PRECON, ...o });
  return {
    jobId: VELORUM_PRECON,
    leaves: [{ id: "leaf", name: "Contract Deposit", price: 20000 }],
    lines: [],
    payments: [
      {
        id: "22PYrQkLNwDQ",
        amount: 20000,
        paidAt: "2026-06-10T00:21:49.812Z",
        description: "Deposit for Pre Construction Services",
        source: "Check",
        qboId: "40745",
        applications: [
          app("a16", 2543.15, true, job({ id: "i16", number: 16, issueDate: "2026-06-12", priceWithTax: 2543.15, amountPaid: 2543.15 })),
          app("a38", 10872.9, false, job({ id: "i38", number: 38, issueDate: "2026-06-30", priceWithTax: 10872.9, amountPaid: 10872.9 })),
          app("a42", 6583.95, false, job({ id: "i42", number: 42, name: "Monthly Statement", issueDate: "2026-07-31", priceWithTax: 6583.95, amountPaid: 6583.95 })),
        ],
      },
      // The Service job's QuickBooks payments: not deposits, never counted.
      qboPayment("svc6", 10310.19, [app("s6", 10310.19, true, inv({ id: "i6", number: 6, jobId: "22PaXuiFuCuy" }))]),
    ],
    accountOpenJobIds: ["22PY5mDzPaFK", VELORUM_PRECON, "22PaXuiFuCuy"],
    links: links(),
  };
};

const BEACH_SHACK_PRECON = "22PXbuYW5YRe";
const ruhmannWarren = (): DepositInputs => {
  const job = (o: Partial<DepositInvoice> & { id: string }) => inv({ jobId: BEACH_SHACK_PRECON, ...o });
  return {
    jobId: BEACH_SHACK_PRECON,
    leaves: [{ id: "leaf", name: "Contract Deposit", price: 0 }],
    lines: [],
    payments: [
      {
        id: "22PYuQdCX4AY",
        amount: 20000,
        paidAt: "2026-05-27T22:18:28.740Z",
        description: "PreConstruction Retainer",
        source: "Check",
        qboId: "40743",
        applications: [
          app("a22", 1061.18, true, job({ id: "i22", number: 22, issueDate: "2026-06-12" })),
          app("a27", 4615.23, false, job({ id: "i27", number: 27, issueDate: "2026-06-30" })),
          app("a38", 1863.46, false, job({ id: "i38", number: 38, issueDate: "2026-08-12" })),
          app("a39", 2074.41, false, job({ id: "i39", number: 39, name: "Monthly Statement", issueDate: "2026-09-11" })),
        ],
      },
    ],
    accountOpenJobIds: [BEACH_SHACK_PRECON],
    links: links(),
  };
};

const PATIO_REPAIR = "22PdguyBXLD5";
const thomas = (): DepositInputs => {
  const deposit22 = inv({ id: "i22", number: 22, name: "Deposit", issueDate: "2026-09-02", priceWithTax: 17000, amountPaid: 17000, jobId: PATIO_REPAIR });
  return {
    jobId: PATIO_REPAIR,
    leaves: [{ id: "leaf", name: "Deposit", price: 32159.37 }],
    lines: [
      { id: "l22", price: 17000, isTaxable: false, invoice: deposit22 },
      // The first attempt, voided.
      { id: "l17", price: 17000, isTaxable: false, invoice: inv({ id: "i17", number: 17, name: "Deposit", status: "denied", issueDate: "2026-09-02", jobId: PATIO_REPAIR }) },
    ],
    // The payment that paid #22 has no description: it is the deposit
    // invoice's payment, already counted through the invoice.
    payments: [
      { id: "p17000", amount: 17000, paidAt: "2026-09-14T21:21:21.335Z", description: null, source: null, qboId: "44491", applications: [app("a22", 17000, true, deposit22)] },
    ],
    accountOpenJobIds: [PATIO_REPAIR],
    links: links(),
  };
};

const BUNKHOUSE = "22PXGG97EiV4";
const MAIN_HOUSE = "22PaFQzY2UNw";
const BERGER_DEPOSIT = "22PawiXG2b5N";
const berger = (l: Partial<DepositLinks> = {}): DepositInputs => {
  const i320 = inv({ id: "i320", number: 320, issueDate: "2026-08-31", priceWithTax: 106750.68, amountPaid: 106750.68, jobId: BUNKHOUSE });
  return {
    jobId: BUNKHOUSE,
    leaves: [{ id: "leaf", name: "Deposit", price: 0 }],
    lines: [{ id: "l320", price: -20000, isTaxable: false, invoice: i320 }],
    payments: [
      { id: BERGER_DEPOSIT, amount: 128842, paidAt: "2026-01-01T20:10:09.461Z", description: "Deposit", source: "Check", qboId: null, applications: [] },
      qboPayment("p100k", 100000, [app("a320", 100000, true, i320)]),
      qboPayment("p19607", 19607.86, [app("a5", 17459.93, true, inv({ id: "i5", number: 5, jobId: MAIN_HOUSE }))]),
    ],
    accountOpenJobIds: [BUNKHOUSE, MAIN_HOUSE],
    links: links(l),
  };
};

const OTIS_PERKINS = "22PXejdnU4hm";
const ferron = (l: Partial<DepositLinks> = {}): DepositInputs => ({
  jobId: OTIS_PERKINS,
  leaves: [
    { id: "leafA", name: "Contract Deposit", price: 123000 },
    { id: "leafB", name: "Deposit", price: 0 },
  ],
  lines: [
    { id: "l386", price: -20000, isTaxable: false, invoice: inv({ id: "i386", number: 386, issueDate: "2026-08-31", priceWithTax: 149529.72, amountPaid: 149529.72, jobId: OTIS_PERKINS }) },
    { id: "l385", price: -20000, isTaxable: false, invoice: inv({ id: "i385", number: 385, status: "denied", issueDate: "2026-09-11", jobId: OTIS_PERKINS }) },
  ],
  payments: [qboPayment("p51913", 51913.49, [])],
  accountOpenJobIds: [OTIS_PERKINS],
  links: links(l),
});

const STUDIO = "22PfLYbZq4Jt";
const studio = (): DepositInputs => ({
  jobId: STUDIO,
  leaves: [{ id: "leaf", name: "Deposit", price: 0 }],
  lines: [
    { id: "l8", price: 270975, isTaxable: true, invoice: inv({ id: "i8", number: 8, name: "Deposit", status: "pending", issueDate: "2026-10-01", priceWithTax: 270975, amountPaid: 0, jobId: STUDIO }) },
  ],
  payments: [],
  accountOpenJobIds: [STUDIO],
  links: links(),
});

// ── tests ────────────────────────────────────────────────────────────────────

describe("buildDepositLedger — the six jobs as they stood on 2026-10-05", () => {
  it("Velorum: a deposit payment applied to whole invoices until it ran out", () => {
    const l = buildDepositLedger(velorum());
    expect(l).toMatchObject({ agreed: 20000, received: 20000, drawn: 20000, left: 0, hasDeposit: true });
    expect(l.entries.map((e) => [e.kind, e.invoiceNumber ?? null, e.amount])).toEqual([
      ["received", null, 20000],
      ["drawn", 16, 2543.15],
      ["drawn", 38, 10872.9],
      ["drawn", 42, 6583.95],
    ]);
    // JobTread never linked the later two applications to QuickBooks.
    expect(l.flags).toEqual([
      { kind: "unlinked-application", invoiceNumber: 38, amount: 10872.9 },
      { kind: "unlinked-application", invoiceNumber: 42, amount: 6583.95 },
    ]);
  });

  it("Ruhmann-Warren: a retainer drawn in parts, money still left", () => {
    const l = buildDepositLedger(ruhmannWarren());
    expect(l).toMatchObject({ received: 20000, drawn: 9614.28, left: 10385.72 });
    expect(l.flags.filter((f) => f.kind === "unlinked-application")).toHaveLength(3);
  });

  it("Thomas: a paid deposit invoice is the receipt; its payment is not counted twice", () => {
    const l = buildDepositLedger(thomas());
    expect(l).toMatchObject({ agreed: 32159.37, received: 17000, billedUnpaid: 0, drawn: 0, left: 17000, flags: [] });
    // The voided first attempt (#17) drops out.
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]).toMatchObject({ kind: "received", method: "invoice", invoiceNumber: 22 });
  });

  it("Berger: the deposit payment has no job until the office picks one", () => {
    const l = buildDepositLedger(berger());
    expect(l.unassigned).toEqual([
      { id: BERGER_DEPOSIT, amount: 128842, paidAt: "2026-01-01T20:10:09.461Z", description: "Deposit" },
    ]);
    // Drawn with nothing recorded to draw from: the balance is unknown, not −$20,000.
    expect(l).toMatchObject({ received: 0, drawn: 20000, left: null });
    expect(l.flags).toContainEqual({ kind: "no-receipt", drawn: 20000 });
    expect(l.flags).toContainEqual({ kind: "unassigned-payment", paymentId: BERGER_DEPOSIT, amount: 128842 });
  });

  it("Berger, assigned to Bunkhouse: the payment is the receipt, the CD line the draw", () => {
    const l = buildDepositLedger(berger({ paymentIds: [BERGER_DEPOSIT] }));
    expect(l).toMatchObject({ received: 128842, drawn: 20000, left: 108842, unassigned: [], flags: [] });
  });

  it("Berger, assigned elsewhere: Main House's card counts nothing from it", () => {
    const l = buildDepositLedger({ ...berger({ elsewherePaymentIds: [BERGER_DEPOSIT] }) });
    expect(l).toMatchObject({ received: 0, unassigned: [] });
  });

  it("Berger, with an opening balance: entries on or before it are already covered", () => {
    const l = buildDepositLedger(
      berger({ paymentIds: [BERGER_DEPOSIT], opening: { amount: 100000, asOf: "2026-05-29" } }),
    );
    expect(l).toMatchObject({ opening: 100000, received: 0, drawn: 20000, left: 80000 });
    expect(l.entries.find((e) => e.paymentId === BERGER_DEPOSIT)?.beforeOpening).toBe(true);
  });

  it("Ferron: drawn on a JobTread invoice, received before JobTread", () => {
    const l = buildDepositLedger(ferron());
    expect(l).toMatchObject({ agreed: 123000, received: 0, drawn: 20000, left: null });
    expect(l.flags).toEqual([{ kind: "no-receipt", drawn: 20000 }]);
    // #385 is the voided duplicate of #386.
    expect(l.entries.map((e) => e.invoiceNumber)).toEqual([386]);
  });

  it("Ferron, with the opening balance entered: the balance is known", () => {
    const l = buildDepositLedger(ferron({ opening: { amount: 102473.87, asOf: "2026-05-29" } }));
    expect(l).toMatchObject({ left: 82473.87, flags: [] });
  });

  it("Studio: a deposit billed and not paid is not received, and its taxable line is flagged", () => {
    const l = buildDepositLedger(studio());
    expect(l).toMatchObject({ received: 0, billedUnpaid: 270975, drawn: 0, left: 0 });
    expect(l.flags).toEqual([{ kind: "taxable-line", invoiceNumber: 8 }]);
  });
});

describe("buildDepositLedger — rules beyond the six jobs", () => {
  it("drawing one deposit by CD line AND by payment application is flagged", () => {
    const input = berger({ paymentIds: [BERGER_DEPOSIT] });
    input.payments[0].applications = [
      app("x", 5000, true, inv({ id: "i400", number: 400, issueDate: "2026-09-30", jobId: BUNKHOUSE })),
    ];
    const l = buildDepositLedger(input);
    expect(l.drawn).toBe(25000);
    expect(l.flags).toContainEqual({ kind: "double-draw" });
  });

  it("a draw on a draft invoice is shown, not counted", () => {
    const input = thomas();
    input.lines.push({
      id: "lDraft",
      price: -4000,
      isTaxable: false,
      invoice: inv({ id: "iD", number: 30, status: "draft", issueDate: "2026-09-30", jobId: PATIO_REPAIR }),
    });
    const l = buildDepositLedger(input);
    expect(l).toMatchObject({ drawn: 0, onDraft: 4000, left: 17000 });
  });

  it("drawing more than was received is flagged with the excess", () => {
    const input = thomas();
    input.lines.push({
      id: "lBig",
      price: -18000.5,
      isTaxable: false,
      invoice: inv({ id: "iB", number: 31, issueDate: "2026-10-31", jobId: PATIO_REPAIR }),
    });
    const l = buildDepositLedger(input);
    expect(l.left).toBe(-1000.5);
    expect(l.flags).toContainEqual({ kind: "overdrawn", by: 1000.5 });
  });

  it("a half-paid deposit invoice is half received, half billed", () => {
    const input = studio();
    input.lines[0].invoice.amountPaid = 135487.5;
    const l = buildDepositLedger(input);
    expect(l).toMatchObject({ received: 135487.5, billedUnpaid: 135487.5 });
  });

  it("a job with only a $0 deposit leaf has no deposit, so the card hides", () => {
    const l = buildDepositLedger({
      jobId: "j",
      leaves: [{ id: "leaf", name: "Deposit", price: 0 }],
      lines: [],
      payments: [],
      accountOpenJobIds: ["j"],
      links: NO_LINKS,
    });
    expect(l.hasDeposit).toBe(false);
  });
});

describe("paymentOwner", () => {
  const p = (apps: CustomerPayment["applications"]): CustomerPayment => ({
    id: "p",
    amount: 1,
    paidAt: "2026-01-01",
    description: "Deposit",
    source: null,
    qboId: null,
    applications: apps,
  });

  it("follows the invoices it paid", () => {
    expect(paymentOwner(p([app("a", 1, true, inv({ id: "i", jobId: "A" }))]), "A", ["A", "B"], NO_LINKS)).toBe("mine");
    expect(paymentOwner(p([app("a", 1, true, inv({ id: "i", jobId: "A" }))]), "B", ["A", "B"], NO_LINKS)).toBe("other");
  });

  it("ignores invoices that were voided", () => {
    const voided = app("a", 1, true, inv({ id: "i", jobId: "A", status: "denied" }));
    expect(paymentOwner(p([voided]), "B", ["A", "B"], NO_LINKS)).toBe("unassigned");
  });

  it("falls back to the account's only open job", () => {
    expect(paymentOwner(p([]), "A", ["A"], NO_LINKS)).toBe("mine");
  });

  it("lets the office's assignment win over every rule", () => {
    const paid = p([app("a", 1, true, inv({ id: "i", jobId: "A" }))]);
    expect(paymentOwner(paid, "B", ["A", "B"], links({ paymentIds: ["p"] }))).toBe("mine");
    expect(paymentOwner(paid, "A", ["A", "B"], links({ elsewherePaymentIds: ["p"] }))).toBe("other");
  });
});
