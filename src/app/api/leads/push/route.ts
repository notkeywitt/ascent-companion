import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { leadActivities, leadInquiries, leads as leadsTable } from "@/db/schema";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import type { InquiryFields } from "@/lib/leadInquiry";
import { diffFields, openJournal } from "@/lib/financialJournal";
import {
  buildConnectPlan,
  buildLeadPushPlan,
  connectLeadToCustomer,
  findCustomersByName,
  pushLeadToJobTread,
} from "@/lib/leadPush";

/**
 * POST /api/leads/push — turn a Companion-logged lead into a JobTread customer.
 * Body: { inquiryId, dryRun?, force?, existingAccountId? }
 *
 * With `existingAccountId` the lead is CONNECTED to that customer instead of
 * creating one (see connectLeadToCustomer): its Status becomes "New Lead" and the
 * intake answers are appended to its Notes. The same-name check is skipped — the
 * person already chose which customer it is.
 *
 * The only write in the leads feature, and a purpose-built route rather than the
 * generic /api/pave gateway (which ships default-off) — same shape as the other
 * bespoke write routes: `writesEnabled()` decides, and a closed gate returns the
 * plan instead of performing it, so the office can see exactly what a push would
 * send.
 *
 * Three guards, because creating a duplicate customer in the live org is the one
 * mistake here that someone has to clean up by hand:
 *   • already pushed  → 409 with the existing account id. `jt_account_id` is the
 *     idempotency key; a double-tap can't create a second customer.
 *   • same name in JobTread → 409 listing the matches, until `force: true`. A
 *     manual intake list plus the website form makes double-entry easy.
 *   • step 1 recorded before steps 2-4 run (see lib/leadPush) → a half-finished
 *     push leaves a customer the Companion still knows about, not an orphan.
 *
 * On success the lead's follow-up history is RE-KEYED from the inquiry id to the
 * JobTread account id, so the tracking row and contact log carry over to the
 * JobTread-sourced card that replaces it on the board.
 */
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { inquiryId?: string; dryRun?: boolean; force?: boolean; existingAccountId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const inquiryId = (body.inquiryId ?? "").trim();
  if (!inquiryId) return NextResponse.json({ error: "inquiryId is required" }, { status: 400 });

  await ensureDb();
  const [row] = await db.select().from(leadInquiries).where(eq(leadInquiries.id, inquiryId));
  if (!row) return NextResponse.json({ error: "No such lead." }, { status: 404 });
  if (row.jtAccountId) {
    return NextResponse.json(
      { error: "This lead is already in JobTread.", accountId: row.jtAccountId },
      { status: 409 },
    );
  }
  if (!row.name.trim()) {
    return NextResponse.json({ error: "A lead needs a name before it can go to JobTread." }, { status: 400 });
  }

  const fields: InquiryFields = {
    name: row.name,
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
  };
  const session = await auth();
  const email = session?.user?.email ?? "";
  const meta = { loggedAt: row.createdAt, loggedBy: row.createdBy };
  const cfg = getPaveConfig();
  const existingId = (body.existingAccountId ?? "").trim();

  /** Carry the follow-up history over to the JobTread id the board will use from
   *  now on. The tracking row moves (insert-then-delete, since account_id is the
   *  primary key); the log rows are simply re-pointed. */
  const rekey = async (accountId: string, now: string) => {
    const [tracking] = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.accountId, inquiryId));
    if (tracking) {
      const moved = { ...tracking, accountId, updatedAt: now };
      await db
        .insert(leadsTable)
        .values(moved)
        .onConflictDoUpdate({ target: leadsTable.accountId, set: moved });
      await db.delete(leadsTable).where(eq(leadsTable.accountId, inquiryId));
    }
    await db
      .update(leadActivities)
      .set({ accountId })
      .where(eq(leadActivities.accountId, inquiryId));
    // The board's JobTread half is cached for 5 minutes; without this the lead
    // would vanish from the list until it expired (gone from here, not yet there).
    revalidateTag("jt-leads");
  };

  try {
    if (existingId) {
      if (body.dryRun || !writesEnabled()) {
        const plan = await buildConnectPlan(cfg, existingId, fields, meta);
        return NextResponse.json({
          previewed: true,
          wrote: false,
          writesEnabled: writesEnabled(),
          plan,
        });
      }
      const now = new Date().toISOString();
      // JobTread first, link second: if the write fails the lead stays a local
      // lead and can be retried; the other order would drop it off the board.
      const { before, after } = await connectLeadToCustomer(cfg, existingId, fields, meta);
      await db
        .update(leadInquiries)
        .set({ jtAccountId: existingId, pushedAt: now, pushedBy: email, updatedAt: now })
        .where(eq(leadInquiries.id, inquiryId));
      await rekey(existingId, now);
      const j = await openJournal("/api/leads/push");
      await j.record(
        diffFields(
          { Status: before.status, Notes: before.notes },
          { Status: after.status, Notes: after.notes },
          {
            action: "lead.connect",
            entity: "customer",
            entityId: existingId,
            jobId: "",
            beforeSource: "read",
          },
        ),
      );
      return NextResponse.json({
        wrote: true,
        connected: true,
        accountId: existingId,
        warnings: [],
        url: `https://app.jobtread.com/customers/${existingId}`,
      });
    }

    // Duplicate check first — cheap read, and it should run even for a dry run
    // (that's most of what a preview is for).
    const duplicates = await findCustomersByName(cfg, row.name);
    if (duplicates.length && !body.force) {
      return NextResponse.json(
        {
          error: `JobTread already has a customer called "${row.name}".`,
          duplicates,
          needsForce: true,
        },
        { status: 409 },
      );
    }

    if (body.dryRun || !writesEnabled()) {
      const plan = await buildLeadPushPlan(cfg, fields, meta);
      return NextResponse.json({
        previewed: true,
        wrote: false,
        writesEnabled: writesEnabled(),
        plan,
      });
    }

    const now = new Date().toISOString();
    const result = await pushLeadToJobTread(cfg, fields, meta, async (accountId) => {
      // Recorded BEFORE the contact/address steps run, so a failure there can
      // never orphan the customer we just created.
      await db
        .update(leadInquiries)
        .set({ jtAccountId: accountId, pushedAt: now, pushedBy: email, updatedAt: now })
        .where(eq(leadInquiries.id, inquiryId));
    });

    await rekey(result.accountId, now);

    return NextResponse.json({
      wrote: true,
      accountId: result.accountId,
      warnings: result.warnings,
      url: `https://app.jobtread.com/customers/${result.accountId}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
