import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { liftRuling, recordRuling } from "@/lib/invoiceReview/rulings";
import type { FindingKind } from "@/lib/invoiceReview/types";

/**
 * "It's OK" on an Invoice Status card's Fix sheet — for everyone.
 *
 *   POST { key, kind, jobId }            → rule THIS finding OK
 *   POST { key, lift: true }             → bring it back
 *
 * Always scope "finding": the ruling covers this one finding key (one bill, one
 * file, one job's check) and nothing wider, so a later finding of the same kind
 * still shows. Every review and job check applies standing rulings
 * (`applyRulings`), so the finding is hidden for every user on their next check.
 * Writes the companion database only; no JobTread write. Gated by the
 * "invoicing-summary" view (lib/views.ts).
 */
const REASON = "Marked OK from Invoice Status.";

export async function POST(req: NextRequest) {
  const who = (await auth())?.user?.email ?? "";
  if (!who) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { key?: string; kind?: string; jobId?: string; lift?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const key = String(body.key ?? "").trim();
  if (!key) return NextResponse.json({ error: "Pass the finding's key." }, { status: 400 });

  try {
    if (body.lift) {
      await liftRuling(key);
      return NextResponse.json({ ok: true, lifted: key });
    }
    const kind = String(body.kind ?? "").trim();
    if (!kind) return NextResponse.json({ error: "Pass the finding's kind." }, { status: 400 });
    await recordRuling({
      key,
      kind: kind as FindingKind,
      jobId: String(body.jobId ?? "").trim(),
      scope: "finding",
      reason: REASON,
      by: who,
    });
    return NextResponse.json({ ok: true, key });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
