import { NextRequest, NextResponse } from "next/server";
import { readJournal, MAX_JOURNAL_PAGE } from "@/lib/financialJournal";

/**
 * Read the FINANCIAL JOURNAL — every write the app has made to a money record.
 *
 * READ-ONLY, and there is deliberately no POST, PATCH or DELETE here. The
 * journal is written only as a side effect of the write it describes; an
 * endpoint that could add or amend a row would make the whole table arguable.
 *
 * Filters (all optional, combined with AND):
 *   ?docId=…     everything about one bill or invoice
 *   ?jobId=…     everything on one job
 *   ?actor=…     everything one person did
 *   ?beforeId=…  paging: rows older than this id
 *   ?limit=…     capped at MAX_JOURNAL_PAGE
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const limitRaw = Number(p.get("limit"));
  const beforeIdRaw = Number(p.get("beforeId"));
  const rows = await readJournal({
    docId: p.get("docId")?.trim() || undefined,
    jobId: p.get("jobId")?.trim() || undefined,
    actor: p.get("actor")?.trim() || undefined,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
    beforeId: Number.isFinite(beforeIdRaw) && beforeIdRaw > 0 ? beforeIdRaw : undefined,
  });
  return NextResponse.json({
    rows,
    // The cursor for the next page, or null at the end of the list.
    nextBeforeId: rows.length ? rows[rows.length - 1].id : null,
    pageSize: MAX_JOURNAL_PAGE,
  });
}
