/**
 * VENDOR MAIL — did every invoice a vendor sent actually get captured?
 *
 * The question is completeness, not capture: this is a list you read to satisfy
 * yourself that nothing slipped, and nothing here books a bill or touches a
 * document. Its predecessor tried to import automatically and was set aside —
 * an unattended scan that re-bills a hand-entered invoice is worse than no scan
 * at all.
 *
 * ## The index is the guarantee
 *
 * The mailbox is searched by the vendor ADDRESSES on file in JobTread, so every
 * hit belongs to a known vendor by construction — there is no "unrecognized
 * sender" case to adjudicate. The cost of that precision is the blind spot: a
 * vendor with no address on file is invisible, and the list looks clean whether
 * or not they sent anything. So coverage is displayed as loudly as the rows are
 * (`indexCoverage`), because it IS the scope of what the page can promise.
 *
 * ## Why capture is decided in two tiers
 *
 * Every bill imported from email wrote its Gmail message id to the Expenditure
 * sheet, so an exact id hit is proof. A bill typed into JobTread by hand has no
 * such id, and proof is unavailable — the best that can be said is that a bill
 * from that vendor, near that date, for that amount exists. Those two are NOT
 * the same claim and the page does not present them as one: `captured` is
 * evidence, `likely` is inference, and the office reads the difference.
 */

/** An address as it is compared: lower-cased, unwrapped from any display name. */
export function normalizeAddress(raw: string): string {
  const s = String(raw ?? "").trim();
  const angled = s.match(/<([^>]+)>/); // "Acme Billing <ar@acme.com>"
  const addr = (angled ? angled[1] : s).trim().toLowerCase();
  return addr.includes("@") ? addr : "";
}

/**
 * Senders that front MANY vendors, and must never be indexed to one.
 *
 * QuickBooks mails a vendor's invoice from `quickbooks@notification.intuit.com`
 * with the vendor's name in the display name; the same is true of the other
 * invoicing platforms. Filing one of these on a vendor account would attribute
 * every OTHER vendor's platform mail to that one vendor — a wrong answer
 * delivered confidently, which is worse than the gap it appears to close.
 *
 * Matched on the domain, so a platform's per-tenant sender
 * (`noreply@x.bill.com`) is caught too. The list is additive: an unknown
 * platform is simply indexed as an ordinary vendor address until it shows up
 * here, which is the same failure we have today and not a new one.
 */
export const SHARED_SENDER_DOMAINS = [
  "notification.intuit.com",
  "intuit.com",
  "bill.com",
  "melio.com",
  "invoice2go.com",
  "waveapps.com",
  "freshbooks.com",
  "squareup.com",
  "stripe.com",
  "paypal.com",
  "xero.com",
  "billtrust.com",
  "coupahost.com",
];

/** Does this address front many vendors rather than belonging to one? */
export function isSharedSender(address: string): boolean {
  const addr = normalizeAddress(address);
  if (!addr) return false;
  const domain = addr.slice(addr.indexOf("@") + 1);
  return SHARED_SENDER_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

/**
 * The address that identifies the VENDOR, which is not always the From address.
 *
 * QuickBooks sends a vendor's invoice from its own notification address and puts
 * the vendor in the display name — but it also sets Reply-To to the vendor's
 * real mailbox (confirmed on a live invoice 2026-09-19:
 * `Naturally Sustained <quickbooks@notification.intuit.com>`, reply-to
 * `store@naturallysustained.com`). So for a platform sender the Reply-To IS the
 * vendor's address, which makes the match exact rather than a name guess — and
 * means one platform email teaches the index a real address.
 *
 * A platform mail with no usable Reply-To returns "" rather than falling back to
 * the platform address, because attributing it to whoever owns that address is
 * the exact mis-match this whole guard exists to prevent.
 */
export function effectiveSender(email: { fromAddress: string; replyTo?: string }): {
  address: string;
  viaPlatform: boolean;
} {
  const from = normalizeAddress(email.fromAddress);
  if (!isSharedSender(from)) return { address: from, viaPlatform: false };
  const reply = normalizeAddress(email.replyTo ?? "");
  // A platform that replies to itself tells us nothing about the vendor.
  return { address: isSharedSender(reply) ? "" : reply, viaPlatform: true };
}

export interface VendorAddress {
  vendorId: string;
  vendorName: string;
  address: string;
}

/**
 * address → vendor, from the raw {vendorId, vendorName, email} rows.
 *
 * A vendor may carry several addresses (JobTread's Email field is free text and
 * some rows hold "ar@x.com, billing@x.com"), and two vendors can share one — a
 * parent company billing for a subsidiary. First writer wins on a collision,
 * and `collisions` names them rather than hiding the ambiguity, because a
 * shared address means this page can attribute its mail to only one of them.
 */
export function buildAddressIndex(rows: VendorAddress[]): {
  byAddress: Map<string, { vendorId: string; vendorName: string }>;
  collisions: { address: string; vendors: string[] }[];
} {
  const byAddress = new Map<string, { vendorId: string; vendorName: string }>();
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    const addr = normalizeAddress(r.address);
    // A shared sender on a vendor account is a mis-indexing waiting to happen:
    // it would claim every other vendor's platform mail. Refuse it here so one
    // bad row can't poison the whole sweep.
    if (!addr || isSharedSender(addr)) continue;
    const names = seen.get(addr) ?? [];
    if (!names.includes(r.vendorName)) names.push(r.vendorName);
    seen.set(addr, names);
    if (!byAddress.has(addr)) byAddress.set(addr, { vendorId: r.vendorId, vendorName: r.vendorName });
  }
  const collisions = [...seen.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([address, vendors]) => ({ address, vendors }));
  return { byAddress, collisions };
}

