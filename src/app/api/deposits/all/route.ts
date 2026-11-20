import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { readAllDeposits } from "@/lib/depositRead";

/**
 * EVERY JOB'S DEPOSIT — one line per job with a deposit: deposit, applied to
 * date, left. Read-only. Gated by the `recode` view's "/api/deposits" prefix.
 * Rules: src/lib/deposits.ts (`summarizeDeposit`).
 */
export async function GET() {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  try {
    return NextResponse.json({ jobs: await readAllDeposits() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
