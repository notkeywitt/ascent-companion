/**
 * Check "uncaptured-bills" (Billing) — a vendor invoice arrived by email and no
 * matching bill exists in JobTread.
 *
 * THE GAP THIS WATCHES. Ingestion catches the invoices it recognizes; the
 * /email queue catches the ones a human files by hand. Neither notices an
 * invoice that simply never got filed by either route — it sits in the inbox,
 * gets read, gets forgotten, and turns up a quarter later as a past-due notice.
 * This check reads the two systems against each other every morning.
 *
 * HOW THE MATCH WORKS, and why it is approximate. Vendor invoice numbers are not
 * reliably carried into JobTread (`externalId` is often the ingested ExpID, and
 * portal mail frequently prints no number at all), so matching on the number
 * would report everything as missing. Instead:
 *   1. the sender is resolved to a JobTread VENDOR ACCOUNT by name/domain,
 *   2. that vendor's bills are pulled once, and
 *   3. a bill counts as "the same invoice" when its issue date is within
 *      `matchWindowDays` of the email AND — when the subject printed an amount —
 *      its cost is within `amountTolerance` of it.
 * When the subject printed no amount, vendor + date window alone is the match.
 * That is deliberately lenient: a false MATCH costs nothing (the bill really is
 * in JobTread), while a false FLAG costs somebody a minute to dismiss.
 *
 * READ-ONLY. Gmail is searched, never labeled; JobTread is queried, never
 * written.
 */
import { callAppsScript } from "@/lib/appsScript";
import { getVendorBills, getVendors, type VendorBillRow, type VendorRef } from "@/lib/jobtread";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { UncapturedBillsConfig } from "../settings";

interface DigestEmail {
  threadId?: string;
  subject?: string;
  from?: string;
  fromAddress?: string;
  fromName?: string;
  fromDomain?: string;
  date?: string;
  attachmentCount?: number;
  subjectAmount?: number | null;
  threadUrl?: string;
}
interface DigestEmailResponse {
  ok?: boolean;
  error?: string;
  count?: number;
  emails?: DigestEmail[];
}

