import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

/**
 * The notes card's read — proxy to Apps Script `invoicingNotes`.
 *
 *   GET ?ym=YYYY-MM → { ok, jobs: [{ jtJobId, jobLabel, customerLabel, include,
 *                       invoiceNumber, invoices, note }] }
 *
 * Not `GET /api/invoicing-summary`: that returns the whole month and then reads
 * every invoice's payment and email state live from JobTread, which the card
 * does not show. This route skips both. Apps Script answers the job list from
 * its cached month and the notes from the "Invoicing Summary" tab. Saves still
 * go through `POST /api/invoicing-summary` (`op: "save"`).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET(req: NextRequest) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(req.nextUrl.searchParams.get("ym") ?? "").trim());
  const year = m ? Number(m[1]) : 0;
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "ym must look like 2026-08." }, { status: 400 });
  }
  const res = await callAppsScript<Record<string, unknown>>(
    { action: "invoicingNotes", month, year },
    { timeoutMs: 200_000 },
  );
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  if (res.data?.ok !== true) {
    return NextResponse.json({ error: String(res.data?.error || "The notes could not be read.") }, { status: 502 });
  }
  return NextResponse.json(res.data);
}
