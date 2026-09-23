import { describe, expect, it } from "vitest";
import {
  buildAddressIndex,
  buildMailQuery,
  captureState,
  chunkAddresses,
  classifyKind,
  effectiveSender,
  indexCoverage,
  isSharedSender,
  normalizeAddress,
  paymentState,
  proposeSeeds,
  splitAddresses,
  type BillNear,
  type SeedEmail,
} from "./vendorMail";

describe("normalizeAddress", () => {
  it("unwraps a display name and lower-cases", () => {
    expect(normalizeAddress("Acme Billing <AR@Acme.COM>")).toBe("ar@acme.com");
    expect(normalizeAddress("  Billing@Vendor.com ")).toBe("billing@vendor.com");
  });

  it("refuses anything that isn't an address, rather than indexing junk", () => {
    expect(normalizeAddress("Accounts Receivable")).toBe("");
    expect(normalizeAddress("")).toBe("");
  });
});

describe("splitAddresses", () => {
  it("splits the several addresses one Email field can hold", () => {
    expect(splitAddresses("ar@x.com, billing@x.com")).toEqual(["ar@x.com", "billing@x.com"]);
    expect(splitAddresses("ar@x.com; BILLING@X.com")).toEqual(["ar@x.com", "billing@x.com"]);
    expect(splitAddresses("ar@x.com or billing@x.com")).toEqual(["ar@x.com", "billing@x.com"]);
  });

  it("drops the fragments that aren't addresses", () => {
    expect(splitAddresses("ar@x.com, (accounting)")).toEqual(["ar@x.com"]);
    expect(splitAddresses("none on file")).toEqual([]);
  });
});

describe("buildAddressIndex", () => {
  it("maps an address to its vendor", () => {
    const { byAddress } = buildAddressIndex([
      { vendorId: "V1", vendorName: "Ferguson", address: "AR@ferguson.com" },
    ]);
    expect(byAddress.get("ar@ferguson.com")).toEqual({ vendorId: "V1", vendorName: "Ferguson" });
  });

  it("names a shared address instead of silently picking one vendor", () => {
    const { byAddress, collisions } = buildAddressIndex([
      { vendorId: "V1", vendorName: "Parent Co", address: "ar@group.com" },
      { vendorId: "V2", vendorName: "Subsidiary", address: "ar@group.com" },
    ]);
    expect(byAddress.get("ar@group.com")?.vendorId).toBe("V1"); // first writer wins
    expect(collisions).toEqual([{ address: "ar@group.com", vendors: ["Parent Co", "Subsidiary"] }]);
  });

  it("reports no collision when one vendor lists the same address twice", () => {
    const { collisions } = buildAddressIndex([
      { vendorId: "V1", vendorName: "Ferguson", address: "ar@ferguson.com" },
      { vendorId: "V1", vendorName: "Ferguson", address: "AR@Ferguson.com" },
    ]);
    expect(collisions).toEqual([]);
  });
});

describe("buildMailQuery", () => {
  it("searches all mail, not just the inbox — an archived invoice is the forgotten one", () => {
    const q = buildMailQuery(["a@x.com", "b@y.com"], 30);
    expect(q).toBe("in:anywhere newer_than:30d (from:a@x.com OR from:b@y.com)");
  });

  it("is empty for an empty index, so a caller can't sweep the whole mailbox by accident", () => {
    expect(buildMailQuery([], 30)).toBe("");
  });
});

