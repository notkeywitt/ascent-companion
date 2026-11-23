"use client";

import { useEffect, useMemo, useState } from "react";

import { Menu, MenuItem } from "@/components/Menu";
import { Banner, Button, Card, Loading, MetaLine, QuietInput, SectionHeading, Segmented, Textarea } from "@/components/ui";
import {
  STATUS_CYCLE,
  STATUS_LABEL,
  applyPreconOp,
  newCustomKey,
  preconProgress,
  preconRows,
  type PreconOp,
  type PreconRow,
  type PreconState,
  type PreconStatus,
} from "@/lib/preconChecklist";

/**
 * A job's Precon tab on the Jobs page: the 27 preconstruction steps by phase
 * (src/lib/preconChecklist.ts, /api/precon-checklist).
 *
 *   • List: each step's status, set from a menu, and its note. Saves at once,
 *     with who and when.
 *   • Edit: every step, hidden ones too. Hide or Show takes a step off this
 *     job's list or puts it back; each phase takes new steps; an added step can
 *     be removed.
 *   • Open questions under the list, saved when the field loses focus.
 *
 * Each change is applied here at once and sent as one op; the route's answer
 * replaces it. Writes the companion DB only.
 */

const shortDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const who = (email: string) => email.split("@")[0];

const STATUS_STYLE: Record<PreconStatus, string> = {
  todo: "border-line-strong text-neutral-500",
  progress: "border-accent text-accent",
  blocked: "border-current text-warn",
  done: "border-current text-ok",
  na: "border-line text-neutral-400",
};

function StatusMenu({ row, onPick }: { row: PreconRow; onPick: (s: PreconStatus) => void }) {
  const s = row.step.status;
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          aria-label={`Status: ${STATUS_LABEL[s]}. Change`}
          className={`min-h-11 shrink-0 rounded-control border px-2.5 text-[12px] font-semibold lg:min-h-8 ${STATUS_STYLE[s]}`}
        >
          {STATUS_LABEL[s]}
        </button>
      }
    >
      {STATUS_CYCLE.map((x) => (
        <MenuItem key={x} onClick={() => x !== s && onPick(x)}>
          {x === s ? "✓ " : ""}
          {STATUS_LABEL[x]}
        </MenuItem>
      ))}
    </Menu>
  );
}

