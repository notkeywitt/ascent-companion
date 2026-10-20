import { describe, expect, it } from "vitest";
import { invoiceStatus, paymentState, type InvoiceRaw, type InvoiceRecipientRaw } from "./invoiceStatus";

const rcpt = (p: Partial<InvoiceRecipientRaw>): InvoiceRecipientRaw => ({
  name: "Client",
  emailDeliveryStatus: null,
  emailDeliveryStatusUpdatedAt: null,
  documentLastViewedAt: null,
  ...p,
});

const inv = (p: Partial<InvoiceRaw>): InvoiceRaw => ({
  status: "pending",
  priceWithTax: 100,
  amountPaid: 0,
  balance: 100,
  qboId: null,
  recipients: [],
  ...p,
});

describe("paymentState", () => {
  it("reads draft, open, part paid, paid and void", () => {
    expect(paymentState(inv({ status: "draft" }))).toBe("draft");
    expect(paymentState(inv({}))).toBe("open");
    expect(paymentState(inv({ amountPaid: 40, balance: 60 }))).toBe("partPaid");
    expect(paymentState(inv({ status: "approved", amountPaid: 100, balance: 0 }))).toBe("paid");
    expect(paymentState(inv({ status: "denied", balance: 0 }))).toBe("void");
  });
  it("treats a pending invoice with a zero balance and a payment as paid", () => {
    expect(paymentState(inv({ amountPaid: 100, balance: 0 }))).toBe("paid");
  });
});

describe("invoiceStatus delivery", () => {
  it("says not sent when no recipient was emailed", () => {
    const s = invoiceStatus(inv({ qboId: "46093", recipients: [rcpt({ name: "Tim" })] }));
    expect(s.delivery).toBe("notSent");
    expect(s.sentTo).toEqual([]);
    expect(s.inQbo).toBe(true);
  });
  it("takes the best state across recipients", () => {
    const s = invoiceStatus(
      inv({
        recipients: [
          rcpt({ name: "AP", emailDeliveryStatus: "delivered", emailDeliveryStatusUpdatedAt: "2026-10-01T19:31:06Z" }),
          rcpt({
            name: "Ian",
            emailDeliveryStatus: "opened",
            emailDeliveryStatusUpdatedAt: "2026-10-15T22:07:16Z",
            documentLastViewedAt: "2026-10-15T22:07:22Z",
          }),
        ],
      }),
    );
    expect(s.delivery).toBe("opened");
    expect(s.sentTo).toEqual(["AP", "Ian"]);
    expect(s.deliveryAt).toBe("2026-10-15T22:07:16Z");
    expect(s.viewedAt).toBe("2026-10-15T22:07:22Z");
  });
  it("counts a viewed document as opened even when the email still reads delivered", () => {
    const s = invoiceStatus(
      inv({ recipients: [rcpt({ emailDeliveryStatus: "delivered", documentLastViewedAt: "2026-10-08T15:19:36Z" })] }),
    );
    expect(s.delivery).toBe("opened");
  });
  it("flags a bounce even when another recipient got it", () => {
    const s = invoiceStatus(
      inv({ recipients: [rcpt({ emailDeliveryStatus: "hardBounced" }), rcpt({ emailDeliveryStatus: "delivered" })] }),
    );
    expect(s.delivery).toBe("delivered");
    expect(s.bounced).toBe(true);
  });
});
