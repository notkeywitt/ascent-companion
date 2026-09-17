import { NextRequest, NextResponse } from "next/server";
import { extractAmazonOrderWithClaude, type ExtractedAmazonOrder } from "@/lib/claudeExtract";
import { reconcileGap, type AmazonOrder } from "@/lib/amazonImport";

/**
 * Amazon import, PDF source — read a BATCH of "Printable Order Summary" pages
 * into the same `AmazonOrder[]` the monthly CSV report parses to.
 *
 * WHY: the CSV only exists for orders placed on the Business account, and only
 * once the month's report is exported. The per-order summary is what the office
 * actually saves at the time of purchase, so it is the source that is always to
 * hand. Producing the identical shape means everything downstream — job
 * suggestion, cost coding, the `check` idempotency pre-check, and the create
 * path's per-order `findBillByExternalId` — is untouched and still guards this
 * source against duplicates.
 *
 * POST multipart/form-data, field `files` repeated → { orders, warnings }
 *
 * Read-only: nothing is written to JobTread here. The office still reviews every
 * order on the page before creating anything.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILES = 40;
const MAX_BYTES = 12 * 1024 * 1024; // per file; Claude's document limit is well under this
/** How many PDFs go to the model at once. Each is its own call. */
const CONCURRENCY = 4;

const ACCEPTED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

const money = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
};

/** MM/DD/YYYY → 1-based month/year, 0 when unparseable. */
function monthYear(dateStr: string): { month: number; year: number } {
  const m = String(dateStr ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return { month: 0, year: 0 };
  return { month: parseInt(m[1], 10), year: parseInt(m[3], 10) };
}

/** One extracted summary → the CSV parser's `AmazonOrder`, field for field. */
function toOrder(x: ExtractedAmazonOrder): AmazonOrder {
  const { month, year } = monthYear(x.orderDate);
  const lines = (Array.isArray(x.lines) ? x.lines : []).map((l) => {
    const quantity = Number(l.quantity) > 0 ? Number(l.quantity) : 1;
    const ppu = money(l.ppu);
    return {
      title: String(l.title ?? "").trim() || "Amazon item",
      asin: "",
      quantity,
      ppu,
      subtotal: money(ppu * quantity),
      tax: 0,
      netTotal: money(ppu * quantity),
      category: "",
      seller: "",
    };
  });
  return {
    orderId: String(x.orderId ?? "").trim(),
    orderDate: String(x.orderDate ?? "").trim(),
    orderMonth: month,
    orderYear: year,
    poNumber: String(x.poNumber ?? "").trim(),
    accountUser: "",
    paymentDate: String(x.paymentDate ?? "").trim(),
    cardLast4: String(x.cardLast4 ?? "").trim(),
    subtotal: money(x.subtotal),
    shipping: money(x.shipping),
    // Amazon prints a discount as a negative; normalize either sign to one.
    promotion: x.promotion ? -Math.abs(money(x.promotion)) : 0,
    tax: money(x.tax),
    netTotal: money(x.netTotal),
    lines,
    charged: x.charged !== false,
  };
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Too many files (max ${MAX_FILES} at a time).` },
      { status: 400 },
    );
  }

  const warnings: string[] = [];
  const byOrder = new Map<string, AmazonOrder>();

  // One model call per file, a few at a time. A file that fails is named and
  // skipped — one unreadable page must not cost the whole batch.
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const f = files[i];
      const name = f.name || `file ${i + 1}`;
      const type = f.type || "application/pdf";
      if (!ACCEPTED.has(type)) {
        warnings.push(`${name}: not a PDF or image — skipped.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        warnings.push(`${name}: larger than ${Math.round(MAX_BYTES / 1024 / 1024)}MB — skipped.`);
        continue;
      }
      let order: AmazonOrder | null = null;
      try {
        const extracted = await extractAmazonOrderWithClaude(
          Buffer.from(await f.arrayBuffer()),
          type,
        );
        order = extracted ? toOrder(extracted) : null;
      } catch (e) {
        warnings.push(`${name}: ${e instanceof Error ? e.message : "could not be read"}`);
        continue;
      }
      if (!order || !order.orderId) {
        warnings.push(`${name}: no Amazon order number found — skipped.`);
        continue;
      }
      // Same file twice in one batch (or the same order saved under two names)
      // is one order, not two. The bill-level guard is the externalId check;
      // this just keeps the review list honest.
      const seen = byOrder.get(order.orderId);
      if (seen) {
        warnings.push(`${name}: order ${order.orderId} was already in this batch — kept the first.`);
        continue;
      }
      if (!order.charged) {
        warnings.push(
          `${name}: order ${order.orderId} has not been charged yet (no card transaction printed) — review before creating a bill.`,
        );
      }
      const gap = reconcileGap(order);
      if (gap) {
        warnings.push(
          `${name}: order ${order.orderId} — items + shipping + promotion + tax is ${gap} off the printed total.`,
        );
      }
      byOrder.set(order.orderId, order);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  const orders = [...byOrder.values()].sort(
    (a, b) => (new Date(a.orderDate).getTime() || 0) - (new Date(b.orderDate).getTime() || 0),
  );
  return NextResponse.json({ orders, warnings });
}
