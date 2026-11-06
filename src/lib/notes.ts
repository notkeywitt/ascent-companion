/**
 * NOTES — the pure half (no DB, no React). Safe to import anywhere.
 *
 * A note is a short piece of text the office or crew writes down. Every note
 * carries five tags, so any page can slice them its own way:
 *
 *   job         JobTread job id ("" = no job: an office-wide note) + a label
 *               snapshot, so the note still names the job after it is renamed
 *   date        the day it is about, "YYYY-MM-DD" (defaults to today)
 *   billing     the billing month it belongs to, "YYYY-MM"
 *   author      who wrote it (email + name) — set by the server, never the client
 *   involves    the people it concerns (free names)
 *
 * Notes are kept forever. There is no delete anywhere: not in the route, not
 * in the UI. An edit changes the note in place AND appends a row to the edit
 * history holding the whole note before and after. The history is append-only.
 *
 * Route: src/app/api/notes/route.ts. DB: tables job_notes + job_note_edits.
 * First area that draws notes: the Jobs page, src/components/NotesPanel.tsx.
 */
import { deriveBillingPeriod, parseBillingYm, ymOf } from "@/lib/billing";

export const NOTE_MAX_CHARS = 4000;
export const INVOLVES_MAX = 12;
export const INVOLVES_NAME_MAX = 60;

/** A bill a note is about: the JobTread document id and a label saved at link time. */
export interface NoteBill {
  docId: string;
  /** "Vendor · #invoice · $amount", so the link still reads if the bill moves. */
  label: string;
  /** The job the bill is on, saved at link time ("" on an older link) — where a
   *  click on the link goes to find it. */
  jobId?: string;
}

export const BILLS_MAX = 10;

/** The tags a note carries that a person can change. */
export interface NoteFields {
  body: string;
  jobId: string;
  jobLabel: string;
  noteDate: string;
  billingYm: string;
  involves: string[];
  bills: NoteBill[];
}

export interface Note extends NoteFields {
  id: number;
  authorEmail: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  editCount: number;
}

/** One row of the edit history: the whole note, before and after one save. */
export interface NoteEdit {
  id: number;
  noteId: number;
  editedAt: string;
  editedByEmail: string;
  editedByName: string;
  before: NoteFields;
  after: NoteFields;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const JOB_ID = /^[A-Za-z0-9]{6,32}$/;

export const isNoteDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Keep well-formed bill links, drop repeats by document id, cap the count. */
export function cleanBills(raw: unknown): NoteBill[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: NoteBill[] = [];
  for (const v of raw) {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const docId = typeof o.docId === "string" ? o.docId.trim() : "";
    if (!JOB_ID.test(docId) || seen.has(docId)) continue;
    seen.add(docId);
    const label = String(o.label ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const jid = typeof o.jobId === "string" && JOB_ID.test(o.jobId.trim()) ? o.jobId.trim() : "";
    out.push(jid ? { docId, label, jobId: jid } : { docId, label });
    if (out.length >= BILLS_MAX) break;
  }
  return out;
}

/** Parse the stored JSON of a `bills` column; never throws. */
export function parseBills(json: string | null | undefined): NoteBill[] {
  try {
    return cleanBills(JSON.parse(json ?? "[]"));
  } catch {
    return [];
  }
}

/** Trim, collapse blanks, drop repeats (case-insensitive), cap the count and length. */
export function cleanInvolves(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const name = v.replace(/\s+/g, " ").trim().slice(0, INVOLVES_NAME_MAX);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= INVOLVES_MAX) break;
  }
  return out;
}

/**
 * The billing month a day falls in by the office's usual rule (the 10th
 * cutoff, `deriveBillingPeriod`). A note's billing month starts here and the
 * writer can change it.
 */
export function billingYmForDate(noteDate: string): string {
  const d = new Date(`${noteDate}T12:00:00Z`);
  return ymOf(deriveBillingPeriod(d, false));
}

/**
 * Check a body from the browser and return clean fields, or the message to
 * show. `partial` is an edit: only the keys sent change; `base` fills the rest.
 */
export function readNoteFields(
  input: unknown,
  base?: NoteFields,
): { ok: true; fields: NoteFields } | { ok: false; error: string } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k);

  const body = has("body") ? String(o.body ?? "").trim() : (base?.body ?? "");
  if (!body) return { ok: false, error: "Write something first." };
  if (body.length > NOTE_MAX_CHARS)
    return { ok: false, error: `A note holds ${NOTE_MAX_CHARS} characters at most.` };

  const jobId = has("jobId") ? String(o.jobId ?? "").trim() : (base?.jobId ?? "");
  if (jobId && !JOB_ID.test(jobId)) return { ok: false, error: "That job id is not valid." };
  const jobLabel = !jobId
    ? ""
    : has("jobLabel")
      ? String(o.jobLabel ?? "").trim().slice(0, 160)
      : (base?.jobLabel ?? "");

  const noteDate = has("noteDate") ? o.noteDate : (base?.noteDate ?? "");
  if (!isNoteDate(noteDate)) return { ok: false, error: "Pick a valid date." };

  let billingYm: string;
  if (has("billingYm")) {
    const p = parseBillingYm(String(o.billingYm ?? ""));
    if (!p) return { ok: false, error: "Pick a valid billing month." };
    billingYm = ymOf(p);
  } else {
    billingYm = base?.billingYm ?? billingYmForDate(noteDate);
  }

  const involves = has("involves") ? cleanInvolves(o.involves) : (base?.involves ?? []);
  const bills = has("bills") ? cleanBills(o.bills) : (base?.bills ?? []);
  return { ok: true, fields: { body, jobId, jobLabel, noteDate, billingYm, involves, bills } };
}

const FIELD_LABEL: Record<keyof NoteFields, string> = {
  body: "Text",
  jobId: "Job",
  jobLabel: "Job",
  noteDate: "Date",
  billingYm: "Billing month",
  involves: "Involves",
  bills: "Bills",
};

/** The fields an edit changed. `jobLabel` rides with `jobId`, so it never shows twice. */
export function changedFields(before: NoteFields, after: NoteFields): (keyof NoteFields)[] {
  const keys: (keyof NoteFields)[] = ["body", "jobId", "noteDate", "billingYm", "involves", "bills"];
  return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

export const fieldLabel = (k: keyof NoteFields) => FIELD_LABEL[k];

/** A person's note text, for a one-line preview. */
export const firstLine = (s: string, max = 80) => {
  const line = s.split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** Parse the stored JSON of an `involves` column; never throws. */
export function parseInvolves(json: string | null | undefined): string[] {
  try {
    return cleanInvolves(JSON.parse(json ?? "[]"));
  } catch {
    return [];
  }
}

/**
 * Group notes under their billing month, newest month first, newest note first
 * inside it. The Jobs page uses this while no job is picked.
 */
export function groupByBillingMonth(notes: Note[]): { ym: string; notes: Note[] }[] {
  const by = new Map<string, Note[]>();
  for (const n of notes) by.set(n.billingYm, [...(by.get(n.billingYm) ?? []), n]);
  return [...by]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([ym, list]) => ({
      ym,
      notes: [...list].sort(
        (a, b) => b.noteDate.localeCompare(a.noteDate) || b.createdAt.localeCompare(a.createdAt),
      ),
    }));
}
