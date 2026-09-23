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
    if (!addr) continue;
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
