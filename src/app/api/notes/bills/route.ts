import { NextRequest, NextResponse } from "next/server";
import { listBillsForPicker } from "@/lib/billSearch";

/**
 * The bills a note can be linked to (Notes' bill picker).
 *
 *   GET ?jobId=&q=  → { bills }   JobTread bills from the local bill index,
 *                                 newest first; `q` matches vendor or invoice #
 *
 * Read-only, from the index — no JobTread call. Gated by the "jobs-hub" view
 * (the path sits under /api/notes), so a note writer needs no "bill-search".
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const jobId = q.get("jobId")?.trim() ?? "";
  if (jobId && !/^[A-Za-z0-9]{6,32}$/.test(jobId))
    return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  try {
    return NextResponse.json({ bills: await listBillsForPicker({ q: q.get("q") ?? "", jobId }) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not load bills." },
      { status: 500 },
    );
  }
}
