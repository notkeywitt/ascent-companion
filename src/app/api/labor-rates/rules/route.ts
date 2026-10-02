import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { deletePayTypeRule, listPayTypeRules, savePayTypeRule } from "@/lib/payTypeRules";

/**
 * Pay-type rules CRUD for /labor-rates — employee + job + cost code → pay type.
 * DB only, no JobTread write. Office/admin-gated by the `labor-rates` view's
 * `/api/labor-rates` prefix (lib/views).
 *
 *   GET                 → { rules }
 *   POST { jtUserId, jobId, jobName, costCode, payType } → { rule }  (upsert on the set)
 *   DELETE ?id=         → { ok }
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rules: await listPayTypeRules() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rule = {
    jtUserId: String(body.jtUserId ?? "").trim(),
    jobId: String(body.jobId ?? "").trim(),
    jobName: String(body.jobName ?? "").trim(),
    costCode: String(body.costCode ?? "").trim(),
    payType: String(body.payType ?? "").trim(),
  };
  if (!rule.jtUserId || !rule.jobId || !rule.payType) {
    return NextResponse.json({ error: "Pick an employee, a job and a pay type." }, { status: 400 });
  }
  const session = await auth();
  return NextResponse.json({ rule: await savePayTypeRule(rule, session?.user?.email ?? "") });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  await deletePayTypeRule(id);
  return NextResponse.json({ ok: true });
}