/** One Email field value split into the addresses it actually holds. */
export function splitAddresses(value: string): string[] {
  return String(value ?? "")
    .split(/[,;]+|\s+or\s+/i)
    .map(normalizeAddress)
    .filter(Boolean);
}

/**
 * The Gmail query for one sweep.
 *
 * `in:anywhere` because an archived invoice is exactly the one that gets
 * forgotten — the same reasoning the month-scoped audit uses. Gmail caps a
 * query's length, so callers batch the address list; `chunkAddresses` sizes the
 * batches.
 */
export function buildMailQuery(addresses: string[], days: number): string {
  const from = addresses.filter(Boolean).map((a) => `from:${a}`).join(" OR ");
  if (!from) return "";
  return `in:anywhere newer_than:${Math.max(1, Math.round(days))}d (${from})`;
}

/** Address batches that keep each Gmail query under `maxChars`. */
export function chunkAddresses(addresses: string[], maxChars = 1800): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const a of addresses) {
    const cost = a.length + 10; // "from:" + " OR "
    if (cur.length && len + cost > maxChars) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(a);
    len += cost;
  }
  if (cur.length) out.push(cur);
  return out;
}

export type CaptureState = "captured" | "likely" | "new";

export interface CapturedRef {
  /** Gmail message ids already recorded against a captured bill. */
  messageIds: Set<string>;
}

export interface BillNear {
  vendorId: string;
  issueDate: string | null;
  cost: number;
  amountPaid: number;
  balance: number;
  id: string;
}

/**
 * Is this email's invoice already in JobTread, and how sure are we?
 *
 * An exact Gmail message id hit is proof (`captured`). Otherwise a bill from the
 * same vendor within `windowDays` — and, when the subject printed an amount,
 * agreeing within `tolerance` — is inference (`likely`). Lenient on purpose: a
 * false "likely" costs a glance, a false "new" costs a phone call to a vendor
 * who was paid weeks ago.
 */
export function captureState(
  email: { messageId: string; vendorId: string; date: string; subjectAmount: number | null },
  captured: CapturedRef,
  bills: BillNear[],
  cfg: { windowDays: number; tolerance: number },
): { state: CaptureState; bill: BillNear | null } {
  if (email.messageId && captured.messageIds.has(email.messageId)) {
    const exact = bills.find((b) => b.vendorId === email.vendorId) ?? null;
    return { state: "captured", bill: exact };
  }
  const when = Date.parse(`${String(email.date).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(when)) return { state: "new", bill: null };

  for (const b of bills) {
    if (b.vendorId !== email.vendorId || !b.issueDate) continue;
    const bd = Date.parse(`${String(b.issueDate).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(bd)) continue;
    if (Math.abs(bd - when) > cfg.windowDays * 86_400_000) continue;
    if (email.subjectAmount != null && email.subjectAmount > 0) {
      if (Math.abs(b.cost - email.subjectAmount) > cfg.tolerance) continue;
    }
    return { state: "likely", bill: b };
  }
  return { state: "new", bill: null };
}

/**
 * Invoice (money owed) or receipt (money already gone)?
 *
 * Read off the subject, because that is all this page reads — no body, no
 * attachment. A receipt is the confident case: "payment received", "thank you
 * for your payment", "order confirmation". Everything else that looks like a
 * bill is an invoice, because treating an unpaid invoice as a receipt is the
 * error that loses money.
 */
export function classifyKind(subject: string): "invoice" | "receipt" {
  const s = String(subject ?? "").toLowerCase();
  const receipt =
    /\breceipt\b|payment (received|confirmation|posted|applied)|thank you for your (payment|order)|\bpaid in full\b|order confirmation|autopay|auto-pay|payment successful|has been charged/;
  return receipt.test(s) ? "receipt" : "invoice";
}

