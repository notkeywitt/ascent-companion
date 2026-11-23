import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createChangeOrder, getChangeOrderForm, getChangeOrderLog } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { buildCoInput, type CoInput } from "@/lib/changeOrders";

// Change orders (src/lib/changeOrders.ts). Gated by the "change-orders" view.
//
//   GET  ?jobId=<id>      → { rows }  the log, org-wide or one job's
//   POST CoInput          → { wrote: true, id, number, url, price }
//                          | { wrote: false, previewed: true, input }  (writes off)
//
// POST creates a DRAFT customer order named "Change Order" in JobTread. The
// office reviews and sends it there.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() || undefined;
  try {
    return NextResponse.json({ rows: await getChangeOrderLog(getPaveConfig(), jobId) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: Partial<CoInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const input: CoInput = {
    jobId: String(body.jobId ?? "").trim(),
    title: String(body.title ?? ""),
    reason: String(body.reason ?? ""),
    markup: Number(body.markup),
    lines: (Array.isArray(body.lines) ? body.lines : []).map((l) => ({
      costCodeId: String(l?.costCodeId ?? ""),
      code: String(l?.code ?? ""),
      codeName: String(l?.codeName ?? ""),
      costTypeId: String(l?.costTypeId ?? ""),
      name: String(l?.name ?? ""),
      description: String(l?.description ?? ""),
      cost: Number(l?.cost),
      isTaxable: l?.isTaxable !== false,
    })),
  };
  const cfg = getPaveConfig();
  try {
    // The header is read here, never taken from the browser.
    const form = await getChangeOrderForm(cfg, input.jobId);
    const doc = buildCoInput(input, form.header);
    if (!writesEnabled()) return NextResponse.json({ wrote: false, previewed: true, input: doc });
    return NextResponse.json({ wrote: true, ...(await createChangeOrder(cfg, doc)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
