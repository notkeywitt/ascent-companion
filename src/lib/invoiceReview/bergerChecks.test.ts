import { describe, expect, it } from "vitest";

import { taxLooksDoubled } from "@/lib/salesTax";
import { duplicateCrossJobCheck } from "./checks/duplicateCrossJob";
import { duplicateWideCheck, invoiceNumberStem } from "./checks/duplicateWide";
import { invoiceLinesCheck, reconcileCode, timeSourcesByDay } from "./checks/invoiceLines";
import { codesInText, lineCodeMismatchCheck } from "./checks/lineCodeMismatch";
import { taxDoubledCheck } from "./checks/taxDoubled";
import { DEFAULT_SETTINGS } from "./settings";
import type {
  BillRef,
  InvoiceEvidence,
  InvoiceLine,
  InvoiceTimeSource,
  JobEvidence,
  MonthEvidence,
} from "./types";

/**
 * The four checks built from Kevin Berger's invoice disputes, 2025-11 → 2026-10.
 * Every fixture below is a real figure from one of those emails.
 */

const S = DEFAULT_SETTINGS.checks;
const global = DEFAULT_SETTINGS.global;

function bill(over: Partial<BillRef> = {}): BillRef {
  return {
    id: "b1",
    label: "B1",
    vendor: "Home Depot",
    cost: 59.5,
    lineCount: 2,
    taxAmount: 4.26,
    untaxedLineCount: 0,
    untaxedCost: 0,
    status: "approved",
    invoiced: true,
    invoiceIds: ["inv1"],
    sentInvoiceIds: ["inv1"],
    issueDate: "2026-07-20",
    qboIsIgnored: false,
    ...over,
  };
}

function line(over: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: "l1",
    name: "Line",
    description: "",
    code: "06 10 20",
    codeName: "",
    cost: 100,
    unitCost: 100,
    quantity: 1,
    unitPrice: 118,
    price: 118,
    isTaxable: true,
    ...over,
  };
}

function invoice(lines: InvoiceLine[], over: Partial<InvoiceEvidence> = {}): InvoiceEvidence {
  return {
    id: "inv1",
    number: "379",
    name: "",
    status: "pending",
    issueDate: "2026-10-14",
    dueDate: "",
    cost: 0,
    price: 0,
    priceWithTax: 0,
    tax: 0,
    taxRate: 0.0835,
    amountPaid: 0,
    balance: 0,
    lines,
    billIds: [],
    jtUrl: "https://app.jobtread.com/x",
    billSources: [],
    timeSources: [],
    ...over,
  };
}

function job(over: Partial<JobEvidence> = {}): JobEvidence {
  return {
    jobId: "J1",
    jobName: "Bunkhouse",
    customerName: "Kevin Berger",
    neverInvoiced: false,
    invoices: [],
    bills: [],
    folder: null,
    uninvoicedBillsCost: 0,
    uninvoicedTimeCost: 0,
    draftBillsCost: 0,
    draftBillCount: 0,
    draftBills: [],
    labor: [],
    ...over,
  };
}

const month = {
  ym: "2026-09",
  year: 2026,
  month: 9,
  monthLabel: "September 2026",
  folderRoot: "/x/",
  jobs: [],
  laborRates: null,
  emailChecked: false,
  emails: [],
  mailWindow: null,
  mailTruncated: false,
  warnings: [],
} satisfies MonthEvidence;

describe("taxLooksDoubled", () => {
  it("reads Kevin's two July bills as tax counted twice", () => {
    // Home Depot: receipt $50.98 + $4.26 = $55.24; JobTread held $59.50.
    expect(taxLooksDoubled(55.24, 4.26, [0.0835])).toEqual({ doubled: true, rate: 0.0835, pretax: 50.98 });
    // Fasteners Plus #411501: $414.99 + $34.65 = $449.64; JobTread held $484.29.
    expect(taxLooksDoubled(449.64, 34.65, [0.0835]).doubled).toBe(true);
  });

  it("passes the same bills entered correctly", () => {
    expect(taxLooksDoubled(50.98, 4.26, [0.0835]).doubled).toBe(false);
    expect(taxLooksDoubled(414.99, 34.65, [0.0835]).doubled).toBe(false);
    // Fasteners Plus #422497, which Kevin asked about and was right: 159.98 + 29.06 shipping.
    expect(taxLooksDoubled(189.04, 15.79, [0.0835]).doubled).toBe(false);
  });

  it("says nothing when the rate is unknown or the tax is pennies", () => {
    expect(taxLooksDoubled(55.24, 4.26, [0.101]).doubled).toBe(false);
    expect(taxLooksDoubled(6.5, 0.5, [0.0835]).doubled).toBe(false);
  });
});

