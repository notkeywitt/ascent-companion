import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { leadActivities, leadInquiries, leads as leadsTable } from "@/db/schema";
import { normalizeInquiry, type InquiryFields } from "@/lib/leadInquiry";

/**
 * Leads logged WITHOUT JobTread — the website intake form, filled in by us.
 *
 * Nothing here touches JobTread at all: an inquiry is a Companion-owned record
 * that shows up on the leads board immediately, so a lead that phoned in this
 * morning can be tracked before anyone decides it deserves a JobTread customer.
 * Creating that customer is a separate, gated step — POST /api/leads/push.
 *
 * Editing and deleting stop the moment a lead has been pushed: from then on
 * JobTread owns it (and the answers here are kept only as the record of what was
 * asked at intake).
 */

/** A short, collision-proof id that can never be mistaken for a JobTread one. */
function newInquiryId(): string {
  return `inq_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

// GET /api/leads/inquiries — every logged inquiry, newest first.
export async function GET() {
  await ensureDb();
  const rows = await db.select().from(leadInquiries);
  rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return NextResponse.json({ inquiries: rows });
}

// POST /api/leads/inquiries — log a new lead. Only `name` is required; an intake
// call that produced nothing else is still worth having on the board.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { fields } = normalizeInquiry(body);
  if (!fields.name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }

  const session = await auth();
  const email = session?.user?.email ?? "";

  await ensureDb();
  const now = new Date().toISOString();
  const [row] = await db
    .insert(leadInquiries)
    .values({ id: newInquiryId(), ...fields, createdBy: email, createdAt: now, updatedAt: now })
    .returning();
  return NextResponse.json({ inquiry: row }, { status: 201 });
}

// PATCH /api/leads/inquiries — correct a logged lead, or mark it reviewed.
// Body: { id, ...answers } and/or { id, reviewed: true|false }.
// Only the keys PRESENT in the body are written, so a partial save can't blank an
// answer it never sent — which is also what lets "mark reviewed" send nothing else.
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await ensureDb();
  const [existing] = await db.select().from(leadInquiries).where(eq(leadInquiries.id, id));
  if (!existing) return NextResponse.json({ error: "No such lead." }, { status: 404 });
  if (existing.jtAccountId) {
    return NextResponse.json(
      { error: "This lead is in JobTread now — edit it there." },
      { status: 409 },
    );
  }

  const { fields, present } = normalizeInquiry(body);
  const patch: Partial<InquiryFields> & { reviewedAt?: string; reviewedBy?: string } = {};
  for (const key of present) patch[key] = fields[key];
  if (patch.name !== undefined && !patch.name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }

  // "Someone has looked at this" — the acknowledgement on an inquiry that
  // arrived from the website on its own. Stamped server-side from the session, so
  // the reviewer is who they actually are.
  const now = new Date().toISOString();
  if (body.reviewed !== undefined) {
    const session = await auth();
    const reviewed = body.reviewed === true || body.reviewed === "true";
    patch.reviewedAt = reviewed ? now : "";
    patch.reviewedBy = reviewed ? (session?.user?.email ?? "") : "";
  }

  const [row] = await db
    .update(leadInquiries)
    .set({ ...patch, updatedAt: now })
    .where(eq(leadInquiries.id, id))
    .returning();
  return NextResponse.json({ inquiry: row });
}

// DELETE /api/leads/inquiries?id=… — drop a lead logged by mistake, along with
// its tracking row and contact log (all keyed by the same id).
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Pass ?id=" }, { status: 400 });

  await ensureDb();
  const [existing] = await db.select().from(leadInquiries).where(eq(leadInquiries.id, id));
  if (!existing) return NextResponse.json({ error: "No such lead." }, { status: 404 });
  if (existing.jtAccountId) {
    return NextResponse.json(
      { error: "This lead is in JobTread now — it can't be deleted here." },
      { status: 409 },
    );
  }

  await db.delete(leadInquiries).where(eq(leadInquiries.id, id));
  await db.delete(leadsTable).where(eq(leadsTable.accountId, id));
  await db.delete(leadActivities).where(eq(leadActivities.accountId, id));
  return NextResponse.json({ deleted: true });
}
