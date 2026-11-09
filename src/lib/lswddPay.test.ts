import { describe, expect, it } from "vitest";
import {
  lswddApprovalTarget,
  lswddDayLabel,
  lswddDefaultDue,
  lswddLastPayDay,
  lswddPayReminder,
  lswddPayState,
  lswddReminderStart,
  lswddStatementOf,
} from "./lswddPay";

describe("lswddLastPayDay — LSWDD is open Friday to Monday", () => {
  it("keeps a due date that falls on an open day", () => {
    expect(lswddLastPayDay("2027-01-10")).toBe("2027-01-10"); // Sunday
    expect(lswddLastPayDay("2026-07-10")).toBe("2026-07-10"); // Friday
    expect(lswddLastPayDay("2026-08-10")).toBe("2026-08-10"); // Monday
  });
  it("moves a closed-day due date back to the Monday before", () => {
    expect(lswddLastPayDay("2026-11-10")).toBe("2026-11-09"); // Tue → Mon
    expect(lswddLastPayDay("2026-06-10")).toBe("2026-06-08"); // Wed → Mon
    expect(lswddLastPayDay("2026-09-10")).toBe("2026-09-07"); // Thu → Mon
  });
});

describe("lswddReminderStart", () => {
  it("is the day before the last day to pay", () => {
    expect(lswddReminderStart("2026-11-10")).toBe("2026-11-08");
    expect(lswddReminderStart("2026-07-10")).toBe("2026-07-09"); // Fri deadline → Thu
  });
});

describe("lswddPayReminder", () => {
  const due = "2026-11-10"; // last pay day Mon 11-09
  it("is quiet before the day before the deadline", () => {
    expect(lswddPayReminder({ today: "2026-11-07", dueDate: due, unpaid: 2 })).toBeNull();
  });
  it("shows from the day before the deadline", () => {
    expect(lswddPayReminder({ today: "2026-11-08", dueDate: due, unpaid: 2 })).toEqual({
      lastPayDay: "2026-11-09",
      overdue: false,
    });
  });
  it("keeps showing, as overdue, after the deadline", () => {
    expect(lswddPayReminder({ today: "2026-11-12", dueDate: due, unpaid: 1 })?.overdue).toBe(true);
  });
  it("is quiet once every bill is paid", () => {
    expect(lswddPayReminder({ today: "2026-11-08", dueDate: due, unpaid: 0 })).toBeNull();
  });
});

describe("lswddPayState", () => {
  it("maps JobTread status to draft / approved / paid / void", () => {
    expect(lswddPayState({ status: "draft", cost: 10, amountPaid: 0 })).toBe("draft");
    expect(lswddPayState({ status: "pending", cost: 10, amountPaid: 0 })).toBe("approved");
    expect(lswddPayState({ status: "pending", cost: 10, amountPaid: 10 })).toBe("paid");
    expect(lswddPayState({ status: "approved", cost: 10, amountPaid: 10 })).toBe("paid");
    expect(lswddPayState({ status: "denied", cost: 10, amountPaid: 0 })).toBe("void");
  });
});

describe("statement helpers", () => {
  it("reads the statement date off the externalId", () => {
    expect(lswddStatementOf("LSWDD-2026-11-01-PROJ_007")).toBe("2026-11-01");
    expect(lswddStatementOf("LSWDD-2026-11-01-22PZKLxzUkZG")).toBe("2026-11-01");
    expect(lswddStatementOf("133-a")).toBe("");
    expect(lswddStatementOf(null)).toBe("");
  });
  it("defaults the due date to the 10th", () => {
    expect(lswddDefaultDue("2026-11-01")).toBe("2026-11-10");
  });
  it("approves a Bill to pending and an Expense to approved", () => {
    expect(lswddApprovalTarget({ name: "Bill", qboDocumentType: "bill" })).toBe("pending");
    expect(lswddApprovalTarget({ name: "Expense", qboDocumentType: "purchase" })).toBe("approved");
  });
  it("labels a day", () => {
    expect(lswddDayLabel("2026-11-09")).toBe("Mon, Nov 9");
  });
});
