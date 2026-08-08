import { NextRequest, NextResponse } from "next/server";
import {
  createVendorBill,
  findBillByExternalId,
  getJobBudget,
  getJobHeaderInfo,
  getVendors,
  type BudgetItem,
  type NewBillLine,
} from "@/lib/jobtread";
import { computeLineTaxability } from "@/lib/billing";
import { orderExternalId } from "@/lib/amazonImport";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { kickJtSync } from "@/lib/appsScript";

/**
 * Amazon Business import — batch-create vendor bills from a monthly order report.
 *
 * GET  ?jobIds=a,b,c   → each job's budget leaves (cost-code dropdown options).
 * POST { vendorId, orders[] } → create one DRAFT vendor bill per order.
 *
 * The heavy lifting (CSV parse, grouping, per-order job/cost-code/billing-month
 * choices) happens in the browser; POST receives the finished selections. Each
 * order becomes a bill exactly like /api/add-bill's create path — same tax-safe
 * createVendorBill, same idempotency (findBillByExternalId), same writes gate —
 * only the source is a CSV row instead of a Gemini extraction, and the coding is
 * the user's up-front pick instead of an AI guess.
 */

const MAX_ORDERS = 200;
const MAX_JOBS = 40;

/** Last calendar day of a 1-based month → yyyy-MM-dd (the non-Sunset issue date). */
function lastDayIso(year: number, month: number): string {
  const d = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---- GET: cost-code options per job ---------------------------------------
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const ids = [
    ...new Set(
      (req.nextUrl.searchParams.get("jobIds") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) return NextResponse.json({ budgets: {} });
  if (ids.length > MAX_JOBS) {
    return NextResponse.json({ error: `Too many jobs (max ${MAX_JOBS}).` }, { status: 400 });
  }

  const cfg = getPaveConfig();
  const budgets: Record<string, BudgetItem[]> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    ids.map(async (jobId) => {
      try {
        budgets[jobId] = await getJobBudget(cfg, jobId);
      } catch (e) {
        errors[jobId] = e instanceof Error ? e.message : "Unknown error";
      }
    }),
  );
  return NextResponse.json({ budgets, errors });
}

// ---- POST: batch-create bills ---------------------------------------------
interface OrderInput {
  orderId: string;
  jobId: string;
  costCode?: string; // CSI number; resolved to a jobCostItemId against the job budget
  billingMonth: number; // 1..12
  billingYear: number;
  lines: { name: string; unitCost: number; quantity: number }[];
  tax?: number; // order-level tax → nonRecoverableTax
  amount?: number; // net total, for the response summary only
}

interface OrderResult {
  orderId: string;
  status: "created" | "exists" | "skipped" | "failed" | "preview";
  docId?: string;
  jobName?: string;
  amount?: number;
  coded?: boolean;
  message?: string;
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }

  let body: { vendorId?: string; orders?: OrderInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const vendorId = String(body.vendorId ?? "").trim();
  const orders = Array.isArray(body.orders) ? body.orders : [];
  if (!vendorId) return NextResponse.json({ error: "Pick the Amazon vendor first." }, { status: 400 });
  if (orders.length === 0) return NextResponse.json({ error: "No orders to create." }, { status: 400 });
  if (orders.length > MAX_ORDERS) {
    return NextResponse.json({ error: `Too many orders (max ${MAX_ORDERS}).` }, { status: 400 });
  }

  const cfg = getPaveConfig();

  // Confirm the vendor account exists and get its display name.
  let vendorName = "Amazon";
  try {
    const vendors = await getVendors(cfg);
    const v = vendors.find((x) => x.id === vendorId);
    if (!v) return NextResponse.json({ error: "Unknown vendor id." }, { status: 400 });
    vendorName = v.name;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't load vendors." },
      { status: 502 },
    );
  }

  // Resolve each distinct job's budget + header ONCE, then reuse across its orders.
  const jobIds = [...new Set(orders.map((o) => o.jobId).filter(Boolean))];
  const codeMaps = new Map<string, Map<string, string>>(); // jobId → (CSI → jobCostItemId)
  const jobInfo = new Map<string, { name: string; address: string }>();
  await Promise.all(
    jobIds.map(async (jobId) => {
      try {
        const [budget, header] = await Promise.all([
          getJobBudget(cfg, jobId),
          getJobHeaderInfo(cfg, jobId),
        ]);
        const map = new Map<string, string>();
        for (const b of budget) if (!map.has(b.number)) map.set(b.number, b.id);
        codeMaps.set(jobId, map);
        jobInfo.set(jobId, { name: header.name || "", address: header.address || "" });
      } catch {
        // leave unset → the order fails cleanly below with a message
      }
    }),
  );

  const preview = !writesEnabled();
  const results: OrderResult[] = [];

  for (const o of orders) {
    const orderId = String(o.orderId ?? "").trim();
    const jobId = String(o.jobId ?? "").trim();
    const amount = Number(o.amount) || 0;
    const info = jobInfo.get(jobId);
    const jobName = info?.name ?? "";

    if (!orderId || !jobId) {
      results.push({ orderId, status: "failed", amount, message: "Missing order id or job." });
      continue;
    }
    if (!codeMaps.has(jobId)) {
      results.push({ orderId, status: "failed", amount, jobName, message: "Couldn't load that job's budget." });
      continue;
    }

    const codeMap = codeMaps.get(jobId)!;
    const costCode = String(o.costCode ?? "").trim();
    const jobCostItemId = costCode ? codeMap.get(costCode) : undefined;
    const codedNote = costCode && !jobCostItemId ? " (cost code not in this job's budget — left uncoded)" : "";

    const { lineIsTaxable, taxAmount } = computeLineTaxability(o.tax);
    const rawLines = Array.isArray(o.lines) ? o.lines : [];
    let lines: NewBillLine[] = rawLines.map((l) => ({
      name: String(l.name ?? "Amazon item"),
      description: costCode,
      unitCost: Number(l.unitCost) || 0,
      quantity: Number(l.quantity) || 1,
      isTaxable: lineIsTaxable,
      jobCostItemId,
      costCode: costCode || undefined,
    }));
    if (lines.length === 0) {
      lines = [
        {
          name: `Amazon ${orderId}`,
          description: costCode,
          unitCost: amount - taxAmount,
          quantity: 1,
          isTaxable: lineIsTaxable,
          jobCostItemId,
          costCode: costCode || undefined,
        },
      ];
    }

    const externalId = orderExternalId(orderId);
    const issueDate = lastDayIso(o.billingYear, o.billingMonth);
    const coded = Boolean(jobCostItemId);

    if (preview) {
      results.push({
        orderId,
        status: "preview",
        jobName,
        amount,
        coded,
        message: `Would create ${lines.length} line(s), issue ${issueDate}${codedNote}.`,
      });
      continue;
    }

    // Idempotency — fail CLOSED so a hiccup never double-creates.
    let existing: string | null;
    try {
      existing = await findBillByExternalId(cfg, vendorId, externalId);
    } catch {
      results.push({
        orderId,
        status: "failed",
        jobName,
        amount,
        message: "Couldn't check for an existing bill — skipped to avoid a duplicate.",
      });
      continue;
    }
    if (existing) {
      results.push({ orderId, status: "exists", docId: existing, jobName, amount, coded });
      continue;
    }

    try {
      const { id: docId } = await createVendorBill(cfg, {
        jobId,
        accountId: vendorId,
        vendorName,
        subject: `${jobName || "Amazon"} - ${vendorName} - ${orderId}`,
        externalId,
        issueDate,
        dueDays: 30,
        taxAmount,
        // JobTread requires a location name or address on the bill. Pass the job's
        // name (and address when it has one) — an overhead job like "Ascent - Shop"
        // has a name but no street address, so name alone satisfies it.
        jobLocationName: jobName || undefined,
        jobLocationAddress: info?.address || undefined,
        lines,
      });
      results.push({
        orderId,
        status: "created",
        docId,
        jobName,
        amount,
        coded,
        message: codedNote ? codedNote.trim() : undefined,
      });
    } catch (e) {
      results.push({
        orderId,
        status: "failed",
        jobName,
        amount,
        message: e instanceof Error ? e.message : "createDocument failed.",
      });
    }
  }

  // Nudge the Apps Script full sync once so the new bills mirror into the sheet +
  // Drive within a minute or two. Fire-and-forget, fail-safe (hourly sync backstops).
  let syncKicked = false;
  const created = results.filter((r) => r.status === "created").length;
  if (!preview && created > 0) {
    syncKicked = (await kickJtSync()) === true;
  }

  return NextResponse.json({
    wrote: !preview,
    previewed: preview,
    vendorName,
    syncKicked,
    counts: {
      created,
      exists: results.filter((r) => r.status === "exists").length,
      failed: results.filter((r) => r.status === "failed").length,
      preview: results.filter((r) => r.status === "preview").length,
    },
    results,
  });
}
