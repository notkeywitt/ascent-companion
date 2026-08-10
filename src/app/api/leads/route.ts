import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { eq, inArray } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { leads as leadsTable } from "@/db/schema";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getLeads, type LeadJt } from "@/lib/leads";

/**
 * The leads board: JobTread's "New Lead" customers, joined with the Companion's
 * own tracking row for each.
 *
 * READ-ONLY against JobTread. The PATCH here writes the tracking row in the
 * Companion DB only — advancing a lead out of "New Lead" is still a JobTread
 * edit, and this list follows it on the next cache window.
 */

const STAGES = ["new", "contacted", "site_visit", "estimating", "proposal_sent"] as const;

/**
 * The JT half is cached in Next's Data Cache (shared + cold-start-proof, same
 * pattern as /api/jobs): a lead list is a handful of Pave calls and the Status
 * custom field is a human edit in JobTread, not something we write. 5 min.
 * The DB half is read fresh every request so a save shows up immediately.
 */
const getCachedLeads = unstable_cache(() => getLeads(getPaveConfig()), ["api-leads"], {
  revalidate: 300,
  tags: ["jt-leads"],
});

interface Tracking {
  stage: string;
  nextAction: string;
  nextActionDate: string;
  lastContactDate: string;
  estValue: string;
  notes: string;
  updatedAt: string;
}

const BLANK: Tracking = {
  stage: "new",
  nextAction: "",
  nextActionDate: "",
  lastContactDate: "",
  estValue: "",
  notes: "",
  updatedAt: "",
};

// GET /api/leads — every New Lead customer + its tracking row.
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const jt: LeadJt[] = await getCachedLeads();
    await ensureDb();
    // Only the rows for leads currently in JobTread — a stale row for an account
    // that has moved on stays in the table but never reaches the page.
    const ids = jt.map((l) => l.id);
    const rows = ids.length
      ? await db.select().from(leadsTable).where(inArray(leadsTable.accountId, ids))
      : [];
    const byId = new Map(rows.map((r) => [r.accountId, r]));

    const out = jt.map((l) => {
      const t = byId.get(l.id);
      return {
        ...l,
        tracking: t
          ? {
              stage: t.stage,
              nextAction: t.nextAction,
              nextActionDate: t.nextActionDate,
              lastContactDate: t.lastContactDate,
              estValue: t.estValue,
              notes: t.notes,
              updatedAt: t.updatedAt,
            }
          : BLANK,
      };
    });
    return NextResponse.json({ leads: out });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// PATCH /api/leads — upsert one lead's tracking row.
// Body: { accountId, stage?, nextAction?, nextActionDate?, lastContactDate?, estValue?, notes? }
// Only the keys PRESENT in the body are written, so a partial save from one
// control can't blank the fields it didn't touch.
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const accountId = String(body.accountId ?? "").trim();
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });

  const patch: Partial<Tracking> = {};
  const str = (k: keyof Tracking, v: unknown) => {
    if (v !== undefined) patch[k] = String(v ?? "").trim();
  };
  str("stage", body.stage);
  str("nextAction", body.nextAction);
  str("nextActionDate", body.nextActionDate);
  str("lastContactDate", body.lastContactDate);
  str("estValue", body.estValue);
  str("notes", body.notes);
  if (patch.stage && !(STAGES as readonly string[]).includes(patch.stage)) {
    return NextResponse.json({ error: `Unknown stage "${patch.stage}"` }, { status: 400 });
  }

  await ensureDb();
  const now = new Date().toISOString();
  await db
    .insert(leadsTable)
    .values({ accountId, ...BLANK, ...patch, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: leadsTable.accountId,
      set: { ...patch, updatedAt: now },
    });
  const [row] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.accountId, accountId));
  return NextResponse.json({ tracking: row });
}