describe("taxDoubledCheck", () => {
  const run = (j: JobEvidence) =>
    taxDoubledCheck.run({ job: j, month, config: S["tax-doubled"].config, global });

  it("flags the Home Depot bill and asks for a credit once it has been sent", () => {
    const out = run(job({ bills: [bill()] }));
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("error");
    expect(out[0].amount).toBe(4.26);
    expect(out[0].detail).toContain("$50.98");
    expect(out[0].detail).toContain("credit the client");
  });

  it("reads drafts too, and a clean bill stays quiet", () => {
    const draft = bill({ id: "d1", status: "draft", sentInvoiceIds: [], cost: 484.29, taxAmount: 34.65 });
    const clean = bill({ id: "c1", cost: 55.24, taxAmount: 4.26 });
    const out = run(job({ bills: [clean], draftBills: [draft] }));
    expect(out.map((f) => f.target)).toEqual([{ kind: "bill", billId: "d1" }]);
  });
});

describe("invoiceNumberStem", () => {
  it("matches a revised invoice to its original", () => {
    expect(invoiceNumberStem("NS1866")).toBe("NS1866");
    expect(invoiceNumberStem("NS1866-R")).toBe("NS1866");
    expect(invoiceNumberStem("ns 1866 rev")).toBe("NS1866");
  });
  it("ignores the capture's random id and numbers too short to mean anything", () => {
    expect(invoiceNumberStem("INV-8e06f037")).toBe("");
    expect(invoiceNumberStem("12")).toBe("");
    expect(invoiceNumberStem(undefined)).toBe("");
  });
});

describe("duplicateWideCheck", () => {
  const run = (j: JobEvidence) =>
    duplicateWideCheck.run({ job: j, month, config: S["duplicate-wide"].config, global });

  it("catches NS1866 entered again as NS1866-R", () => {
    const orig = bill({ id: "a", vendor: "Naturally Sustained", label: "NS1866", externalId: "NS1866", cost: 372, issueDate: "2026-07-31", taxAmount: 0 });
    const rev = bill({ id: "b", vendor: "Naturally Sustained", label: "NS1866-R", externalId: "NS1866-R", cost: 436.8, issueDate: "2026-07-31", taxAmount: 0 });
    const out = run(job({ bills: [orig, rev] }));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("bill-duplicate-number");
    expect(out[0].severity).toBe("error");
  });

  it("catches Dirt Doctors #1289 billed in one month and again the next", () => {
    const oct = bill({ id: "a", vendor: "Dirt Doctors", cost: 11162.8, issueDate: "2025-10-08", taxAmount: 0, externalId: "INV-1a2b3c4d" });
    const nov = bill({ id: "b", vendor: "Dirt Doctors", cost: 11162.8, issueDate: "2025-11-05", taxAmount: 0, externalId: "INV-5e6f7a8b" });
    const out = run(job({ bills: [nov], priorBills: [oct] }));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("bill-duplicate-amount");
    expect(out[0].severity).toBe("warning");
    expect(out[0].detail).toContain("credit the duplicate");
  });

  it("reports a pair once, leaves duplicate-draft's pairs to it, and skips credits", () => {
    const a = bill({ id: "a", vendor: "ICW", cost: 4163.75, issueDate: "2026-08-31" });
    const b = bill({ id: "b", vendor: "ICW", cost: 4163.75, issueDate: "2026-08-31", status: "draft" });
    const credit = bill({ id: "c", vendor: "ICW", cost: -4163.75, issueDate: "2026-08-31" });
    expect(run(job({ bills: [a, credit], draftBills: [b] }))).toHaveLength(0);
  });

  it("leaves Starr Sanitation's $300 a month alone — two numbers are two invoices", () => {
    const may = bill({ id: "a", vendor: "Starr Sanitation", cost: 300, issueDate: "2026-07-31", externalId: "J654466", taxAmount: 0 });
    const jun = bill({ id: "b", vendor: "Starr Sanitation", cost: 300, issueDate: "2026-08-31", externalId: "J661020", taxAmount: 0 });
    expect(run(job({ bills: [jun], priorBills: [may] }))).toHaveLength(0);
  });

  it("catches Sunset's -$145.91 credit captured twice", () => {
    const memo = bill({ id: "a", vendor: "Sunset Builders Supply", cost: -145.91, issueDate: "2026-10-01", status: "draft", externalId: "INV-1a2b3c4d", taxAmount: 0 });
    const itemized = bill({ id: "b", vendor: "Sunset Builders Supply", cost: -145.91, issueDate: "2026-10-02", status: "draft", externalId: "INV-5e6f7a8b", taxAmount: 0 });
    const out = run(job({ draftBills: [memo, itemized] }));
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("-$145.91");
    expect(out[0].amount).toBe(145.91);
  });

  it("stays quiet on two equal charges further apart than the window", () => {
    const a = bill({ id: "a", vendor: "Cascade Roofing", cost: 13841.5, issueDate: "2026-03-31", taxAmount: 0 });
    const b = bill({ id: "b", vendor: "Cascade Roofing", cost: 13841.5, issueDate: "2026-05-29", taxAmount: 0 });
    expect(run(job({ bills: [b], priorBills: [a] }))).toHaveLength(0);
  });
});

