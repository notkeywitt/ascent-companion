/**
 * THE INVESTIGATOR'S TOOLS — what Claude is allowed to look at, and nothing else.
 *
 * ## Why these are bound to one review rather than global
 *
 * `chatTools.ts` exposes a general JobTread surface to the /chat assistant. This
 * file is different: almost every tool here reads the REVIEW PAYLOAD that has
 * already been loaded — this month's jobs, invoices, bills, backup files, norms
 * — rather than querying anything. Three consequences, all deliberate:
 *
 *   • The loop is fast and costs nothing extra. The month is already in memory.
 *   • The tools are PURE FUNCTIONS over that payload, so they are unit-tested
 *     like the checks are, instead of needing a live org to exercise.
 *   • Claude cannot reach past the month under review. It can only interrogate
 *     the evidence the checks themselves saw.
 *
 * One tool breaks that pattern on purpose: `get_bill_detail` reads JobTread
 * live, because confirming that one half of a suspected double-bill is actually
 * a credit is the single thing the month's evidence cannot answer.
 *
 * ## The line these tools must not cross
 *
 * Every one of them READS. None writes, and none computes a figure that will
 * appear in a finding. The checks own every number; these exist so Claude can
 * work out which of those numbers matter, and why.
 */
import { getBillDetail, type PaveConfig } from "@/lib/jobtread";

import { cents, type Finding, type ReviewPayload } from "./types";

export interface InvestigateToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