/** `102 of 238 vendors have an email on file` — the scope of the promise. */
export function indexCoverage(totalVendors: number, indexed: number): {
  total: number;
  indexed: number;
  missing: number;
  pct: number;
} {
  const total = Math.max(0, totalVendors);
  const have = Math.min(Math.max(0, indexed), total);
  return {
    total,
    indexed: have,
    missing: total - have,
    pct: total === 0 ? 0 : Math.round((have / total) * 100),
  };
}

/**
 * A proposed address→vendor pair, drawn from mail that actually arrived.
 *
 * `messages` and `sampleSubject` are the evidence the office judges it on. This
 * is a proposal, never a write: the fuzzy sender→vendor match that produced it
 * is the same heuristic the index exists to replace, so it is good enough to
 * SUGGEST and not good enough to trust.
 */
export interface SeedCandidate {
  address: string;
  fromName: string;
  vendorId: string;
  vendorName: string;
  messages: number;
  sampleSubject: string;
  sampleDate: string;
  threadUrl: string;
}

export interface SeedEmail {
  fromAddress: string;
  fromName: string;
  fromDomain: string;
  subject: string;
  date: string;
  threadUrl: string;
  /** Set on platform mail — the vendor's own address (see effectiveSender). */
  replyTo?: string;
}

/**
 * Turn recent mail into address→vendor proposals for vendors with no address.
 *
 * Only vendors that are currently UN-indexed are offered, so approving a
 * proposal can never overwrite an address somebody already curated. Addresses
 * already in the index are skipped outright — they need no seeding — and the
 * busiest sender comes first, because the vendor who mails weekly is the one
 * whose absence from the index costs the most.
 *
 * `match` is injected rather than imported so this stays pure and the caller
 * supplies the digest's sender matcher.
 */
export function proposeSeeds(
  emails: SeedEmail[],
  knownAddresses: Set<string>,
  unindexedVendors: { id: string; name: string }[],
  match: (e: { fromName: string; fromDomain: string }, vendors: { id: string; name: string }[]) =>
    { id: string; name: string } | null,
): SeedCandidate[] {
  const byAddress = new Map<string, { rows: SeedEmail[] }>();
  for (const e of emails) {
    // Platform mail contributes its REPLY-TO, never the platform address:
    // matchVendor scores on the display name and QuickBooks puts the vendor's
    // name there, so proposing the From address would offer
    // "quickbooks@notification.intuit.com → Beacon Roofing" and attribute every
    // vendor's QBO mail to Beacon. The Reply-To is that vendor's real mailbox,
    // which is exactly what the index wants.
    const { address: addr } = effectiveSender({
      fromAddress: e.fromAddress || e.fromName,
      replyTo: e.replyTo,
    });
    if (!addr || knownAddresses.has(addr)) continue;
    const slot = byAddress.get(addr) ?? { rows: [] };
    slot.rows.push(e);
    byAddress.set(addr, slot);
  }

  const out: SeedCandidate[] = [];
  // One vendor gets at most one proposal — its busiest address — so approving
  // the list can't write two different addresses onto the same account.
  const claimed = new Set<string>();
  const ordered = [...byAddress.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length);

  for (const [address, { rows }] of ordered) {
    const newest = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const v = match(
      { fromName: newest.fromName ?? "", fromDomain: newest.fromDomain ?? "" },
      unindexedVendors,
    );
    if (!v || claimed.has(v.id)) continue;
    claimed.add(v.id);
    out.push({
      address,
      fromName: newest.fromName ?? "",
      vendorId: v.id,
      vendorName: v.name,
      messages: rows.length,
      sampleSubject: newest.subject ?? "",
      sampleDate: String(newest.date ?? "").slice(0, 10),
      threadUrl: newest.threadUrl ?? "",
    });
  }
  return out;
}

export type PaymentState = "paid" | "unpaid" | "draft";

/**
 * Paid, unpaid, or not a real bill yet.
 *
 * A DRAFT is none of the above and must not read as "paid": JobTread reports
 * `amountPaid: 0, balance: 0` on a draft (confirmed live 2026-09-23), which is
 * indistinguishable from a settled bill on the numbers alone. Calling an
 * un-issued bill paid is exactly the error this page exists to catch, so draft
 * status is checked first.
 */
export function paymentState(bill: {
  status: string;
  amountPaid: number;
  balance: number;
  cost: number;
}): PaymentState {
  if (String(bill.status ?? "").toLowerCase() === "draft") return "draft";
  if (bill.amountPaid > 0 && bill.balance <= 0.005) return "paid";
  return "unpaid";
}