describe("invoiceLinesCheck", () => {
  const time = (over: Partial<InvoiceTimeSource>): InvoiceTimeSource => ({
    id: "t1",
    employee: "Ty",
    payType: "Principal",
    hours: 4,
    cost: 420,
    code: "01 31 00",
    day: "2026-09-10",
    ...over,
  });
  const run = (inv: InvoiceEvidence, j: Partial<JobEvidence> = {}, m: MonthEvidence = month) =>
    invoiceLinesCheck.run({ job: job(j), month: m, invoice: inv, config: S["invoice-lines"].config, global });

  it("is quiet when every line has its bill line or time entry", () => {
    const inv = invoice(
      [line({ code: "01 31 30", cost: 7.59 }), line({ id: "l2", code: "01 31 00", cost: 420 })],
      { billSources: [{ kind: "bill", sourceId: "b1", code: "01 31 30", costs: [7.59] }], timeSources: [time({})] },
    );
    expect(run(inv)).toEqual([]);
  });

  it("finds the January $63.36 nobody could explain", () => {
    const inv = invoice(
      [line({ code: "06 10 10", cost: 63.36, name: "Framing Material" }), line({ id: "l2", code: "06 10 10", cost: 40.44 })],
      { billSources: [{ kind: "bill", sourceId: "b1", code: "06 10 10", costs: [40.44] }] },
    );
    const out = run(inv);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("invoice-line-unsourced");
    expect(out[0].amount).toBe(63.36);
    expect(out[0].detail).toContain("Framing Material");
  });

  it("finds a hand-typed negative line as SHORT on its code", () => {
    const inv = invoice(
      [line({ code: "12 30 00", cost: 4163.75 }), line({ id: "l2", code: "12 30 00", cost: -3572.27, name: "" })],
      { billSources: [{ kind: "bill", sourceId: "b1", code: "12 30 00", costs: [4163.75] }] },
    );
    const out = run(inv);
    expect(out.map((f) => f.kind)).toEqual(["invoice-line-short"]);
    expect(out[0].amount).toBe(3572.27);
  });

  it("reports a priced line with no cost — the $1,500 '00 00 00'", () => {
    const inv = invoice([line({ code: "09 65 19", cost: 0, price: 1500, name: "00 00 00" })]);
    const out = run(inv);
    expect(out.map((f) => f.kind)).toEqual(["invoice-line-no-cost"]);
  });

  it("merges a code's time per day the way JobTread bills it — #379, 01 31 10 on 9/16", () => {
    const inv = invoice([line({ code: "01 31 10", cost: 850 })], {
      timeSources: [
        time({ id: "s", employee: "Seth", code: "01 31 10", day: "2026-09-16", hours: 7.5, cost: 637.5 }),
        time({ id: "t", employee: "Ty", code: "01 31 10", day: "2026-09-16", hours: 2.5, cost: 212.5 }),
      ],
    });
    expect(run(inv)).toEqual([]);
  });

  it("leaves deposits alone and says nothing when bill lines could not be read", () => {
    const inv = invoice([line({ code: "CD", cost: -20000, price: -20000 }), line({ id: "l2", cost: 999 })], {
      billSources: undefined,
    });
    expect(run(inv)).toEqual([]);
  });

  it("matches time priced at today's rate, from any month", () => {
    const m = { ...month, laborRates: new Map([["Ty", new Map([["Principal", 115]])]]) };
    const inv = invoice([line({ code: "01 31 00", cost: 460 }), line({ id: "l2", code: "01 31 00", cost: 920 })], {
      timeSources: [time({}), time({ id: "t2", hours: 8, cost: 840, day: "2026-08-29" })],
    });
    expect(run(inv, {}, m)).toEqual([]);
  });

  it("timeSourcesByDay offers today's rate only when every entry has one", () => {
    const rates = new Map([["Ty", new Map([["Principal", 115]])]]);
    const [g] = timeSourcesByDay([time({}), time({ id: "x", employee: "Seth" })], rates);
    expect(g.costs).toEqual([840]);
  });

  it("collapses a rebuilt invoice into one finding", () => {
    const codes = ["06 10 10", "06 10 20", "07 46 23", "09 91 13", "12 30 00"];
    const inv = invoice(codes.map((code, i) => line({ id: `l${i}`, code, cost: 100 })));
    const out = run(inv);
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("5 cost codes");
  });

  it("reconcileCode lets one consolidated line stand for several entries", () => {
    const r = reconcileCode(
      [line({ cost: 1260 })],
      [
        { kind: "time", sourceId: "a", code: "x", costs: [420] },
        { kind: "time", sourceId: "b", code: "x", costs: [840] },
      ],
      0.01,
    );
    expect(r.gap).toBe(0);
  });
});

