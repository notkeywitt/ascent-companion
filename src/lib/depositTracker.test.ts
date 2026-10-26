import { describe, expect, it } from "vitest";
import {
  checkPhotoName,
  composeDepositEmail,
  paymentDescription,
  paymentExternalId,
  planDepositPayments,
  type InvoiceForPayment,
} from "./depositTracker";

const inv = (id: string, over: Partial<InvoiceForPayment> = {}): InvoiceForPayment => ({
  id,
  number: id.replace(/\D/g, "") || "1",
  type: "customerInvoice",
  status: "pending",
  balance: 1000,
  jobId: "job1",
  jobName: "Studio",
  jobNumber: "34",
  customerName: "Genna Gormley",
  accountId: "acct1",
  ...over,
});

describe("planDepositPayments", () => {
  it("makes one payment per customer account, totalled to the cent", () => {
    const invoices = {
      i15: inv("i15", { balance: 15607.87 }),
      i55: inv("i55", { balance: 351.64, jobName: "Pottery Barn" }),
      i9: inv("i9", { accountId: "acct2", customerName: "Berger", balance: 500 }),
    };
    const { groups, errors } = planDepositPayments(
      [
        { invoiceId: "i15", amount: 15607.87 },
        { invoiceId: "i55", amount: 351.64 },
        { invoiceId: "i9", amount: 200 },
      ],
      invoices,
    );
    expect(errors).toEqual([]);
    expect(groups.map((g) => [g.customerName, g.total, g.lines.length])).toEqual([
      ["Berger", 200, 1],
      ["Genna Gormley", 15959.51, 2],
    ]);
  });

  it("refuses an amount over the balance, a closed invoice, and a vendor bill — all at once", () => {
    const { groups, errors } = planDepositPayments(
      [
        { invoiceId: "a1", amount: 1000.01 },
        { invoiceId: "a2", amount: 10 },
        { invoiceId: "a3", amount: 10 },
        { invoiceId: "a4", amount: 0 },
        { invoiceId: "a5", amount: 1.005 },
        { invoiceId: "zz", amount: 10 },
      ],
      {
        a1: inv("a1"),
        a2: inv("a2", { status: "draft" }),
        a3: inv("a3", { type: "vendorBill" }),
        a4: inv("a4"),
        a5: inv("a5"),
        zz: null,
      },
    );
    expect(groups).toEqual([]);
    expect(errors).toHaveLength(6);
    expect(errors[0]).toContain("more than the $1,000.00 still owed");
    expect(errors[1]).toContain("draft");
  });

  it("refuses an empty selection and a repeated invoice", () => {
    expect(planDepositPayments([], {}).errors).toEqual(["Select at least one invoice."]);
    const twice = planDepositPayments(
      [
        { invoiceId: "a1", amount: 5 },
        { invoiceId: "a1", amount: 5 },
      ],
      { a1: inv("a1") },
    );
    expect(twice.errors[0]).toContain("selected twice");
  });

  it("takes an approved invoice and an exact-balance amount", () => {
    const { errors } = planDepositPayments([{ invoiceId: "a1", amount: 1000 }], { a1: inv("a1", { status: "approved" }) });
    expect(errors).toEqual([]);
  });
});

describe("names", () => {
  it("keys a payment on the deposit and the account, within 128 characters", () => {
    expect(paymentExternalId("k1", "acct1")).toBe("deposit:k1:acct1");
    expect(paymentExternalId("x".repeat(200), "a").length).toBe(128);
  });
  it("describes the payment and names the photos", () => {
    expect(paymentDescription("2026-10-26", " #1042 ")).toBe("Check deposit · Oct 26, 2026 · #1042");
    expect(paymentDescription("2026-10-26", "")).toBe("Check deposit · Oct 26, 2026");
    expect(checkPhotoName("2026-10-26", 0, 1)).toBe("Deposit 2026-10-26 check.jpg");
    expect(checkPhotoName("2026-10-26", 1, 3)).toBe("Deposit 2026-10-26 check 2.jpg");
  });
});

describe("composeDepositEmail", () => {
  const email = composeDepositEmail({
    date: "2026-10-26",
    reference: "#1042",
    photos: 2,
    lines: [
      { customerName: "Genna Gormley", jobName: "Studio", jobNumber: "34", invoiceNumber: "15", amount: 15607.87 },
      { customerName: "A & B <Co>", jobName: "Barn", jobNumber: "", invoiceNumber: "55", amount: 351.64 },
    ],
  });
  it("puts the date and total in the subject", () => {
    expect(email.subject).toBe("Deposit Oct 26, 2026 — $15,959.51");
  });
  it("lists each job and amount, escaped in the HTML", () => {
    expect(email.html).toContain("Studio (34)");
    expect(email.html).toContain("A &amp; B &lt;Co&gt;");
    expect(email.html).toContain("$15,959.51");
    expect(email.text).toContain("Genna Gormley — Studio (34) — invoice #15 — $15,607.87");
    expect(email.text).toContain("The 2 checks for today's deposit are attached.");
    expect(email.text).toContain("Check numbers: #1042");
  });
});
