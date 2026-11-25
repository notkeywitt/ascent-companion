import { NextRequest, NextResponse } from "next/server";
import { billHandwritingFor } from "@/lib/billHandwriting";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Which of these bills carry a handwritten invoice (src/lib/billHandwriting.ts).
 *
 *   POST { docIds } → { handwritten: docId[], pending }
 *
 * Looks at a few new bills per call; `pending` > 0 means call again. Writes only
 * the companion's own cache, never JobTread, so it runs with writes off too.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const docIds = Array.isArray(body.docIds) ? body.docIds.filter((d): d is string => typeof d === "string") : [];
  try {
    return NextResponse.json(await billHandwritingFor(getPaveConfig(), docIds));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
