import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { leadInquiries, leadInquiryDismissals } from "@/db/schema";
import { callAppsScript } from "@/lib/appsScript";

/**
 * POST /api/leads/ingest — file every website form submission as a lead.
 *
 * The public site emails each submission to the office; Apps Script (which is
 * the half of the system with Gmail access — see WebInquiries.js there) parses
 * them and hands them over. This route decides which are new and writes those
 * into `lead_inquiries`, where they appear on the leads board marked for review.
 *
 * NOTHING GOES TO JOBTREAD HERE. An ingested lead is a Companion record like any
 * hand-logged one; creating the customer stays a deliberate click on the lead
 * (POST /api/leads/push).
 *
 * IDEMPOTENT, BY DESIGN. De-duplication is keyed on the Gmail message id
 * (`source_message_id`, a partial unique index), and the insert is
 * onConflictDoNothing, so:
 *  • a re-scan of the same window files nothing twice,
 *  • two scans racing each other can't both win,
 *  • and Apps Script never has to label mail as "processed", which would put two
 *    systems in charge of the same question.
 * That is what makes it safe for the leads page to scan on every visit.
 *
 * An ALREADY-FILED submission is deliberately NOT updated: once it's on the
 * board, the office may have edited it, and a re-scan must not overwrite that.
 */

/** How far back to look when the caller doesn't say. */
const DEFAULT_DAYS = 120;

interface ScriptFile {
  name?: string;
  url?: string;
}
interface ScriptSubmission {
  messageId?: string;
  threadId?: string;
  receivedAt?: string;
  subject?: string;
  form?: string;
  error?: string;
  fields?: Record<string, unknown>;
  files?: ScriptFile[];
  notes?: string;
}
interface ScriptResponse {
  ok?: boolean;
  error?: string;
  count?: number;
  scanned?: number;
  submissions?: ScriptSubmission[];
}

const str = (v: unknown): string => String(v ?? "").trim();

export async function POST(req: NextRequest) {
  let body: { days?: number; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* no body is fine — the defaults are the normal case */
  }

  const res = await callAppsScript<ScriptResponse>({
    action: "listFormSubmissions",
    days: Number(body.days) || DEFAULT_DAYS,
    limit: Number(body.limit) || 50,
  });
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!res.data?.ok) {
    const raw = res.data?.error ?? "Apps Script could not read the mailbox.";
    // The one failure with a specific, actionable cause: the script is deployed,
    // but at a version that predates this action. Say so in those terms rather
    // than passing "Unknown action: …" through to a leads board.
    const error = /unknown action/i.test(raw)
      ? "The Apps Script web app doesn't know how to read website form submissions yet — it needs a `clasp push` and a new web-app deployment."
      : raw;
    return NextResponse.json({ error }, { status: 502 });
  }

  const submissions = res.data.submissions ?? [];
  const usable = submissions.filter((s) => s.messageId && !s.error);
  const unreadable = submissions.filter((s) => s.error).length;

  await ensureDb();

  // Which of these are already accounted for — either still on the board, OR
  // ingested-then-deleted (a tombstone). Both must skip: the unique index stops a
  // live duplicate, but a deleted inquiry left no row, so only the tombstone keeps
  // a thrown-away submission from being re-filed on the next scan.
  const ids = usable.map((s) => str(s.messageId));
  const [existing, dismissed] = ids.length
    ? await Promise.all([
        db
          .select({ sourceMessageId: leadInquiries.sourceMessageId })
          .from(leadInquiries)
          .where(inArray(leadInquiries.sourceMessageId, ids)),
        db
          .select({ sourceMessageId: leadInquiryDismissals.sourceMessageId })
          .from(leadInquiryDismissals)
          .where(inArray(leadInquiryDismissals.sourceMessageId, ids)),
      ])
    : [[], []];
  const known = new Set([
    ...existing.map((r) => r.sourceMessageId),
    ...dismissed.map((r) => r.sourceMessageId),
  ]);

  const now = new Date().toISOString();
  let added = 0;
  const names: string[] = [];

  for (const sub of usable) {
    const messageId = str(sub.messageId);
    if (known.has(messageId)) continue;
    const f = sub.fields ?? {};
    const name = str(f.name) || str(f.email) || "Website inquiry";
    const files = (sub.files ?? [])
      .filter((x) => str(x.url))
      .map((x) => ({ name: str(x.name) || "file", url: str(x.url) }));
    // The submission's arrival is the lead's own created date, so the board ages
    // it from when the customer actually wrote in — not from when we scanned.
    const receivedAt = str(sub.receivedAt) || now;

    const inserted = await db
      .insert(leadInquiries)
      .values({
        id: `inq_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        name,
        email: str(f.email),
        phone: str(f.phone),
        contactMethod: str(f.contactMethod),
        residency: str(f.residency),
        address: str(f.address),
        services: str(f.services),
        projectDetails: str(f.projectDetails),
        designStatus: str(f.designStatus),
        budget: str(f.budget),
        startDate: str(f.startDate),
        targetDate: str(f.targetDate),
        // Every one of these came through the website, which is exactly what
        // JobTread's "Lead Source" option means — so a push files it correctly
        // with nobody having to remember.
        leadSource: "Website",
        customerType: "",
        notes: str(sub.notes),
        sourceMessageId: messageId,
        sourceForm: str(sub.form) || str(sub.subject),
        relatedFiles: files.length ? JSON.stringify(files) : "",
        createdBy: "website",
        createdAt: receivedAt,
        updatedAt: now,
      })
      // Belt and braces with the unique index: a concurrent scan that filed this
      // submission a millisecond ago must not make this request fail.
      .onConflictDoNothing()
      .returning({ id: leadInquiries.id });
    if (inserted.length) {
      added++;
      names.push(name);
    }
  }

  return NextResponse.json({
    scanned: res.data.scanned ?? submissions.length,
    added,
    skipped: usable.length - added,
    unreadable,
    names,
  });
}
