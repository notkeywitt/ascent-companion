import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { jobNoteEdits, jobNotes } from "@/db/schema";
import { readJtUserLink } from "@/lib/jtUserLink";
import {
  changedFields,
  parseInvolves,
  readNoteFields,
  type Note,
  type NoteEdit,
  type NoteFields,
} from "@/lib/notes";

/**
 * Notes (src/lib/notes.ts). Kept forever: this route has NO delete.
 *
 *   GET  ?jobId=            → { notes }   one job's notes, newest first
 *   GET  ?ym=               → { notes }   one billing month's notes, every job
 *   GET  (neither)          → { notes }   the 200 newest
 *   GET  ?history=<noteId>  → { edits }   that note's edit history, oldest first
 *   POST   { body, jobId?, jobLabel?, noteDate?, billingYm?, involves? } → { note }
 *   PATCH  { id, updatedAt, ...changed fields } → { note }
 *          `updatedAt` is the value the editor last saw. A note someone else
 *          saved since answers 409 with the current note, so no edit is lost.
 *
 * The author comes from the session, never the body. Every PATCH appends one
 * row to job_note_edits holding the whole note before and after. Writes the
 * companion DB only; gated by the "jobs-hub" view.
 */

export const dynamic = "force-dynamic";

const LIMIT = 200;
type Row = typeof jobNotes.$inferSelect;

const toNote = (r: Row): Note => ({
  id: r.id,
  jobId: r.jobId,
  jobLabel: r.jobLabel,
  noteDate: r.noteDate,
  billingYm: r.billingYm,
  body: r.body,
  involves: parseInvolves(r.involves),
  authorEmail: r.authorEmail,
  authorName: r.authorName,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  editCount: r.editCount,
});

const fieldsOf = (n: Note): NoteFields => ({
  body: n.body,
  jobId: n.jobId,
  jobLabel: n.jobLabel,
  noteDate: n.noteDate,
  billingYm: n.billingYm,
  involves: n.involves,
});

const todayInOrg = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

async function who(): Promise<{ email: string; name: string }> {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  const name =
    session?.user?.name?.trim() || (email ? (await readJtUserLink(email))?.name : "") || email;
  return { email, name };
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const q = req.nextUrl.searchParams;

  const history = q.get("history");
  if (history !== null) {
    const noteId = Number(history);
    if (!Number.isInteger(noteId) || noteId < 1)
      return NextResponse.json({ error: "Pick a note." }, { status: 400 });
    const rows = await db
      .select()
      .from(jobNoteEdits)
      .where(eq(jobNoteEdits.noteId, noteId))
      .orderBy(asc(jobNoteEdits.id));
    const edits: NoteEdit[] = rows.map((r) => ({
      id: r.id,
      noteId: r.noteId,
      editedAt: r.editedAt,
      editedByEmail: r.editedByEmail,
      editedByName: r.editedByName,
      before: JSON.parse(r.before),
      after: JSON.parse(r.after),
    }));
    return NextResponse.json({ edits });
  }

  const jobId = q.get("jobId")?.trim() ?? "";
  const ym = q.get("ym")?.trim() ?? "";
  if (jobId && !/^[A-Za-z0-9]{6,32}$/.test(jobId))
    return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  if (ym && !/^\d{4}-\d{2}$/.test(ym))
    return NextResponse.json({ error: "Pick a month." }, { status: 400 });

  const where = jobId
    ? eq(jobNotes.jobId, jobId)
    : ym
      ? eq(jobNotes.billingYm, ym)
      : undefined;
  const rows = await db
    .select()
    .from(jobNotes)
    .where(where)
    .orderBy(desc(jobNotes.noteDate), desc(jobNotes.id))
    .limit(LIMIT);
  return NextResponse.json({ notes: rows.map(toNote) });
}

async function json(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await json(req);
  if (!body) return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  // A new note's date defaults to today; its billing month to that day's.
  const withDate = body.noteDate ? body : { ...body, noteDate: todayInOrg() };
  const read = readNoteFields(withDate);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
  const f = read.fields;
  const by = await who();
  const at = new Date().toISOString();
  await ensureDb();
  const [row] = await db
    .insert(jobNotes)
    .values({
      jobId: f.jobId,
      jobLabel: f.jobLabel,
      noteDate: f.noteDate,
      billingYm: f.billingYm,
      body: f.body,
      involves: JSON.stringify(f.involves),
      authorEmail: by.email,
      authorName: by.name,
      createdAt: at,
      updatedAt: at,
      editCount: 0,
    })
    .returning();
  return NextResponse.json({ note: toNote(row) });
}

export async function PATCH(req: NextRequest) {
  const body = await json(req);
  const id = Number(body?.id);
  if (!body || !Number.isInteger(id) || id < 1)
    return NextResponse.json({ error: "Send the note's id." }, { status: 400 });
  await ensureDb();
  const [row] = await db.select().from(jobNotes).where(eq(jobNotes.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "That note does not exist." }, { status: 404 });
  const current = toNote(row);

  if (String(body.updatedAt ?? "") !== current.updatedAt)
    return NextResponse.json(
      { error: "Someone changed this note. Review it, then save again.", note: current },
      { status: 409 },
    );

  const read = readNoteFields(body, fieldsOf(current));
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
  const next = read.fields;
  const before = fieldsOf(current);
  if (changedFields(before, next).length === 0) return NextResponse.json({ note: current });

  const by = await who();
  const at = new Date().toISOString();
  // One transaction: the note and its history row land together or not at all.
  // The update is guarded on `updated_at`, so two saves that both passed the
  // check above cannot both land: the second one changes no row and rolls back.
  const saved = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(jobNotes)
      .set({
        jobId: next.jobId,
        jobLabel: next.jobLabel,
        noteDate: next.noteDate,
        billingYm: next.billingYm,
        body: next.body,
        involves: JSON.stringify(next.involves),
        updatedAt: at,
        editCount: current.editCount + 1,
      })
      .where(and(eq(jobNotes.id, id), eq(jobNotes.updatedAt, current.updatedAt)))
      .returning();
    if (!r) return null;
    await tx.insert(jobNoteEdits).values({
      noteId: id,
      editedAt: at,
      editedByEmail: by.email,
      editedByName: by.name,
      before: JSON.stringify(before),
      after: JSON.stringify(next),
    });
    return r;
  });
  if (!saved) {
    const [again] = await db.select().from(jobNotes).where(eq(jobNotes.id, id)).limit(1);
    return NextResponse.json(
      { error: "Someone changed this note. Review it, then save again.", note: again && toNote(again) },
      { status: 409 },
    );
  }
  return NextResponse.json({ note: toNote(saved) });
}