describe("chunkAddresses", () => {
  it("keeps each query under the cap", () => {
    const many = Array.from({ length: 200 }, (_, i) => `vendor${i}@example.com`);
    const chunks = chunkAddresses(many, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(many); // nothing dropped, nothing duplicated
    for (const c of chunks) expect(buildMailQuery(c, 30).length).toBeLessThan(600);
  });

  it("keeps a single over-long address rather than dropping that vendor", () => {
    const one = ["a".repeat(500) + "@example.com"];
    expect(chunkAddresses(one, 100)).toEqual([one]);
  });
});

describe("captureState", () => {
  const cfg = { windowDays: 21, tolerance: 1 };
  const bill = (over: Partial<BillNear> = {}): BillNear => ({
    id: "B1",
    vendorId: "V1",
    issueDate: "2026-09-20",
    cost: 2840,
    amountPaid: 0,
    balance: 2840,
    ...over,
  });
  const email = (over = {}) => ({
    messageId: "M1",
    vendorId: "V1",
    date: "2026-09-19T10:00:00Z",
    subjectAmount: null as number | null,
    ...over,
  });

  it("calls an exact Gmail message id hit proof", () => {
    const r = captureState(email(), { messageIds: new Set(["M1"]) }, [bill()], cfg);
    expect(r.state).toBe("captured");
  });

  it("infers — but does not claim proof — from vendor and date alone", () => {
    const r = captureState(email(), { messageIds: new Set() }, [bill()], cfg);
    expect(r.state).toBe("likely");
    expect(r.bill?.id).toBe("B1");
  });

  it("reports nothing found when no bill is near", () => {
    const r = captureState(email(), { messageIds: new Set() }, [bill({ issueDate: "2026-06-01" })], cfg);
    expect(r.state).toBe("new");
    expect(r.bill).toBeNull();
  });

  it("never attributes another vendor's bill to this email", () => {
    const r = captureState(email(), { messageIds: new Set() }, [bill({ vendorId: "V2" })], cfg);
    expect(r.state).toBe("new");
  });

  it("uses a subject amount to reject a same-vendor bill that isn't this invoice", () => {
    const e = email({ subjectAmount: 2840 });
    expect(captureState(e, { messageIds: new Set() }, [bill({ cost: 19.99 })], cfg).state).toBe("new");
    expect(captureState(e, { messageIds: new Set() }, [bill({ cost: 2840.5 })], cfg).state).toBe("likely");
  });

  it("falls back to vendor and window when the subject printed no amount", () => {
    const r = captureState(email({ subjectAmount: null }), { messageIds: new Set() }, [bill({ cost: 19.99 })], cfg);
    expect(r.state).toBe("likely");
  });

  it("treats an unparseable date as not found rather than matching everything", () => {
    const r = captureState(email({ date: "" }), { messageIds: new Set() }, [bill()], cfg);
    expect(r.state).toBe("new");
  });
});

describe("classifyKind", () => {
  it("recognises a receipt", () => {
    for (const s of [
      "Your receipt from Home Depot",
      "Payment received - thank you",
      "Order confirmation #4821",
      "Autopay notice",
      "Thank you for your payment",
    ]) {
      expect(classifyKind(s)).toBe("receipt");
    }
  });

  it("treats anything else as an invoice — calling an unpaid bill 'paid' loses money", () => {
    for (const s of ["Invoice 44821", "Statement of account", "Amount due", "Past due notice", ""]) {
      expect(classifyKind(s)).toBe("invoice");
    }
  });
});

describe("indexCoverage", () => {
  it("states the scope of the promise", () => {
    expect(indexCoverage(238, 102)).toEqual({ total: 238, indexed: 102, missing: 136, pct: 43 });
  });

  it("never reports more indexed than exist, or divides by zero", () => {
    expect(indexCoverage(10, 99).indexed).toBe(10);
    expect(indexCoverage(0, 0).pct).toBe(0);
  });
});

describe("proposeSeeds", () => {
  // A stand-in for the digest's sender matcher: exact-ish name containment.
  const match = (
    e: { fromName: string; fromDomain: string },
    vendors: { id: string; name: string }[],
  ) => {
    const n = e.fromName.toLowerCase();
    const d = e.fromDomain.toLowerCase();
    return (
      vendors.find((v) => n.includes(v.name.toLowerCase()) || d.includes(v.name.toLowerCase().replace(/ /g, ""))) ??
      null
    );
  };
  const mail = (over: Partial<SeedEmail> = {}): SeedEmail => ({
    fromAddress: "ar@ferguson.com",
    fromName: "Ferguson",
    fromDomain: "ferguson.com",
    subject: "Invoice 44821",
    date: "2026-09-19T10:00:00Z",
    threadUrl: "https://mail.google.com/x",
    ...over,
  });
  const vendors = [{ id: "V1", name: "Ferguson" }, { id: "V2", name: "Beacon" }];

  it("proposes an address for an un-indexed vendor, with its evidence", () => {
    const out = proposeSeeds([mail(), mail({ subject: "Invoice 44822" })], new Set(), vendors, match);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ address: "ar@ferguson.com", vendorId: "V1", messages: 2 });
  });

  it("skips an address already in the index", () => {
    expect(proposeSeeds([mail()], new Set(["ar@ferguson.com"]), vendors, match)).toEqual([]);
  });

  it("proposes nothing when no vendor matches, rather than guessing", () => {
    const out = proposeSeeds(
      [mail({ fromAddress: "news@unrelated.com", fromName: "Unrelated", fromDomain: "unrelated.com" })],
      new Set(),
      vendors,
      match,
    );
    expect(out).toEqual([]);
  });

  it("gives one vendor a single proposal — its busiest address", () => {
    const out = proposeSeeds(
      [
        mail({ fromAddress: "quiet@ferguson.com" }),
        mail({ fromAddress: "ar@ferguson.com" }),
        mail({ fromAddress: "ar@ferguson.com" }),
      ],
      new Set(),
      vendors,
      match,
    );
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe("ar@ferguson.com");
    expect(out[0].messages).toBe(2);
  });

  it("reports the newest message as the sample", () => {
    const out = proposeSeeds(
      [
        mail({ subject: "older", date: "2026-09-01T10:00:00Z" }),
        mail({ subject: "newest", date: "2026-09-19T10:00:00Z" }),
      ],
      new Set(),
      vendors,
      match,
    );
    expect(out[0].sampleSubject).toBe("newest");
    expect(out[0].sampleDate).toBe("2026-09-19");
  });

  it("only ever offers vendors that have no address yet", () => {
    // Ferguson is indexed already and so isn't in the candidate list.
    const out = proposeSeeds([mail()], new Set(), [{ id: "V2", name: "Beacon" }], match);
    expect(out).toEqual([]);
  });
});

