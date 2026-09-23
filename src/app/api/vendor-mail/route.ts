import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getRecentVendorBills, getVendorEmails, type RecentVendorBill } from "@/lib/jobtread";
import {
  SHARED_SENDER_DOMAINS,
  buildAddressIndex,
  captureState,
  classifyKind,
  effectiveSender,
  indexCoverage,
  paymentState,
} from "@/lib/vendorMail";

/**
 * DID ANY VENDOR INVOICE SLIP THROUGH?
 *
 * Mail from the addresses on file in JobTread, each row marked with whether it
 * reached JobTread and what state the resulting bill is in. Read-only from end
 * to end — it tells the office what to look at and captures nothing.
 *
 * The join, in one pass:
 *   1. the vendor address index (JobTread vendor Email field)
 *   2. mail from exactly those addresses (Apps Script, all mail, metadata only),
 *      carrying the Gmail message ids already recorded against Expenditure rows
 *   3. every vendor bill issued in the window, org-wide, with its paid state
 *
 * `coverage` rides along with the rows because it is the scope of the answer: a
 * vendor with no address on file cannot be searched for, and their absence from
 * the list means nothing. Reporting rows without coverage would be a false
 * all-clear.
 *
 * GET /api/vendor-mail?days=30
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** How far either side of an email a bill may sit and still be "this invoice".
 *  Matches the monthly review's window. */
const MATCH_WINDOW_DAYS = 21;
/** Dollars of slack when comparing a subject's amount to a bill's cost. */
const AMOUNT_TOLERANCE = 1;

interface MailRow {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  fromAddress: string;
  fromName: string;
  date: string;
  attachmentCount: number;
  subjectAmount: number | null;
  threadUrl: string;
  labels: string[];
  capturedExpId?: string;
  /** Platform mail names the vendor here, not in the From address. */
  replyTo?: string;
}

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const asked = Number(req.nextUrl.searchParams.get("days"));
  const days = Math.min(120, Math.max(1, Number.isFinite(asked) && asked > 0 ? asked : 30));

  try {
    const cfg = getPaveConfig();
    const vendors = await getVendorEmails(cfg);
    const { byAddress, collisions } = buildAddressIndex(
      vendors.flatMap((v) =>
        v.addresses.map((address) => ({ vendorId: v.id, vendorName: v.name, address })),
      ),
    );
    const indexed = vendors.filter((v) => v.addresses.length > 0).length;
    const coverage = indexCoverage(vendors.length, indexed);
    const addresses = [...byAddress.keys()];

    // An empty index must not fall through to sweeping the whole mailbox.
    if (!addresses.length) {
      return NextResponse.json({
        ok: true,
        days,
        coverage,
        collisions,
        rows: [],
        truncated: false,
        swept: { messages: 0, addresses: 0 },
        unindexed: vendors.filter((v) => !v.addresses.length).map((v) => ({ id: v.id, name: v.name })),
      });
    }

    // Bills are read a match-window EARLIER than the mail window, so an invoice
    // that arrived on day 30 can still find a bill issued before the sweep began.
    const since = new Date(Date.now() - (days + MATCH_WINDOW_DAYS) * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const [mail, bills] = await Promise.all([
      callAppsScript<{
        ok?: boolean;
        emails?: MailRow[];
        truncated?: boolean;
        count?: number;
        searched?: number;
        error?: string;
      }>(
        // The platform domains are searched TOO: QuickBooks mails a vendor's
        // invoice from its own address, so a from:-search over vendor addresses
        // would miss every one. Their Reply-To names the real vendor.
        { action: "listVendorMail", addresses, domains: SHARED_SENDER_DOMAINS, days },
        { timeoutMs: 90_000 },
      ),
      getRecentVendorBills(cfg, since),
    ]);
    if (mail.error) return NextResponse.json({ ok: false, error: mail.error }, { status: 502 });
    if (mail.data?.ok === false) {
      return NextResponse.json({ ok: false, error: mail.data.error ?? "Mail sweep failed." }, { status: 502 });
    }

    const byVendor = new Map<string, RecentVendorBill[]>();
    for (const b of bills) {
      const list = byVendor.get(b.vendorId) ?? [];
      list.push(b);
      byVendor.set(b.vendorId, list);
    }
    // Message ids the Expenditure sheet already records — the proof tier.
    const capturedIds = new Set(
      (mail.data?.emails ?? []).filter((e) => e.capturedExpId).map((e) => e.messageId),
    );

    const rows = (mail.data?.emails ?? []).map((e) => {
      const sender = effectiveSender({ fromAddress: e.fromAddress, replyTo: e.replyTo });
      const vendor = sender.address ? (byAddress.get(sender.address) ?? null) : null;
      const candidates = vendor ? (byVendor.get(vendor.vendorId) ?? []) : [];
      const { state, bill } = captureState(
        {
          messageId: e.messageId,
          vendorId: vendor?.vendorId ?? "",
          date: e.date,
          subjectAmount: e.subjectAmount,
        },
        { messageIds: capturedIds },
        candidates.map((b) => ({
          id: b.id,
          vendorId: b.vendorId,
          issueDate: b.issueDate,
          cost: b.cost,
          amountPaid: b.amountPaid,
          balance: b.balance,
        })),
        { windowDays: MATCH_WINDOW_DAYS, tolerance: AMOUNT_TOLERANCE },
      );
      const full = bill ? candidates.find((b) => b.id === bill.id) ?? null : null;
      return {
        messageId: e.messageId,
        subject: e.subject,
        from: e.from,
        fromAddress: e.fromAddress,
        // What the vendor was matched ON, and whether a platform relayed it —
        // a QuickBooks invoice reads as the vendor's, with the route shown.
        senderAddress: sender.address,
        viaPlatform: sender.viaPlatform,
        date: e.date,
        attachmentCount: e.attachmentCount,
        subjectAmount: e.subjectAmount,
        threadUrl: e.threadUrl,
        vendorId: vendor?.vendorId ?? "",
        vendorName: vendor?.vendorName ?? "",
        state,
        kind: classifyKind(e.subject),
        expId: e.capturedExpId ?? "",
        bill: full
          ? {
              id: full.id,
              number: full.number,
              cost: full.cost,
              jobId: full.jobId,
              jobName: full.jobName,
              payment: paymentState(full),
            }
          : null,
      };
    });
    rows.sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({
      ok: true,
      days,
      coverage,
      collisions,
      truncated: mail.data?.truncated === true,
      // What the sweep actually did. An empty `rows` must be readable as "nothing
      // was found" rather than "nothing was looked at" — those are opposite
      // answers and the page has to tell them apart.
      swept: {
        messages: mail.data?.count ?? 0,
        addresses: mail.data?.searched ?? addresses.length,
      },
      rows,
      unindexed: vendors.filter((v) => !v.addresses.length).map((v) => ({ id: v.id, name: v.name })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