export interface InvestigateTool extends InvestigateToolDef {
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

/** A recorded verdict, as Claude hands it over. */
export interface DispositionInput {
  key: string;
  verdict: "confirmed" | "probably-fine" | "needs-human";
  why: string;
  suggestedAction: string;
}

const VERDICTS = new Set(["confirmed", "probably-fine", "needs-human"]);

// ---------------------------------------------------------------------------
// The pure lookups. Exported individually so they can be tested without a model.
// ---------------------------------------------------------------------------

/** Everything known about one finding, plus the job it sits on. */
export function findingContext(payload: ReviewPayload, key: string) {
  const finding = payload.findings.find((f) => f.key === key);
  if (!finding) return { found: false as const, key };

  const job = payload.evidence.jobs.find((j) => j.jobId === finding.jobId);
  return {
    found: true as const,
    finding: {
      key: finding.key,
      kind: finding.kind,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      amount: finding.amount,
      customer: finding.customerName,
      job: finding.jobName,
      invoice: finding.invoiceNumber || undefined,
      age: finding.history
        ? finding.history.isNew
          ? "first time this has been seen"
          : `seen on ${finding.history.runsSeen} checks since ${finding.history.firstSeenAt.slice(0, 10)}`
        : "no history on record",
      alreadyRuledOn: finding.suppressedBy
        ? `The office set this aside: "${finding.suppressedBy.reason}"`
        : undefined,
    },
    // The job's own numbers, so a verdict can be reached without guessing.
    job: job
      ? {
          jobName: job.jobName,
          customer: job.customerName,
          isOverheadJob: job.neverInvoiced,
          invoices: job.invoices.map((i) => ({
            number: i.number,
            status: i.status,
            issueDate: i.issueDate,
            cost: i.cost,
            price: i.price,
            priceWithTax: i.priceWithTax,
            lineCount: i.lines.length,
          })),
          bills: job.bills.map((b) => ({
            id: b.id,
            vendor: b.vendor || b.label,
            cost: b.cost,
            status: b.status,
            onAnInvoice: b.invoiced,
            invoiceCount: b.invoiceIds.length,
          })),
          backupFolder: job.folder
            ? {
                path: job.folder.path,
                exists: job.folder.found,
                fileCount: job.folder.files.length,
              }
            : null,
          draftBills: { count: job.draftBillCount, cost: job.draftBillsCost },
          uninvoicedLabor: job.uninvoicedTimeCost,
        }
      : null,
  };
}

/**
 * Every backup PDF in the month that totals close to an amount, ACROSS ALL JOBS.
 *
 * This is the tool that replaces a human chore. `SKILL.md` tells whoever is
 * reading a `backup-missing` finding to go and search Drive for the amount,
 * because the usual cause is a PDF filed under the wrong job — and the month's
 * evidence already contains every job's folder listing, so the search is free.
 * It just had nobody to run it.
 */
export function searchBackupByAmount(payload: ReviewPayload, amount: number, tolerance = 0.01) {
  const want = cents(Math.abs(amount));
  const hits: {
    fileName: string;
    amount: number;
    filedUnderJob: string;
    filedUnderCustomer: string;
    path: string;
    url: string;
  }[] = [];

  for (const job of payload.evidence.jobs) {
    for (const f of job.folder?.files ?? []) {
      if (!f.parsed) continue;
      if (Math.abs(cents(Math.abs(f.amount)) - want) > tolerance) continue;
      hits.push({
        fileName: f.name,
        amount: f.amount,
        filedUnderJob: job.jobName,
        filedUnderCustomer: job.customerName,
        path: job.folder?.path ?? "",
        url: f.url,
      });
    }
  }
  return {
    searchedFor: want,
    jobsSearched: payload.evidence.jobs.length,
    hits,
    note: hits.length
      ? "A hit filed under a DIFFERENT job than the finding is the usual explanation for missing backup."
      : "Nothing in this month's filed backup totals that amount, under any job.",
  };
}

/** Bills from one vendor across the whole month, whatever job they landed on. */
export function billsByVendor(payload: ReviewPayload, vendor: string) {
  const needle = vendor.trim().toLowerCase();
  const hits: { job: string; vendor: string; cost: number; status: string; onAnInvoice: boolean }[] = [];
  for (const job of payload.evidence.jobs) {
    for (const b of job.bills) {
      const name = (b.vendor || b.label || "").toLowerCase();
      if (!needle || !name.includes(needle)) continue;
      hits.push({
        job: job.jobName,
        vendor: b.vendor || b.label,
        cost: b.cost,
        status: b.status,
        onAnInvoice: b.invoiced,
      });
    }
  }
  return { vendor, matches: hits.length, bills: hits };
}

/** The learned baselines, or a plain statement that there aren't any yet. */
export function normsSummary(payload: ReviewPayload) {
  const n = payload.evidence.norms;
  if (!n) {
    return {
      available: false,
      note: "No baselines yet — the review needs a few months of history before it knows what normal looks like. Do not infer anything from their absence.",
    };
  }
  return {
    available: true,
    monthsOfHistory: n.monthsOfHistory,
    customers: n.customers.map((c) => ({
      customer: c.name,
      typicalMarkupPercent: Number(((c.typicalMarkup - 1) * 100).toFixed(1)),
      monthsBilled: c.monthsSeen,
      typicalMonthlyPrice: c.typicalMonthlyPrice,
    })),
    vendors: n.vendors.slice(0, 40).map((v) => ({
      vendor: v.name,
      monthsBilledIn: v.monthsSeen,
      ofMonths: v.monthsOfHistory,
      typicalMonthlyCost: v.typicalMonthlyCost,
    })),
  };
}

// ---------------------------------------------------------------------------
// The tool surface handed to the model.
// ---------------------------------------------------------------------------

/**
 * Build the tools for one review.
 *
 * `record` is called every time Claude reaches a verdict. Collecting verdicts
 * through a TOOL rather than parsing them out of a final block means a run that
 * stops early still yields everything it decided before it stopped, and there
 * is no giant JSON blob to fail to parse.
 */
export function buildInvestigateTools(
  payload: ReviewPayload,
  cfg: PaveConfig | null,
  record: (d: DispositionInput) => void,
): InvestigateTool[] {
  return [
    {
      name: "get_finding_context",
      description:
        "Everything known about ONE finding: what the check said, how long it has been " +
        "showing up, and the full picture of the job it sits on (its invoices, its bills, " +
        "its backup folder). Start here for any finding you intend to judge.",
      input_schema: {
        type: "object",
        properties: { key: { type: "string", description: "The finding's key." } },
        required: ["key"],
        additionalProperties: false,
      },
      handler: async (input) => findingContext(payload, String(input.key ?? "")),
    },
    {
      name: "search_backup_by_amount",
      description:
        "Search EVERY job's filed backup PDFs this month for one that totals a given " +
        "amount. The usual cause of missing backup is a PDF filed under the wrong job, and " +
        "this is how you find it. Use it on any backup-missing finding before judging it.",
      input_schema: {
        type: "object",
        properties: {
          amount: { type: "number", description: "The dollar amount to look for." },
        },
        required: ["amount"],
        additionalProperties: false,
      },
      handler: async (input) => searchBackupByAmount(payload, Number(input.amount ?? 0)),
    },
    {
      name: "find_bills_by_vendor",
      description:
        "Every bill from a vendor this month, across all jobs, whatever their spelling. " +
        "Use it to check whether a bill said to be missing is actually filed under a " +
        "different job, or a different spelling of the vendor's name.",
      input_schema: {
        type: "object",
        properties: {
          vendor: { type: "string", description: "Part of the vendor's name." },
        },
        required: ["vendor"],
        additionalProperties: false,
      },
      handler: async (input) => billsByVendor(payload, String(input.vendor ?? "")),
    },
    {
      name: "get_norms",
      description:
        "The baselines learned from past months — each customer's usual markup, and how " +
        "often each vendor bills. Use it to judge whether something is unusual for THIS " +
        "customer or vendor rather than unusual in general.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => normsSummary(payload),
    },
    {
      name: "get_bill_detail",
      description:
        "Open one vendor bill in JobTread and read its lines and attached files. This is " +
        "the only tool that leaves the month's evidence. Use it sparingly — mainly to " +
        "confirm whether one half of a suspected double-bill is really a credit.",
      input_schema: {
        type: "object",
        properties: {
          doc_id: { type: "string", description: "The JobTread document id of the bill." },
        },
        required: ["doc_id"],
        additionalProperties: false,
      },
      handler: async (input) => {
        if (!cfg) throw new Error("JobTread is not configured, so a bill cannot be opened.");
        const bill = await getBillDetail(cfg, String(input.doc_id ?? ""));
        return {
          vendor: bill.header.fromName ?? bill.header.subject ?? "",
          invoiceNumber: bill.header.externalId ?? bill.header.number ?? "",
          issueDate: bill.header.issueDate ?? "",
          status: bill.header.status ?? "",
          cost: bill.header.cost ?? 0,
          // A negative cost is the tell for a credit — which is the usual
          // benign explanation for a bill that looks double-billed.
          lines: bill.lines.map((l) => ({
            name: l.name ?? "",
            cost: l.cost ?? 0,
            code: l.costCode?.number ?? "",
          })),
          attachedFiles: bill.files.length,
        };
      },
    },
    {
      name: "record_disposition",
      description:
        "Record your verdict on one finding. Call this once per finding you judge. " +
        "Verdicts: 'confirmed' — this is a real problem, act on it. 'probably-fine' — you " +
        "found a benign explanation; say what it is. 'needs-human' — it cannot be settled " +
        "from here and someone must look. A verdict never hides a finding; it only tells " +
        "the office where to start.",
      input_schema: {
        type: "object",
        properties: {
          key: { type: "string", description: "The finding's key." },
          verdict: {
            type: "string",
            enum: ["confirmed", "probably-fine", "needs-human"],
            description: "Your judgement.",
          },
          why: {
            type: "string",
            description:
              "One or two sentences. Say what you checked and what it showed — not what the check already said.",
          },
          suggested_action: {
            type: "string",
            description: "What to do about it, if you have a concrete suggestion. May be empty.",
          },
        },
        required: ["key", "verdict", "why"],
        additionalProperties: false,
      },
      handler: async (input) => {
        const key = String(input.key ?? "").trim();
        const verdict = String(input.verdict ?? "");
        if (!key) throw new Error("A disposition needs the finding's key.");
        if (!VERDICTS.has(verdict)) {
          throw new Error(`verdict must be one of: ${[...VERDICTS].join(", ")}`);
        }
        // Refuse a verdict on a finding that is not in this review — the model
        // inventing a key would otherwise silently produce a disposition
        // attached to nothing.
        if (!payload.findings.some((f) => f.key === key)) {
          throw new Error(`No finding in this review has the key "${key}".`);
        }
        record({
          key,
          verdict: verdict as DispositionInput["verdict"],
          why: String(input.why ?? "").trim().slice(0, 2000),
          suggestedAction: String(input.suggested_action ?? "").trim().slice(0, 1000),
        });
        return { recorded: key };
      },
    },
  ];
}

/** The compact finding list Claude is given up front, worst first. */
export function findingDigest(findings: Finding[], limit: number) {
  return findings.slice(0, limit).map((f) => ({
    key: f.key,
    kind: f.kind,
    severity: f.severity,
    title: f.title,
    customer: f.customerName,
    job: f.jobName,
    amount: f.amount,
  }));
}
