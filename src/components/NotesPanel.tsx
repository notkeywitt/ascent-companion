"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, Button, Input, Loading, MetaLine, Select, Textarea } from "@/components/ui";
import { billingMonths, monthLabel } from "@/lib/billingMonths";
import {
  billingYmForDate,
  changedFields,
  fieldLabel,
  BILLS_MAX,
  groupByBillingMonth,
  type Note,
  type NoteBill,
  type NoteEdit,
  type NoteFields,
} from "@/lib/notes";
import { money } from "@/lib/money";
import { ORG_TZ } from "@/lib/orgTime";

/**
 * NOTES — the panel every "notes area" draws (src/lib/notes.ts).
 *
 * One component, many areas. An area says WHAT to show and the panel does the
 * rest: list, add, edit in place, history. Today's area is the Jobs page.
 *
 *   jobId set    → only that job's notes, newest first
 *   jobId null   → the notes of billing month `ym`, every job, with each
 *                  note's job named
 *
 * A new area (a bill, a person, the Today page) passes its own filter here;
 * add the filter to GET /api/notes first.
 *
 * Notes are kept forever: no button here deletes one. A save changes the note
 * in place and the server appends the old version to its history, which the
 * "Edited N×" link opens.
 */

export interface NoteJob {
  id: string;
  label: string;
}

const caption =
  "text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400";

/** "2026-10-19" → "Oct 19, 2026". */
function dayLabel(d: string): string {
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isNaN(t)
    ? d
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(t));
}

/** An ISO instant → "Oct 19, 2026, 3:42 PM" in the org's zone. */
function stampLabel(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t)
    ? iso
    : new Intl.DateTimeFormat("en-US", {
        timeZone: ORG_TZ,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(t));
}

const todayYmd = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TZ }).format(new Date());

