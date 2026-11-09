import { NextResponse } from "next/server";
import { getLswddStatementBills } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// No request input, so Next would otherwise prerender this at build time.
export const dynamic = "force-dynamic";

/**
 * Read-only: the newest LSWDD statement's bills in JobTread, each with its pay
 * state (draft / approved / paid), and the statement's due date. Read by the
 * /lswdd page's bill list and by the app-wide pay reminder. Gated by the
 * `lswdd` view's `/api/lswdd` prefix.
 *
 * GET → { statementDate, dueDate, bills[] }
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    return NextResponse.json(await getLswddStatementBills(getPaveConfig()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