export function PreconChecklist({ jobId }: { jobId: string }) {
  const [state, setState] = useState<PreconState | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [show, setShow] = useState<"all" | "open">("all");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [questions, setQuestions] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/precon-checklist?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else {
          setState(d.state);
          setQuestions(d.state.questions ?? "");
        }
      })
      .catch(() => !cancelled && setError("Could not load the precon checklist."));
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const send = async (op: PreconOp): Promise<boolean> => {
    if (!state) return false;
    const before = state;
    setState(applyPreconOp(state, op, "", new Date().toISOString()));
    setError("");
    try {
      const r = await fetch("/api/precon-checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, op }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Not saved.");
      setState(d.state);
      return true;
    } catch (e) {
      setState(before);
      setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };

  const phases = useMemo(() => (state ? preconRows(state) : []), [state]);
  if (!state) return error ? <Banner tone="error">{error}</Banner> : <Loading />;

  const progress = preconProgress(state);
  const hiddenCount = phases.reduce((n, p) => n + p.rows.filter((r) => r.hidden).length, 0);
  const toggle = (id: string) =>
    setClosed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const add = (phase: string) => {
    const text = (drafts[phase] ?? "").trim();
    if (!text) return;
    setDrafts((d) => ({ ...d, [phase]: "" }));
    void send({ op: "add", phase, text, key: newCustomKey() });
  };
  const saveNote = (r: PreconRow) => {
    const text = notes[r.key] ?? r.step.note;
    setNoteOpen(null);
    if (text !== r.step.note) void send({ op: "note", key: r.key, text });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[17px] font-semibold">Preconstruction Checklist</div>
          <MetaLine
            items={[
              `${progress.done} of ${progress.total} done`,
              progress.phase,
              progress.blocked ? <span key="b" className="text-warn">{progress.blocked} blocked</span> : null,
              hiddenCount ? `${hiddenCount} hidden` : null,
            ]}
          />
        </div>
        <div className="flex items-center gap-3">
          {!editing && (
            <Segmented
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                { value: "all" as const, label: "All" },
                { value: "open" as const, label: "Open" },
              ]}
            />
          )}
          <Button size="sm" variant={editing ? "primary" : "outline"} onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Edit"}
          </Button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {phases.map((p) => {
        const listed = p.rows.filter((r) => !r.hidden);
        const counted = listed.filter((r) => r.step.status !== "na");
        const rows = editing
          ? p.rows
          : listed.filter((r) => show === "all" || (r.step.status !== "done" && r.step.status !== "na"));
        const open = !closed.has(p.id);
        if (!editing && !listed.length) return null;
        return (
          <section key={p.id} className="space-y-2">
            <SectionHeading
              onToggle={() => toggle(p.id)}
              open={open}
              trailing={
                <span className="text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
                  {counted.filter((r) => r.step.status === "done").length}/{counted.length}
                </span>
              }
            >
              {p.title}
            </SectionHeading>
            {open && (
              <Card pad={false} className="divide-y divide-line-soft">
                {rows.map((r) =>
                  editing ? (
                    <div
                      key={r.key}
                      className={`flex items-center gap-3 px-3 py-1.5 text-sm ${r.hidden ? "text-neutral-400 line-through dark:text-neutral-500" : ""}`}
                    >
                      <span className="min-w-0 flex-1">{r.text}</span>
                      {r.custom && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            if (window.confirm(`Remove "${r.text}" from this job?`)) void send({ op: "remove", key: r.key });
                          }}
                        >
                          Remove
                        </Button>
                      )}
                      <Button size="xs" variant="outline" onClick={() => void send({ op: "hide", key: r.key, hidden: !r.hidden })}>
                        {r.hidden ? "Show" : "Hide"}
                      </Button>
                    </div>
                  ) : (
                    <div key={r.key} className="space-y-1.5 px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <span className="min-w-0 flex-1 text-sm">
                          <span
                            className={
                              r.step.status === "done" || r.step.status === "na"
                                ? "text-neutral-500 line-through dark:text-neutral-400"
                                : ""
                            }
                          >
                            {r.text}
                          </span>
                          <MetaLine
                            className="mt-0.5"
                            items={[
                              r.step.by ? who(r.step.by) : null,
                              r.step.at ? shortDate(r.step.at) : null,
                              noteOpen !== r.key ? (
                                <button
                                  key="n"
                                  type="button"
                                  className="font-semibold hover:text-accent"
                                  onClick={() => setNoteOpen(r.key)}
                                >
                                  {r.step.note ? "Edit note" : "Add note"}
                                </button>
                              ) : null,
                            ]}
                          />
                        </span>
                        <StatusMenu row={r} onPick={(status) => void send({ op: "status", key: r.key, status })} />
                      </div>
                      {noteOpen === r.key ? (
                        <Textarea
                          autoFocus
                          aria-label={`Note on ${r.text}`}
                          rows={2}
                          maxLength={1000}
                          value={notes[r.key] ?? r.step.note}
                          onChange={(e) => setNotes((n) => ({ ...n, [r.key]: e.target.value }))}
                          onBlur={() => saveNote(r)}
                        />
                      ) : (
                        r.step.note && (
                          <p className="whitespace-pre-wrap text-[13px] text-neutral-600 dark:text-neutral-300">{r.step.note}</p>
                        )
                      )}
                    </div>
                  ),
                )}
                {!editing && !rows.length && (
                  <div className="px-3 py-2.5 text-sm text-neutral-500 dark:text-neutral-400">All done.</div>
                )}
                {editing && (
                  <form
                    className="flex items-center gap-2 px-3 py-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      add(p.id);
                    }}
                  >
                    <QuietInput
                      aria-label={`New step in ${p.title}`}
                      placeholder="Add a step…"
                      value={drafts[p.id] ?? ""}
                      maxLength={300}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    />
                    <Button size="sm" type="submit" disabled={!(drafts[p.id] ?? "").trim()}>
                      Add
                    </Button>
                  </form>
                )}
              </Card>
            )}
          </section>
        );
      })}

      <section className="space-y-2">
        <SectionHeading>Open questions</SectionHeading>
        <Textarea
          aria-label="Open questions"
          rows={4}
          maxLength={5000}
          value={questions}
          onChange={(e) => setQuestions(e.target.value)}
          onBlur={() => {
            if (questions !== state.questions) void send({ op: "questions", text: questions });
          }}
        />
      </section>
    </div>
  );
}
