import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { eq, inArray } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { leadInquiries, leads as leadsTable, type LeadInquiry } from "@/db/schema";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getLeads, type LeadJt } from "@/lib/leads";

/**
 * The leads board: JobTread's "New Lead" customers PLUS the leads logged here
 * without JobTread, each joined with the Companion's own tracking row.
 *
 * READ-ONLY against JobTread. The PATCH here writes the tracking row in the
 * Companion DB only — advancing a lead out of "New Lead" is still a JobTread
 * edit, and this list follows it on the next cache window.
 *
 * Two sources, one list:
 *  • a JobTread "New Lead" customer — the original board, unchanged. If it grew
 *    out of an intake form logged here, those answers ride along as `inquiry`.
 *  • an inquiry not yet pushed (`lead_inquiries` with no jt_account_id) — shaped
 *    to look like a JobTread lead so the board's staleness and next-action
 *    sorting treat it identically, and marked `local` so the UI can offer the
 *    push (and say plainly that JobTread hasn't got it yet).
 * A pushed inquiry is deliberately NOT emitted from here — its JobTread account
 * is, so there is exactly one card per lead.
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

/** The intake answers, as the page reads them back. */
function toInquiry(row: LeadInquiry) {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    contactMethod: row.contactMethod,
    residency: row.residency,
    address: row.address,
    services: row.services,
    projectDetails: row.projectDetails,
    designStatus: row.designStatus,
    budget: row.budget,
    startDate: row.startDate,
    targetDate: row.targetDate,
    leadSource: row.leadSource,
    customerType: row.customerType,
    notes: row.notes,
    name: row.name,
    loggedBy: row.createdBy,
    loggedAt: row.createdAt,
    jtAccountId: row.jtAccountId,
    pushedAt: row.pushedAt,
  };
}

/** An un-pushed inquiry, wearing the shape of a JobTread lead. */
function asLead(row: LeadInquiry): LeadJt {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    source: row.leadSource,
    customerType: row.customerType,
    notes: row.notes,
    address: row.address,
    primaryContact:
      row.email || row.phone
        ? { id: `${row.id}_contact`, name: row.name, title: "", email: row.email, phone: row.phone }
        : null,
    contacts: [],
    // Nothing in JobTread yet, so there is nothing to have.
    jobs: [],
    tasks: [],
  };
}

// GET /api/leads — every New Lead customer and every locally-logged lead, each
// with its tracking row.
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const jt: LeadJt[] = await getCachedLeads();
    await ensureDb();
    const inquiries = await db.select().from(leadInquiries);
    // A pushed inquiry is represented by its JobTread account; its answers hang
    // off that card rather than making a second one.
    const inquiryByAccount = new Map(
      inquiries.filter((i) => i.jtAccountId).map((i) => [i.jtAccountId, i]),
    );
    const localLeads = inquiries.filter((i) => !i.jtAccountId);

    // Only the rows for leads on the board — a stale row for an account that has
    // moved on stays in the table but never reaches the page. Local leads key
    // their tracking on the inquiry id, so both kinds are looked up together.
    const ids = [...jt.map((l) => l.id), ...localLeads.map((i) => i.id)];
    const rows = ids.length
      ? await db.select().from(leadsTable).where(inArray(leadsTable.accountId, ids))
      : [];
    const byId = new Map(rows.map((r) => [r.accountId, r]));

    const trackingFor = (id: string): Tracking => {
      const t = byId.get(id);
      return t
        ? {
            stage: t.stage,
            nextAction: t.nextAction,
            nextActionDate: t.nextActionDate,
            lastContactDate: t.lastContactDate,
            estValue: t.estValue,
            notes: t.notes,
            updatedAt: t.updatedAt,
          }
        : BLANK;
    };

    const out = [
      ...jt.map((l) => {
        const inq = inquiryByAccount.get(l.id);
        return {
          ...l,
          local: false,
          inquiry: inq ? toInquiry(inq) : null,
          tracking: trackingFor(l.id),
        };
      }),
      ...localLeads.map((i) => ({
        ...asLead(i),
        local: true,
        inquiry: toInquiry(i),
        tracking: trackingFor(i.id),
      })),
    ];
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
