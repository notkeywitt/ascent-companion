/**
 * THE SOURCES OF THE INBOX that nothing else runs — each is read on demand and
 * reported into the findings store (lib/findings).
 *
 * Two kinds of source exist:
 *   • PUSH: a job that already runs reports as its last step. Invoice review
 *     does this in lib/invoiceReview/run.ts. It needs no entry here.
 *   • PULL: a cheap read with no job of its own. It gets one entry in `PULL`,
 *     and `refreshSources` runs it when the inbox or Home's count is read.
 *
 * A pull source that throws or runs out of time reports nothing, so its rows
 * stay as they were. An empty array means "nothing is wrong" and resolves them.
 */
import { ensureDb, rawDb } from "@/db";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { companyDateParts, COMPANY_TZ } from "@/lib/billing";
import { DIGEST_GLOBAL } from "@/lib/digest/settings";
import { report, type FindingInput } from "@/lib/findings";
import { recentMonthlyCheckRuns } from "@/lib/invoiceReview/investigations";
import { reviewWindow } from "@/lib/invoiceReview/schedule";
import { DEFAULT_SETTINGS as REVIEW_SETTINGS } from "@/lib/invoiceReview/settings";
import { money } from "@/lib/money";

interface PullSource {
  source: string;
  load: () => Promise<FindingInput[]>;
}

const TIMEOUT_MS = 6_000;
const MIN_GAP_MS = 60_000;

const PULL: PullSource[] = [
  {
    // Bills that reached the sheet and cannot push: no JobTread vendor matches.
    source: "stuck-vendors",
    load: async () => {
      const r = await callAppsScriptOrThrow<{ vendors?: { vendor: string; reason?: string; count: number }[] }>(
        { action: "listStuckVendors" },
        { timeoutMs: TIMEOUT_MS },
      );
      return (r.vendors ?? []).map((v) => ({
        key: v.vendor.trim().toLowerCase(),
        kind: "stuck-vendor",
        subject: v.vendor,
        title: `${v.vendor}: ${v.count} bill${v.count === 1 ? "" : "s"} cannot reach JobTread${v.reason ? ` — ${v.reason}` : ""}`,
        link: "/email?section=stuck",
      }));
    },
  },
  {
    // Bills held for a job decision: no job picked, so not in JobTread yet.
    source: "needs-project",
    load: async () => {
      const r = await callAppsScriptOrThrow<{ items?: { expId: string; vendor?: string; amount?: number }[] }>(
        { action: "listNeedsProject" },
        { timeoutMs: TIMEOUT_MS },
      );
      return (r.items ?? []).map((b) => ({
        key: b.expId,
        kind: "needs-project",
        subject: b.vendor || "Unknown vendor",
        title: `${b.vendor || "Unknown vendor"} ${money(b.amount ?? 0)}: no job picked, so it is not in JobTread`,
        link: "/needs-project",
      }));
    },
  },
  {
    // Ingested bills that never reached JobTread: no job doc, not dismissed.
    source: "uncaptured",
    load: async () => {
      const r = await callAppsScriptOrThrow<{
        items?: { expId: string; vendor?: string; amount?: number; billingMonth?: number | null; billingYear?: number | null }[];
      }>({ action: "listUncaptured" }, { timeoutMs: TIMEOUT_MS });
      return (r.items ?? []).map((b) => ({
        key: b.expId,
        kind: "uncaptured",
        subject: b.vendor || "Unknown vendor",
        title: `${b.vendor || "Unknown vendor"} ${money(b.amount ?? 0)}${
          b.billingMonth && b.billingYear ? ` (${b.billingMonth}/${b.billingYear})` : ""
        }: ingested, never reached JobTread`,
        link: "/needs-project",
      }));
    },
  },
  {
    // Bills flagged "needs review": a fix the app cannot make itself.
    source: "flagged-bills",
    load: async () => {
      await ensureDb();
      const res = await rawDb().execute(`
        SELECT sb.doc_id AS docId, sb.review_note AS note, bi.vendor AS vendor, bi.amount AS amount, bi.job_id AS jobId
          FROM saved_bills sb LEFT JOIN bill_index bi ON bi.jt_doc_id = sb.doc_id
         WHERE sb.needs_review = 1`);
      return res.rows.map((r) => {
        const vendor = r.vendor == null ? "Bill" : String(r.vendor);
        const note = r.note ? `: ${String(r.note)}` : "";
        return {
          key: String(r.docId),
          kind: "flagged-bill",
          subject: vendor,
          title: `${vendor}${r.amount == null ? "" : ` ${money(Number(r.amount))}`} flagged for a billing correction${note}`,
          link: `/bill/${r.docId}${r.jobId ? `?jobId=${encodeURIComponent(String(r.jobId))}` : ""}`,
        };
      });
    },
  },
];

let lastRefresh = 0;

/**
 * Run every pull source and report what it returns. Never throws.
 * ponytail: the gap is kept per server instance, so two instances can each
 * refresh inside one minute. Move the refresh to the digest cron if the reads
 * get slow.
 */
export async function refreshSources(): Promise<void> {
  if (Date.now() - lastRefresh < MIN_GAP_MS) return;
  lastRefresh = Date.now();
  await Promise.allSettled(
    PULL.map(async (s) => {
      const items = await Promise.race([
        s.load(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
      ]);
      await report(s.source, items);
    }),
  );
}

export interface MacCheckStatus {
  /** The billing month under review, or "" outside the invoicing window. */
  ym: string;
  /** ISO time of the last finished run for that month, or "". */
  lastRunAt: string;
  /** A run is due today, it is past LATE_HOUR, and none has finished today. */
  late: boolean;
}

/** The Mac starts its check after 9 am on a review day. Two hours of grace. */
const LATE_HOUR = 11;

const dayOf = (d: Date) => {
  const p = companyDateParts(d);
  return `${p.year}-${p.month}-${p.day}`;
};

/** Pure: whether the Mac check is late, from the window and the last run. */
export function macCheckLate(now: Date, due: boolean, lastRunAt: string): boolean {
  if (!due) return false;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: COMPANY_TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < LATE_HOUR) return false;
  return !lastRunAt || dayOf(new Date(lastRunAt)) !== dayOf(now);
}

/** When the Mac check (Claude Code on the office Mac) last finished, and whether it is late. */
export async function macCheckStatus(now = new Date()): Promise<MacCheckStatus> {
  const w = reviewWindow(now, REVIEW_SETTINGS.schedule, DIGEST_GLOBAL.billingCutoffDay);
  if (!w) return { ym: "", lastRunAt: "", late: false };
  const runs = await recentMonthlyCheckRuns(w.ym, 30);
  const lastRunAt = runs.find((r) => r.status === "done" && r.ym === w.ym)?.at ?? "";
  return { ym: w.ym, lastRunAt, late: macCheckLate(now, w.due, lastRunAt) };
}
