/**
 * AR AGEING — the buckets, and above all their BOUNDARIES.
 *
 * Every failure in this module is silent. An invoice in the wrong bucket still
 * shows a correct balance, so the page looks right while the collection call
 * goes to the wrong client. The boundaries and the choice of ageing date are
 * therefore pinned exactly, not approximately.
 */
import { describe, expect, it } from "vitest";
import {
  ageInvoice,
  BALANCE_FLOOR,
  bucketFor,
  buildArAging,
  daysBetween,
  type ArInvoice,
} from "./arAging";

function inv(over: Partial<ArInvoice> & { id: string }): ArInvoice {
  return {
    number: "1041",
    status: "approved",
    jobId: "J1",
    jobName: "Main House",
    customerName: "Kevin Berger",
    issueDate: "2026-07-31",
    dueDate: "",
    total: 10000,
    amountPaid: 0,
    balance: 10000,
    jtUrl: "https://app.jobtread.com/x",
    ...over,
  };
}

const TODAY = "2026-09-03";

describe("daysBetween", () => {
  it("counts whole calendar days", () => {
    expect(daysBetween("2026-09-01", "2026-09-03")).toBe(2);
    expect(daysBetween("2026-09-03", "2026-09-03")).toBe(0);
  });

  it("is negative before the date", () => {
    expect(daysBetween("2026-09-10", "2026-09-03")).toBe(-7);
  });

  it("crosses a month and a leap year without drifting", () => {
    expect(daysBetween("2026-08-31", "2026-09-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("ignores a time component rather than being moved by it", () => {
    // The rows carry "YYYY-MM-DD", but a timestamp must not shift the answer —
    // an invoice is due ON a day, not at an instant.
    expect(daysBetween("2026-09-01T23:30:00Z", "2026-09-03T00:10:00Z")).toBe(2);
  });

  it("returns null for an unparseable date instead of ageing from the epoch", () => {
    expect(daysBetween("", TODAY)).toBeNull();
    expect(daysBetween("not-a-date", TODAY)).toBeNull();
  });
});

describe("bucketFor — the boundaries", () => {
  it("puts anything not yet past its date in current", () => {
    expect(bucketFor(-1)).toBe("current");
    expect(bucketFor(0)).toBe("current");
  });

  it("moves to 1–30 on the first day late", () => {
    expect(bucketFor(1)).toBe("d1_30");
    expect(bucketFor(30)).toBe("d1_30");
  });

  it("holds each boundary exactly", () => {
    expect(bucketFor(31)).toBe("d31_60");
    expect(bucketFor(60)).toBe("d31_60");
    expect(bucketFor(61)).toBe("d61_90");
    expect(bucketFor(90)).toBe("d61_90");
    expect(bucketFor(91)).toBe("d90_plus");
    expect(bucketFor(4000)).toBe("d90_plus");
  });
});

describe("ageInvoice — which date it ages from", () => {
  it("ages from the DUE date when there is one", () => {
    // Ageing a net-30 invoice from its issue date reports it 30 days late the
    // moment it is sent, which makes every invoice look overdue.
    const aged = ageInvoice(
      inv({ id: "i1", issueDate: "2026-07-31", dueDate: "2026-08-30" }),
      TODAY,
    );
    expect(aged?.basis).toBe("due");
    expect(aged?.basisDate).toBe("2026-08-30");
    expect(aged?.daysOverdue).toBe(4);
  });

  it("falls back to the ISSUE date when there is no due date", () => {
    // Inventing a term for an invoice that has none would be a made-up figure
    // in a money report.
    const aged = ageInvoice(inv({ id: "i1", issueDate: "2026-07-31", dueDate: "" }), TODAY);
    expect(aged?.basis).toBe("issue");
    expect(aged?.daysOverdue).toBe(34);
    expect(aged?.bucket).toBe("d31_60");
  });

  it("does not pick whichever date is later", () => {
    // A due date BEFORE the issue date is a data-entry error, not a licence to
    // silently choose the friendlier number.
    const aged = ageInvoice(
      inv({ id: "i1", issueDate: "2026-08-31", dueDate: "2026-07-01" }),
      TODAY,
    );
    expect(aged?.basis).toBe("due");
    expect(aged?.basisDate).toBe("2026-07-01");
  });

  it("returns null when there is no usable date at all", () => {
    expect(ageInvoice(inv({ id: "i1", issueDate: "", dueDate: "" }), TODAY)).toBeNull();
  });
});

describe("buildArAging", () => {
  it("drops a rounding-sized balance", () => {
    // A cent between JobTread and QuickBooks is not a receivable.
    const s = buildArAging([inv({ id: "i1", balance: 0.01 })], TODAY);
    expect(s.invoiceCount).toBe(0);
    expect(s.totalOutstanding).toBe(0);
    expect(BALANCE_FLOOR).toBeGreaterThan(0.01);
  });

  it("keeps a fully paid invoice out", () => {
    const s = buildArAging([inv({ id: "i1", balance: 0, amountPaid: 10000 })], TODAY);
    expect(s.invoiceCount).toBe(0);
  });

  it("keeps a part-paid invoice, at its remaining balance", () => {
    const s = buildArAging([inv({ id: "i1", total: 10000, amountPaid: 4000, balance: 6000 })], TODAY);
    expect(s.totalOutstanding).toBe(6000);
  });

  it("separates outstanding from overdue", () => {
    // An invoice sent this morning is outstanding and is not a problem. Rolling
    // the two figures together is what makes an AR report ignorable.
    const s = buildArAging(
      [
        inv({ id: "future", dueDate: "2026-10-01", balance: 5000 }),
        inv({ id: "late", dueDate: "2026-08-01", balance: 3000 }),
      ],
      TODAY,
    );
    expect(s.totalOutstanding).toBe(8000);
    expect(s.totalOverdue).toBe(3000);
  });

  it("sorts oldest first, because the top of the list is today's phone call", () => {
    const s = buildArAging(
      [
        inv({ id: "mid", dueDate: "2026-08-20" }),
        inv({ id: "oldest", dueDate: "2026-04-01" }),
        inv({ id: "newest", dueDate: "2026-09-01" }),
      ],
      TODAY,
    );
    expect(s.invoices.map((i) => i.id)).toEqual(["oldest", "mid", "newest"]);
  });

  it("totals each bucket", () => {
    const s = buildArAging(
      [
        inv({ id: "a", dueDate: "2026-09-01", balance: 100 }), // 2 days
        inv({ id: "b", dueDate: "2026-08-25", balance: 200 }), // 9 days
        inv({ id: "c", dueDate: "2026-05-01", balance: 400 }), // 125 days
      ],
      TODAY,
    );
    const byId = Object.fromEntries(s.buckets.map((b) => [b.id, b]));
    expect(byId.d1_30.count).toBe(2);
    expect(byId.d1_30.amount).toBe(300);
    expect(byId.d90_plus.amount).toBe(400);
    expect(byId.d31_60.count).toBe(0);
  });

  it("rolls up per customer and reports their WORST invoice", () => {
    // A customer's total says how much; the worst age says how urgent. An
    // average would hide a two-year-old invoice behind five recent ones.
    const s = buildArAging(
      [
        inv({ id: "a", customerName: "Ferron", dueDate: "2026-09-01", balance: 100 }),
        inv({ id: "b", customerName: "Ferron", dueDate: "2026-01-01", balance: 900 }),
        inv({ id: "c", customerName: "Kevin Berger", dueDate: "2026-08-30", balance: 500 }),
      ],
      TODAY,
    );
    const ferron = s.customers.find((c) => c.customerName === "Ferron")!;
    expect(ferron.amount).toBe(1000);
    expect(ferron.count).toBe(2);
    expect(ferron.worstDaysOverdue).toBe(245);
    // Worst-first, so Ferron leads despite Berger also being late.
    expect(s.customers[0].customerName).toBe("Ferron");
  });

  it("gives an invoice with no customer its own row rather than merging it", () => {
    const s = buildArAging(
      [
        inv({ id: "a", customerName: "", balance: 100 }),
        inv({ id: "b", customerName: "Ferron", balance: 200 }),
      ],
      TODAY,
    );
    expect(s.customers.map((c) => c.customerName).sort()).toEqual(["(no customer)", "Ferron"]);
  });

  it("counts an un-ageable invoice as outstanding but NEVER as overdue", () => {
    // The money is owed whether or not it can be aged. Calling it overdue would
    // be a claim the dates do not support.
    const s = buildArAging(
      [inv({ id: "nodate", issueDate: "", dueDate: "", balance: 700 })],
      TODAY,
    );
    expect(s.unageable).toHaveLength(1);
    expect(s.totalOutstanding).toBe(700);
    expect(s.totalOverdue).toBe(0);
    expect(s.invoices).toHaveLength(0);
    expect(s.invoiceCount).toBe(1);
  });

  it("keeps its own money arithmetic to the cent", () => {
    const s = buildArAging(
      [
        inv({ id: "a", customerName: "Ferron", balance: 0.7 }),
        inv({ id: "b", customerName: "Ferron", balance: 0.7 }),
      ],
      TODAY,
    );
    expect(s.totalOutstanding).toBe(1.4);
    expect(s.customers[0].amount).toBe(1.4);
  });

  it("records the date it was computed as at", () => {
    expect(buildArAging([], TODAY).asOf).toBe(TODAY);
  });
});