describe("duplicateCrossJobCheck", () => {
  it("finds Sunset's -$83.03 credit booked on both Berger jobs", () => {
    const bunk = job({ bills: [bill({ id: "a", vendor: "Sunset Builders Supply", cost: -83.03, issueDate: "2026-07-09", externalId: "690843", taxAmount: 0 })] });
    const main = job({
      jobId: "J2",
      jobName: "Main House",
      bills: [bill({ id: "b", vendor: "Sunset Builders Supply", cost: -83.03, issueDate: "2026-07-09", externalId: "", taxAmount: 0 })],
    });
    const out = duplicateCrossJobCheck.run({
      month: { ...month, jobs: [bunk, main] },
      config: S["duplicate-cross-job"].config,
      global,
    });
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("credit on two jobs");
  });

  it("leaves two different Sunset tickets for the same figure alone", () => {
    const a = job({ bills: [bill({ id: "a", vendor: "Sunset Builders Supply", cost: 40.44, externalId: "661496" })] });
    const b = job({ jobId: "J2", bills: [bill({ id: "b", vendor: "Sunset Builders Supply", cost: 40.44, externalId: "661500" })] });
    expect(
      duplicateCrossJobCheck.run({ month: { ...month, jobs: [a, b] }, config: S["duplicate-cross-job"].config, global }),
    ).toEqual([]);
  });
});

describe("lineCodeMismatchCheck", () => {
  const run = (inv: InvoiceEvidence) =>
    lineCodeMismatchCheck.run({ job: job(), month, invoice: inv, config: {}, global });

  it("reads the codes written in a line's text", () => {
    expect(codesInText("Shipping 01 71 23")).toEqual(["01 71 23"]);
    expect(codesInText("07 21 00S - Insulation Material")).toEqual(["07 21 00"]);
    expect(codesInText("Dump 2026-07-20 — Berger (ref 1784579802)")).toEqual([]);
    expect(codesInText("D | 206 819 2830")).toEqual([]);
  });

  it("groups the stale-code lines on #002-379 and ignores lines that agree", () => {
    const inv = invoice([
      line({ name: "Trustile Slabs", description: "08 10 20 - Exterior Doors", code: "08 10 30", price: 1729 }),
      line({ id: "l2", name: "Delivery 01 71 23", code: "08 10 30", price: 750 }),
      line({ id: "l3", name: "01 31 30 Consumables", description: "01 31 30 - Consumables", code: "01 31 30" }),
      line({ id: "l4", name: "Insulation", description: "07 21 00S", code: "07 21 00S" }),
    ]);
    const out = run(inv);
    expect(out.map((f) => f.title).sort()).toEqual([
      "Invoice #379 — 1 line says 01 71 23, billed under 08 10 30",
      "Invoice #379 — 1 line says 08 10 20, billed under 08 10 30",
    ]);
  });

  it("calls out the placeholder 00 00 00", () => {
    const out = run(invoice([line({ name: "00 00 00", code: "09 65 19", price: 1500 })]));
    expect(out[0].title).toContain('"00 00 00"');
  });
});