export function NotesPanel({
  jobId,
  jobLabel,
  ym,
  jobs,
  className = "",
}: {
  /** The picked job, or null for the all-jobs view. */
  jobId: string | null;
  jobLabel?: string;
  /** The billing month the all-jobs view shows. */
  ym: string;
  /** Jobs a new note can be tagged with while no job is picked. */
  jobs: NoteJob[];
  className?: string;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const qs = jobId ? `jobId=${encodeURIComponent(jobId)}` : ym ? `ym=${encodeURIComponent(ym)}` : "";
    if (!jobId && !ym) return;
    try {
      const r = await fetch(`/api/notes?${qs}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not load notes.");
      setNotes(d.notes);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notes.");
      setNotes((cur) => cur ?? []);
    }
  }, [jobId, ym]);

  // A new job or month is a new list: clear first so the last one never shows.
  useEffect(() => {
    setNotes(null);
    setAdding(false);
    setEditingId(null);
    void load();
  }, [load]);

  // Names already used, offered as you type "Involves".
  const knownNames = useMemo(
    () => [...new Set((notes ?? []).flatMap((n) => n.involves))].sort((a, b) => a.localeCompare(b)),
    [notes],
  );

  const replace = (n: Note) => {
    setNotes((cur) => (cur ?? []).map((x) => (x.id === n.id ? n : x)));
  };
  // A save can move a note out of this list (another job, another month).
  const saved = (n: Note) => {
    const stays = jobId ? n.jobId === jobId : n.billingYm === ym;
    setNotes((cur) =>
      stays ? (cur ?? []).map((x) => (x.id === n.id ? n : x)) : (cur ?? []).filter((x) => x.id !== n.id),
    );
    setEditingId(null);
  };

  const heading = jobId ? (jobLabel ?? "This job") : monthLabel(ym);

  return (
    <div className={`flex min-h-0 min-w-0 flex-col gap-2 ${className}`}>
      {/* The button sits beside the title, not at the panel's right edge: the
          Jobs page lays its month picker over the card's top right corner. */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="min-w-0 truncate">
          <span className={caption}>Notes</span>
          <span className="ml-2 text-[12px] text-neutral-500 dark:text-neutral-400">{heading}</span>
        </div>
        {!adding && (
          <Button size="xs" variant="outline" className="shrink-0" onClick={() => setAdding(true)}>
            Add note
          </Button>
        )}
      </div>

      <div className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto">
        {error && <Banner tone="error">{error}</Banner>}

        {adding && (
          <NoteForm
            initial={{
              body: "",
              jobId: jobId ?? "",
              jobLabel: jobId ? (jobLabel ?? "") : "",
              noteDate: todayYmd(),
              billingYm: !jobId && ym ? ym : billingYmForDate(todayYmd()),
              involves: [],
              bills: [],
            }}
            jobs={jobId ? [] : jobs}
            knownNames={knownNames}
            submitLabel="Save note"
            onCancel={() => setAdding(false)}
            onSubmit={async (f) => {
              const r = await fetch("/api/notes", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(f),
              });
              const d = await r.json();
              if (!r.ok) return d.error ?? "Could not save the note.";
              setAdding(false);
              await load();
              return "";
            }}
          />
        )}

        {notes === null ? (
          <Loading />
        ) : notes.length === 0 && !adding ? (
          <p className="py-4 text-center text-[13px] text-neutral-500">
            {jobId ? "No notes on this job yet." : "No notes in this billing month yet."}
          </p>
        ) : jobId ? (
          <ul className="divide-y divide-line-soft">
            {notes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                showJob={false}
                editing={editingId === n.id}
                jobs={jobs}
                knownNames={knownNames}
                onEdit={() => setEditingId(n.id)}
                onDone={() => setEditingId(null)}
                onChanged={replace}
                onSaved={saved}
              />
            ))}
          </ul>
        ) : (
          // All jobs: the month's notes, grouped by billing month. The fetch
          // is one month, so there is one group — and the grouping already
          // holds when a later area asks for several months at once.
          groupByBillingMonth(notes).map((g) => (
            <section key={g.ym}>
              <ul className="divide-y divide-line-soft">
                {g.notes.map((n) => (
                  <NoteRow
                    key={n.id}
                    note={n}
                    showJob
                    editing={editingId === n.id}
                    jobs={jobs}
                    knownNames={knownNames}
                    onEdit={() => setEditingId(n.id)}
                    onDone={() => setEditingId(null)}
                    onChanged={replace}
                    onSaved={saved}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- one note */

function NoteRow({
  note,
  showJob,
  editing,
  jobs,
  knownNames,
  onEdit,
  onDone,
  onChanged,
  onSaved,
}: {
  note: Note;
  showJob: boolean;
  editing: boolean;
  jobs: NoteJob[];
  knownNames: string[];
  onEdit: () => void;
  onDone: () => void;
  /** The note changed under the editor: show its new text, keep the form open. */
  onChanged: (n: Note) => void;
  onSaved: (n: Note) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);

  if (editing) {
    return (
      <li className="py-2">
        <NoteForm
          initial={note}
          jobs={jobs}
          knownNames={knownNames}
          submitLabel="Save changes"
          onCancel={onDone}
          onSubmit={async (f) => {
            const r = await fetch("/api/notes", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ...f, id: note.id, updatedAt: note.updatedAt }),
            });
            const d = await r.json();
            // Saved by someone else meanwhile: take their version as the base
            // (the form keeps the writer's text) and ask for a second save.
            if (r.status === 409 && d.note) onChanged(d.note);
            if (!r.ok) return d.error ?? "Could not save the change.";
            onSaved(d.note);
            return "";
          }}
        />
      </li>
    );
  }

  return (
    <li className="group py-2">
      <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">{note.body}</p>
      {note.bills.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {note.bills.map((b) => (
            <a
              key={b.docId}
              href={`/bill/${b.docId}`}
              target="_blank"
              rel="noreferrer"
              title="Open the bill"
              className="rounded-full border border-line px-2.5 py-0.5 text-[12px] hover:border-accent hover:text-accent"
            >
              {b.label || "Bill"}
            </a>
          ))}
        </div>
      )}
      <div className="mt-1 flex items-start justify-between gap-2">
        <MetaLine
          items={[
            dayLabel(note.noteDate),
            showJob && (note.jobLabel || "No job"),
            `Bills in ${monthLabel(note.billingYm)}`,
            note.authorName || note.authorEmail || "Unknown",
            note.involves.length > 0 && `Involves ${note.involves.join(", ")}`,
          ]}
        />
        <span className="flex shrink-0 items-center gap-3 text-[12px]">
          {note.editCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="text-neutral-500 hover:text-accent dark:text-neutral-400"
            >
              Edited {note.editCount}×
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="font-semibold text-neutral-500 hover:text-accent dark:text-neutral-400"
          >
            Edit
          </button>
        </span>
      </div>
      {showHistory && <NoteHistory noteId={note.id} editCount={note.editCount} />}
    </li>
  );
}

/* ------------------------------------------------------------- edit history */

function NoteHistory({ noteId, editCount }: { noteId: number; editCount: number }) {
  const [edits, setEdits] = useState<NoteEdit[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/notes?history=${noteId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setEdits(d.edits);
      })
      .catch(() => !cancelled && setError("Could not load the history."));
    return () => {
      cancelled = true;
    };
  }, [noteId, editCount]);

  if (error) return <p className="mt-1 text-[12px] text-danger">{error}</p>;
  if (!edits) return <Loading />;
  return (
    <ol className="mt-2 space-y-2 border-l-2 border-line pl-3">
      {[...edits].reverse().map((e) => {
        const changed = changedFields(e.before, e.after);
        return (
          <li key={e.id} className="text-[12px]">
            <div className="text-neutral-500 dark:text-neutral-400">
              {stampLabel(e.editedAt)} · {e.editedByName || e.editedByEmail || "Unknown"}
            </div>
            {changed.map((k) => (
              <div key={k} className="mt-0.5">
                <span className="font-semibold">{fieldLabel(k)}: </span>
                <span className="text-neutral-500 line-through dark:text-neutral-400">
                  {show(k, e.before)}
                </span>
                <span> → </span>
                <span>{show(k, e.after)}</span>
              </div>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

function show(k: keyof NoteFields, f: NoteFields): string {
  switch (k) {
    case "jobId":
      return f.jobLabel || (f.jobId ? f.jobId : "No job");
    case "noteDate":
      return dayLabel(f.noteDate);
    case "billingYm":
      return monthLabel(f.billingYm);
    case "involves":
      return f.involves.length ? f.involves.join(", ") : "No one";
    case "bills":
      return f.bills?.length ? f.bills.map((b) => b.label || b.docId).join("; ") : "No bills";
    default:
      return String(f[k as "body"]);
  }
}

/* --------------------------------------------------------------------- form */

function NoteForm({
  initial,
  jobs,
  knownNames,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: NoteFields;
  /** Empty = the job is fixed (a job is picked); else the writer may choose. */
  jobs: NoteJob[];
  knownNames: string[];
  submitLabel: string;
  onCancel: () => void;
  /** Returns an error message, or "" when saved. */
  onSubmit: (f: NoteFields) => Promise<string>;
}) {
  const [body, setBody] = useState(initial.body);
  const [jobId, setJobId] = useState(initial.jobId);
  const [noteDate, setNoteDate] = useState(initial.noteDate);
  const [billingYm, setBillingYm] = useState(initial.billingYm);
  // The billing month follows the date until the writer sets it themselves.
  const [ymTouched, setYmTouched] = useState(false);
  const [involves, setInvolves] = useState<string[]>(initial.involves);
  const [bills, setBills] = useState<NoteBill[]>(initial.bills ?? []);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const months = useMemo(() => {
    const list = billingMonths(24);
    return list.some((m) => m.value === billingYm)
      ? list
      : [...list, { value: billingYm, label: monthLabel(billingYm) }].sort((a, b) =>
          b.value.localeCompare(a.value),
        );
  }, [billingYm]);

  const addName = (raw: string) => {
    const names = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    setInvolves((cur) => {
      const have = new Set(cur.map((c) => c.toLowerCase()));
      return [...cur, ...names.filter((n) => !have.has(n.toLowerCase()))];
    });
    setDraftName("");
  };

  const submit = async () => {
    const names = draftName.trim() ? [...involves, draftName.trim()] : involves;
    setBusy(true);
    setError("");
    const job = jobs.find((j) => j.id === jobId);
    const msg = await onSubmit({
      body,
      jobId,
      jobLabel: job?.label ?? (jobId === initial.jobId ? initial.jobLabel : ""),
      noteDate,
      billingYm,
      involves: names,
      bills,
    });
    setBusy(false);
    if (msg) setError(msg);
  };

  const listId = `note-names-${initial.jobId || "all"}`;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-white p-3 dark:bg-ink-raised">
      <Textarea
        autoFocus
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What happened, was decided or needs remembering?"
        aria-label="Note"
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0">
          <span className={caption}>Date</span>
          <Input
            type="date"
            value={noteDate}
            onChange={(e) => {
              setNoteDate(e.target.value);
              if (!ymTouched && e.target.value) setBillingYm(billingYmForDate(e.target.value));
            }}
          />
        </label>
        <label className="min-w-0">
          <span className={caption}>Billing month</span>
          <Select
            value={billingYm}
            onChange={(e) => {
              setBillingYm(e.target.value);
              setYmTouched(true);
            }}
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {jobs.length > 0 && (
        <label className="block">
          <span className={caption}>Job</span>
          <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">No job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      <div>
        <span className={caption}>Involves</span>
        {involves.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1.5">
            {involves.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setInvolves((cur) => cur.filter((c) => c !== n))}
                title="Remove"
                className="rounded-full border border-line px-2.5 py-0.5 text-[12px] hover:border-danger hover:text-danger"
              >
                {n} ×
              </button>
            ))}
          </div>
        )}
        <Input
          list={listId}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addName(draftName);
            }
          }}
          onBlur={() => addName(draftName)}
          placeholder="Type a name, press Enter"
          aria-label="Involves"
        />
        <datalist id={listId}>
          {knownNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      <BillPicker jobId={jobId} bills={bills} onChange={setBills} />
      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="xs" onClick={submit} disabled={busy || !body.trim()}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- bill picker */

const billLabel = (b: { vendor: string; invoice: string; amount: number }) =>
  [b.vendor || "Bill", b.invoice && `#${b.invoice}`, money(b.amount)].filter(Boolean).join(" · ");

/**
 * Link a note to bills: the chosen ones as removable pills, then a search over
 * the job's bills (every job's, while the note has none). Reads the local bill
 * index through /api/notes/bills; the note keeps the document id and a label.
 */
function BillPicker({
  jobId,
  bills,
  onChange,
}: {
  jobId: string;
  bills: NoteBill[];
  onChange: (b: NoteBill[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<
    { docId: string; vendor: string; invoice: string; amount: number; issueDate: string; status: string; jobName: string }[] | null
  >(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setFound(null);
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ q });
      if (jobId) qs.set("jobId", jobId);
      fetch(`/api/notes/bills?${qs}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setFound(d.bills ?? []))
        .catch(() => !ctrl.signal.aborted && setFound([]));
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, q, jobId]);

  const linked = new Set(bills.map((b) => b.docId));
  return (
    <div>
      <span className={caption}>Bills</span>
      {bills.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1.5">
          {bills.map((b) => (
            <button
              key={b.docId}
              type="button"
              onClick={() => onChange(bills.filter((x) => x.docId !== b.docId))}
              title="Remove"
              className="rounded-full border border-line px-2.5 py-0.5 text-[12px] hover:border-danger hover:text-danger"
            >
              {b.label || "Bill"} ×
            </button>
          ))}
        </div>
      )}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block text-[12px] font-semibold text-neutral-500 hover:text-accent dark:text-neutral-400"
        >
          + Link a bill
        </button>
      ) : (
        <div className="space-y-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={jobId ? "This job's bills — vendor or invoice #" : "Vendor or invoice #"}
            aria-label="Find a bill"
          />
          <div className="max-h-40 overflow-y-auto rounded-lg border border-line-soft">
            {found === null ? (
              <div className="p-2">
                <Loading />
              </div>
            ) : found.length === 0 ? (
              <p className="p-2 text-[12px] text-neutral-500">No bills found.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {found.map((b) => (
                  <li key={b.docId}>
                    <button
                      type="button"
                      disabled={linked.has(b.docId) || bills.length >= BILLS_MAX}
                      onClick={() => onChange([...bills, { docId: b.docId, label: billLabel(b) }])}
                      className="flex w-full items-baseline justify-between gap-3 px-2.5 py-1.5 text-left text-[12px] hover:bg-line-soft disabled:opacity-40"
                    >
                      <span className="min-w-0 truncate">
                        {billLabel(b)}
                        {!jobId && b.jobName && (
                          <span className="text-neutral-500"> · {b.jobName}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-neutral-500">{dayLabel(b.issueDate.slice(0, 10))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setQ("");
            }}
            className="text-[12px] text-neutral-500 hover:text-accent"
          >
            Done linking
          </button>
        </div>
      )}
    </div>
  );
}