describe("paymentState", () => {
  const bill = (over = {}) => ({ status: "approved", amountPaid: 0, balance: 100, cost: 100, ...over });

  it("never calls a draft paid — JobTread reports 0/0 on one, same as settled", () => {
    expect(paymentState(bill({ status: "draft", amountPaid: 0, balance: 0 }))).toBe("draft");
  });

  it("reads a settled bill as paid", () => {
    expect(paymentState(bill({ amountPaid: 100, balance: 0 }))).toBe("paid");
  });

  it("reads an outstanding or part-paid bill as unpaid", () => {
    expect(paymentState(bill())).toBe("unpaid");
    expect(paymentState(bill({ amountPaid: 40, balance: 60 }))).toBe("unpaid");
  });

  it("tolerates a rounding crumb left on the balance", () => {
    expect(paymentState(bill({ amountPaid: 100, balance: 0.004 }))).toBe("paid");
  });
});

describe("isSharedSender", () => {
  it("knows the platforms that mail on behalf of many vendors", () => {
    expect(isSharedSender("quickbooks@notification.intuit.com")).toBe(true);
    expect(isSharedSender("noreply@bill.com")).toBe(true);
    expect(isSharedSender("Invoices <NOREPLY@Melio.com>")).toBe(true);
  });

  it("catches a platform's per-tenant subdomain sender", () => {
    expect(isSharedSender("noreply@mail.bill.com")).toBe(true);
  });

  it("leaves an ordinary vendor address alone", () => {
    expect(isSharedSender("ar@fergusonsupply.com")).toBe(false);
    expect(isSharedSender("")).toBe(false);
  });

  it("does not match a lookalike domain", () => {
    expect(isSharedSender("ar@notintuit.com")).toBe(false);
    expect(isSharedSender("ar@intuit.com.co")).toBe(false);
  });
});

describe("effectiveSender", () => {
  it("uses the From address for an ordinary vendor", () => {
    expect(effectiveSender({ fromAddress: "ar@ferguson.com" })).toEqual({
      address: "ar@ferguson.com",
      viaPlatform: false,
    });
  });

  it("takes the Reply-To off a QuickBooks invoice — the vendor's real mailbox", () => {
    // The live header, 2026-09-19.
    expect(
      effectiveSender({
        fromAddress: "Naturally Sustained <quickbooks@notification.intuit.com>",
        replyTo: "store@naturallysustained.com",
      }),
    ).toEqual({ address: "store@naturallysustained.com", viaPlatform: true });
  });

  it("yields nothing when a platform mail has no Reply-To, rather than blaming the platform's owner", () => {
    expect(effectiveSender({ fromAddress: "quickbooks@notification.intuit.com" })).toEqual({
      address: "",
      viaPlatform: true,
    });
  });

  it("ignores a Reply-To that points back at the platform", () => {
    expect(
      effectiveSender({
        fromAddress: "quickbooks@notification.intuit.com",
        replyTo: "noreply@intuit.com",
      }).address,
    ).toBe("");
  });
});

describe("shared senders never enter the index", () => {
  it("is refused even if someone files it on a vendor account by hand", () => {
    const { byAddress } = buildAddressIndex([
      { vendorId: "V1", vendorName: "Beacon", address: "quickbooks@notification.intuit.com" },
      { vendorId: "V1", vendorName: "Beacon", address: "ar@beacon.com" },
    ]);
    expect(byAddress.has("quickbooks@notification.intuit.com")).toBe(false);
    expect(byAddress.has("ar@beacon.com")).toBe(true);
  });

  it("is never proposed by the seeder — the platform address itself is refused", () => {
    const match = () => ({ id: "V1", name: "Beacon" });
    const out = proposeSeeds(
      [
        {
          fromAddress: "quickbooks@notification.intuit.com",
          fromName: "Beacon",
          fromDomain: "notification.intuit.com",
          subject: "Invoice 9 from Beacon",
          date: "2026-09-19T10:00:00Z",
          threadUrl: "u",
        },
      ],
      new Set(),
      [{ id: "V1", name: "Beacon" }],
      match,
    );
    expect(out).toEqual([]);
  });

  it("proposes the vendor's REPLY-TO from a platform email instead", () => {
    const match = () => ({ id: "V1", name: "Naturally Sustained" });
    const out = proposeSeeds(
      [
        {
          fromAddress: "quickbooks@notification.intuit.com",
          fromName: "Naturally Sustained",
          fromDomain: "notification.intuit.com",
          replyTo: "store@naturallysustained.com",
          subject: "Invoice - Reminder: Your payment to Naturally Sustained, LLC is due",
          date: "2026-09-19T22:06:00Z",
          threadUrl: "u",
        },
      ],
      new Set(),
      [{ id: "V1", name: "Naturally Sustained" }],
      match,
    );
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe("store@naturallysustained.com");
    expect(out[0].vendorId).toBe("V1");
  });
});
