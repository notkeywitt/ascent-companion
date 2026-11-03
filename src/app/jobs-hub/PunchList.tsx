"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Banner,
  Button,
  Card,
  Checkbox,
  Loading,
  MetaLine,
  QuietInput,
  SectionHeading,
  Segmented,
} from "@/components/ui";
import {
  applyPunchOp,
  newCustomKey,
  punchRows,
  type PunchOp,
  type PunchState,
} from "@/lib/punchList";

/**
 * A job's Punch List tab on the Jobs page: the final inspection checklist,
 * ticked off item by item (src/lib/punchList.ts, /api/punch-list).
 *
 *   • List: the job's items, by section. A tick saves at once, with who and when.
 *   • Edit: every item, hidden ones too. Hide or Show takes an item off this
 *     job's list or puts it back; each section takes new items; an added item
 *     can be removed.
 *
 * Each change is applied here at once and sent as one op; the route's answer
 * replaces it. Writes the companion DB only.
 */

const shortDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const who = (email: string) => email.split("@")[0];

export function PunchList({ jobId }: { jobId: string }) {
  const [state, setState] = useState<PunchState | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [show, setShow] = useState<"all" | "open">("all");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/punch-list?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setState(d.state);
      })
      .catch(() => !cancelled && setError("Could not load the punch list."));
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const send = async (op: PunchOp) => {
    if (!state) return;
    const before = state;
    setState(applyPunchOp(state, op, "", new Date().toISOString()));
    setError("");
    try {
      const r = await fetch("/api/punch-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, op }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Not saved.");
      setState(d.state);
    } catch (e) {
      setState(before);
      setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const sections = useMemo(() => (state ? punchRows(state) : []), [state]);
  const listed = sections.flatMap((s) => s.rows.filter((r) => !r.hidden));
  const doneCount = listed.filter((r) => r.done).length;
  const hiddenCount = sections.reduce((n, s) => n + s.rows.filter((r) => r.hidden).length, 0);

  if (!state) return error ? <Banner tone="error">{error}</Banner> : <Loading />;

  const toggleSection = (id: string) =>
    setClosed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = (section: string) => {
    const text = (drafts[section] ?? "").trim();
    if (!text) return;
    setDrafts((d) => ({ ...d, [section]: "" }));
    void send({ op: "add", section, text, key: newCustomKey() });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[17px] font-semibold">Final Inspection Punch List</div>
          <MetaLine
            items={[
              `${doneCount} of ${listed.length} done`,
              hiddenCount ? `${hiddenCount} hidden` : null,
              "San Juan County",
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

      {sections.map((sec) => {
        const rows = editing
          ? sec.rows
          : sec.rows.filter((r) => !r.hidden && (show === "all" || !r.done));
        const shown = sec.rows.filter((r) => !r.hidden);
        const open = !closed.has(sec.id);
        if (!editing && !shown.length) return null;
        return (
          <section key={sec.id} className="space-y-2">
            <SectionHeading
              onToggle={() => toggleSection(sec.id)}
              open={open}
              trailing={
                <span className="text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
                  {shown.filter((r) => r.done).length}/{shown.length}
                </span>
              }
            >
              {sec.title}
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
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void send({ op: "hide", key: r.key, hidden: !r.hidden })}
                      >
                        {r.hidden ? "Show" : "Hide"}
                      </Button>
                    </div>
                  ) : (
                    <label key={r.key} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-line-soft">
                      <Checkbox
                        className="mt-0.5"
                        checked={!!r.done}
                        onChange={(e) => void send({ op: "check", key: r.key, done: e.target.checked })}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={r.done ? "text-neutral-500 line-through dark:text-neutral-400" : ""}>{r.text}</span>
                        {r.done?.by && (
                          <MetaLine className="mt-0.5" items={[who(r.done.by), shortDate(r.done.at)]} />
                        )}
                      </span>
                    </label>
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
                      add(sec.id);
                    }}
                  >
                    <QuietInput
                      aria-label={`New item in ${sec.title}`}
                      placeholder="Add an item…"
                      value={drafts[sec.id] ?? ""}
                      maxLength={300}
                      onChange={(e) => setDrafts((d) => ({ ...d, [sec.id]: e.target.value }))}
                    />
                    <Button size="sm" type="submit" disabled={!(drafts[sec.id] ?? "").trim()}>
                      Add
                    </Button>
                  </form>
                )}
              </Card>
            )}
          </section>
        );
      })}
    </div>
  );
}
