import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { listMisses, markMissAddressed, recordMiss } from "@/lib/invoiceReview/misses";

/**
 * The miss log — billing mistakes the review did NOT catch.
 *
 * GET   → the log, newest first.
 * POST  { description, ... }      → file one.
 * POST  { id, addressed: true }   → mark one addressed (a check now catches it).
 *
 * This is the most valuable thing the office can give the review, and the only
 * input a genuinely new check can come from — see misses.ts. Everything here
 * writes to the companion DB only; nothing reaches JobTread, Drive or Gmail.
 *
 * Gated by the `invoice-review` view in middleware, same as the review itself:
 * whoever can see the month's billing can say what it got wrong.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ misses: await listMisses() });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const who = session?.user?.email ?? "";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  try {
    if (body.addressed) {
      const id = Number(body.id);
      if (!Number.isFinite(id)) {
        return NextResponse.json({ error: "Pass the miss's id." }, { status: 400 });
      }
      await markMissAddressed(id, String(body.note ?? ""));
      return NextResponse.json({ ok: true });
    }

    const id = await recordMiss({
      description: String(body.description ?? ""),
      ym: String(body.ym ?? ""),
      amount: Number(body.amount ?? 0),
      jobId: String(body.jobId ?? ""),
      jobName: String(body.jobName ?? ""),
      customerName: String(body.customerName ?? ""),
      invoiceId: String(body.invoiceId ?? ""),
      howCaught: String(body.howCaught ?? ""),
      shouldHaveBeenCaughtBy: String(body.shouldHaveBeenCaughtBy ?? ""),
      by: who,
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 400 },
    );
  }
}