/** Lowercase, drop punctuation and the corporate-suffix noise that never matches. */
export function normalizeVendorName(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(inc|llc|llp|ltd|co|company|corp|corporation|incorporated|the|of|supply|supplies|services|service)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** The distinctive label of a domain: "accounts@ferguson-nw.com" → "fergusonnw". */
function domainRoot(domain: string): string {
  const parts = String(domain ?? "")
    .toLowerCase()
    .split(".")
    .filter(Boolean);
  // Drop the TLD (and a country second-level like .co.uk).
  const meaningful = parts.slice(0, Math.max(1, parts.length - (parts.length > 2 ? 2 : 1)));
  return meaningful.join("").replace(/[^a-z0-9]/g, "");
}

/**
 * Best JobTread vendor account for an email sender, or null.
 *
 * Three passes, strongest first: an exact normalized-name equality, then the
 * vendor name appearing inside the sender's display name (or vice versa), then
 * the sender's domain root matching the vendor name with its spaces removed.
 * A one- or two-character normalized name is never matched on containment —
 * "AB" is inside half the vendors in the org.
 */
export function matchVendor(
  email: { fromName?: string; fromDomain?: string },
  vendors: VendorRef[],
): VendorRef | null {
  const senderName = normalizeVendorName(email.fromName ?? "");
  const root = domainRoot(email.fromDomain ?? "");

  let best: VendorRef | null = null;
  let bestScore = 0;
  for (const v of vendors) {
    const vn = normalizeVendorName(v.name);
    if (!vn) continue;
    const compact = vn.replace(/ /g, "");
    let score = 0;
    if (senderName && vn === senderName) score = 3;
    else if (senderName && vn.length >= 4 && (senderName.includes(vn) || vn.includes(senderName)))
      score = 2;
    else if (root && compact.length >= 4 && (root.includes(compact) || compact.includes(root)))
      score = 1;
    // Longer names win ties: "ace hardware lopez" beats "ace".
    if (score > bestScore || (score > 0 && score === bestScore && vn.length > normalizeVendorName(best?.name ?? "").length)) {
      best = v;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Whether a bill plausibly IS the invoice that email announced. */
export function billMatchesEmail(
  bill: VendorBillRow,
  emailDate: string,
  emailAmount: number | null,
  cfg: { matchWindowDays: number; amountTolerance: number },
): boolean {
  if (!bill.issueDate || !emailDate) return false;
  const b = Date.parse(`${String(bill.issueDate).slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${String(emailDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(b) || Number.isNaN(e)) return false;
  if (Math.abs(b - e) > cfg.matchWindowDays * 86_400_000) return false;
  if (emailAmount == null || emailAmount <= 0) return true; // vendor + window is the match
  const cost = bill.cost || 0;
  if (cost <= 0) return false;
  // The email amount is the invoice total (tax included); `cost` is pre-tax, so
  // the tolerance has to cover sales tax as well as rounding.
  return Math.abs(cost - emailAmount) <= emailAmount * cfg.amountTolerance;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const uncapturedBillsCheck = defineCheck<UncapturedBillsConfig>({
  id: "uncaptured-bills",
  title: "Uncaptured Bills",
  category: "billing",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as UncapturedBillsConfig,

  async run({ config, settings, pave, log }): Promise<CheckResult> {
    if (!pave?.grantKey) return checkError("JobTread isn't configured, so bills can't be matched.");

    // 1. Candidate invoice mail (Apps Script owns the Gmail grant).
    const r = await callAppsScript<DigestEmailResponse>(
      {
        action: "digestInvoiceEmails",
        days: config.lookbackDays,
        limit: config.maxEmails,
      },
      { timeoutMs: settings.appsScriptTimeoutMs },
    );
    if (r.error) return checkError(`Couldn't read the inbox: ${r.error}`);
    if (r.data?.ok === false) return checkError(r.data.error || "Gmail scan failed.");
    const emails = r.data?.emails ?? [];
    log(`scanned ${emails.length} invoice-looking email(s) from the last ${config.lookbackDays} days`);

    // 2. Drop the vendors that are handled somewhere else on purpose.
    const excluded = config.excludeVendors.map((s) => s.toLowerCase().trim()).filter(Boolean);
    const isExcluded = (e: DigestEmail) => {
      const hay = `${e.fromName ?? ""} ${e.fromAddress ?? ""} ${e.fromDomain ?? ""}`.toLowerCase();
      return excluded.some((x) => hay.includes(x));
    };
    const candidates = emails.filter((e) => !isExcluded(e));
    const skipped = emails.length - candidates.length;
    if (skipped) log(`${skipped} email(s) skipped by the vendor exclusion list`);
    if (candidates.length === 0) {
      return allClear(`No unmatched vendor invoices in the last ${config.lookbackDays} days.`);
    }

    // 3. Resolve senders to JobTread vendor accounts (one org-wide read, cached).
    const vendors = await getVendors(pave);
    const unmatchedSenders: DigestEmail[] = [];
    const byVendor = new Map<string, { vendor: VendorRef; emails: DigestEmail[] }>();
    for (const e of candidates) {
      const v = matchVendor(e, vendors);
      if (!v) {
        unmatchedSenders.push(e);
        continue;
      }
      const slot = byVendor.get(v.id) ?? { vendor: v, emails: [] };
      slot.emails.push(e);
      byVendor.set(v.id, slot);
    }

    // 4. One bill list per distinct vendor, then match each email against it.
    const items: DigestItem[] = [];
    let looked = 0;
    for (const { vendor, emails: mine } of byVendor.values()) {
      if (looked >= config.maxVendorLookups) {
        log(`vendor lookup cap (${config.maxVendorLookups}) reached — ${byVendor.size - looked} vendor(s) not checked`);
        break;
      }
      looked++;
      let bills: VendorBillRow[] = [];
      try {
        bills = await getVendorBills(pave, vendor.id);
      } catch (err) {
        // One unreadable vendor must not lose the whole check.
        log(`couldn't read bills for ${vendor.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      for (const e of mine) {
        const amount = typeof e.subjectAmount === "number" ? e.subjectAmount : null;
        const hit = bills.find((b) => billMatchesEmail(b, e.date ?? "", amount, config));
        if (hit) continue;
        items.push({
          title: `${vendor.name} — ${e.subject ?? "(no subject)"}`,
          detail:
            `Arrived ${(e.date ?? "").slice(0, 10)} from ${e.from ?? "an unknown sender"}` +
            (amount ? `, subject shows ${money(amount)}` : "") +
            `. No JobTread bill for ${vendor.name} within ${config.matchWindowDays} days` +
            (amount ? " at a matching amount" : "") +
            `. ${e.attachmentCount ? `${e.attachmentCount} attachment(s).` : "No attachment — may be a portal notice."}`,
          sourceLink: e.threadUrl,
          sourceLabel: "Gmail thread",
          amount: amount ?? undefined,
          date: (e.date ?? "").slice(0, 10),
          group: vendor.name,
        });
      }
    }

    // 5. Senders that match no vendor account at all.
    if (config.flagUnknownSenders) {
      for (const e of unmatchedSenders) {
        const amount = typeof e.subjectAmount === "number" ? e.subjectAmount : null;
        items.push({
          title: `${e.fromName || e.fromAddress || "Unknown sender"} — ${e.subject ?? "(no subject)"}`,
          detail:
            `Arrived ${(e.date ?? "").slice(0, 10)} from ${e.from ?? "an unknown sender"}` +
            (amount ? `, subject shows ${money(amount)}` : "") +
            ". This sender doesn't match any JobTread vendor account, so there is no bill to find — " +
            "either it's a new vendor, or it isn't an invoice at all.",
          sourceLink: e.threadUrl,
          sourceLabel: "Gmail thread",
          amount: amount ?? undefined,
          date: (e.date ?? "").slice(0, 10),
          group: "Unrecognized sender",
        });
      }
    }

    items.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || (b.date ?? "").localeCompare(a.date ?? ""));
    if (items.length === 0) {
      return allClear(`All ${candidates.length} vendor invoices from the last ${config.lookbackDays} days are in JobTread.`);
    }
    const known = items.filter((i) => i.group !== "Unrecognized sender").length;
    return {
      status: "warning",
      items,
      summary:
        `${items.length} vendor invoice${items.length === 1 ? "" : "s"} with no matching JobTread bill` +
        (known !== items.length ? ` (${items.length - known} from unrecognized senders)` : "") +
        ".",
    };
  },
});
