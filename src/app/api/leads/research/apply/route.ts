import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { applyFields, applyFile, discardFile } from "@/lib/leadResearch";
import type { Fact } from "@/lib/leadResearchRules";

/**
 * POST — approve a research run. Gated by the "leads" view (/api/leads).
 *
 * { runId, picks: [{ id, value }], facts, summary }
 *     WRITES the picked JobTread fields (customer, address, job) through the
 *     Clients editor's allowlisted write (clientDirectory.applyPatch),
 *     journalled, behind writesEnabled(). Saves the reviewed summary and
 *     property fields in the companion DB.
 * { fileId, action: "upload" }
 *     WRITES one file to JobTread folder "Background" (the newest job, or the
 *     customer when there is no job), behind writesEnabled().
 * { fileId, action: "discard" }
 *     drops a file; it never reaches JobTread.
 *
 * Never deletes anything in JobTread.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: {
    runId?: string;
    picks?: { id: string; value: string }[];
    facts?: Fact[];
    summary?: string;
    fileId?: string;
    action?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    if (body.fileId) {
      if (body.action === "discard") {
        await discardFile(body.fileId);
        return NextResponse.json({ ok: true });
      }
      const r = await applyFile(body.fileId);
      return NextResponse.json(r, { status: r.ok ? 200 : 502 });
    }
    const runId = String(body.runId ?? "").trim();
    if (!runId) return NextResponse.json({ error: "runId is required." }, { status: 400 });
    const session = await auth();
    const out = await applyFields(runId, session?.user?.email ?? "", {
      picks: Array.isArray(body.picks) ? body.picks.map((p) => ({ id: String(p.id), value: String(p.value ?? "") })) : [],
      facts: Array.isArray(body.facts) ? body.facts : [],
      summary: String(body.summary ?? ""),
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 422 });
  }
}
