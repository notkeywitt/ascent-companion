import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  deleteCostCodeDefault,
  deletePayTypeRule,
  listCostCodeDefaults,
  listPayTypeRules,
  saveCostCodeDefault,
  savePayTypeRule,
} from "@/lib/payTypeRules";

/**
 * Pay-type rules CRUD for /labor-rates — employee + job + cost code → pay type.
 * DB only, no JobTread write. Office/admin-gated by the `labor-rates` view's
 * `/api/labor-rates` prefix (lib/views).
 *
 * Also the default cost codes (employee + job → cost code), as `kind: "code"`.
 *
 *   GET                 → { rules, codeDefaults }
 *   POST { jtUserId, jobId, jobName, costCode, payType } → { rule }  (upsert on the set)
 *   POST { kind:"code", jtUserId, jobId, jobName, costCode } → { codeDefault }  (upsert on employee + job)
 *   DELETE ?id=[&kind=code] → { ok }
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const [rules, codeDefaults] = await Promise.all([listPayTypeRules(), listCostCodeDefaults()]);
  return NextResponse.json({ rules, codeDefaults });
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
  const session = await auth();
  if (body.kind === "code") {
    if (!rule.jtUserId || !rule.jobId || !rule.costCode) {
      return NextResponse.json({ error: "Pick an employee, a job and a cost code." }, { status: 400 });
    }
    const { jtUserId, jobId, jobName, costCode } = rule;
    return NextResponse.json({
      codeDefault: await saveCostCodeDefault({ jtUserId, jobId, jobName, costCode }, session?.user?.email ?? ""),
    });
  }
  if (!rule.jtUserId || !rule.jobId || !rule.payType) {
    return NextResponse.json({ error: "Pick an employee, a job and a pay type." }, { status: 400 });
  }
  return NextResponse.json({ rule: await savePayTypeRule(rule, session?.user?.email ?? "") });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  if (req.nextUrl.searchParams.get("kind") === "code") await deleteCostCodeDefault(id);
  else await deletePayTypeRule(id);
  return NextResponse.json({ ok: true });
}
