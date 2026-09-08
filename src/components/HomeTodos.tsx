"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  Card,
  Chip,
  CountBadge,
  Input,
  Label,
  ListCard,
  Loading,
  MetaLine,
  SectionHeading,
  SectionLabel,
  Select,
  Textarea,
  btn,
  type ChipTone,
} from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { JobPicker } from "@/components/JobPicker";
import { jtToDoUrl } from "@/lib/jtLinks";
import { applyDismissals, dismissalKey } from "@/lib/digest/dismissals";
import { categoryTone, groupByCategory, type CategoryTone } from "@/lib/digest/grouping";
import type { DigestCategory } from "@/lib/digest/settings";
import type { DigestItem, DigestPayload, StoredCheckResult } from "@/lib/digest/types";

/**
 * The To Dos card on the home launcher (the `digest` view in src/lib/views.ts —
 * admin-only since 2026-09-08).
 *
 * It was the Daily Digest, and it is now a TO-DO LIST with the digest's other
 * findings underneath it (2026-09-08, at the owner's request). Three things went
 * with the rename:
 *  - the written brief at the top — a paragraph that restated the rows below it;
 *  - the reply box that set companion-local reminders — to-dos now live in
 *    JobTread, so a second place to keep them was a second place to forget them;
 *  - the stored `jobtread-todos` check's block, because the live list above is
 *    the same to-dos read fresh (see HIDDEN_CHECKS).
 *
 * TWO SOURCES, AND THE ORDER MATTERS. The to-do list and the create form read
 * and write JobTread LIVE (/api/todos). Everything under them is the stored
 * morning digest (/api/digest), which this component still only renders — it
 * never runs the checks. "Refresh" (admin) is the one exception and it is an
 * explicit tap.
 *
 * WHAT IT DRAWS AND WHAT IT DOESN'T DECIDE, below the to-dos. Every heading,
 * count, status mark and row in the digest half comes out of the stored digest:
 * categories are whatever the results carry, ordered and labelled from the
 * `categories` list the API sends (src/lib/digest/settings.ts). Adding a check
 * or a category changes nothing in this file.
 *
 * DISMISSING. Items in a `dismissible` category (To-Do, Follow-ups — the flag
 * comes from settings.ts) carry a Dismiss button meaning "this one is handled".
 * The row goes immediately, the key is POSTed to /api/digest/dismiss, and an
 * Undo stays under the check for the rest of the visit. The key is built by the
 * SAME pure function the server stores (`dismissalKey`).
 *
 * Self-hiding: renders nothing at all for a user without the `digest` view, so
 * it can sit on the home page every role loads.
 */

/** Where the card remembers whether it is folded away, per device. */
const OPEN_KEY = "digest.expanded";

/**
 * Stored checks the card does NOT draw, because something above them says the
 * same thing better. `jobtread-todos` is the morning snapshot of exactly the
 * to-dos the live list holds — showing both put every to-do on the card twice,
 * once possibly hours stale.
 */
const HIDDEN_CHECKS = new Set(["jobtread-todos"]);

/** How many to-dos the list shows before "open JobTread for the rest". */
const TODO_LIMIT = 6;

interface DigestResponse {
  today: string;
  digest: DigestPayload | null;
  stale: boolean;
  categories: DigestCategory[];
  checks: { id: string; title: string; category: string; enabled: boolean }[];
  error?: string;
}

/** One live JobTread to-do, as /api/todos returns it. */
interface TodoRow {
  id: string;
  name: string;
  description?: string;
  due: string | null;
  overdue: boolean;
  jobId: string | null;
  jobName: string | null;
}

interface TodosResponse {
  ok: boolean;
  me: { name: string; linked: boolean };
  /** Assigned to the person reading the card. */
  mine: TodoRow[];
  /** Assigned to nobody, so fair game — kept apart from `mine` on purpose. */
  unclaimed: TodoRow[];
  counts: { mine: number; unclaimed: number; overdue: number; open: number };
  error?: string;
}

/** An employee for the "assign to" picker — /api/jt-users. */
interface JtUser {
  id: string;
  name: string;
  isInternal: boolean;
  membershipId?: string;
}

/**
 * Keyed on the derived TONE, not on `status` — see `categoryTone` in
 * lib/digest/grouping.ts for why the two differ. `info` is a check that reported
 * no problem but did return items (the calendar, most days): it gets the count
 * and a calm blue, deliberately not the amber that means work is waiting.
 */
const TONE_MARK: Record<CategoryTone, { icon: string; tone: ChipTone; label: string }> = {
  clear: { icon: "✓", tone: "success", label: "All clear" },
  info: { icon: "•", tone: "info", label: "For your information" },
  warning: { icon: "⚠", tone: "warning", label: "Needs attention" },
  error: { icon: "✕", tone: "danger", label: "Couldn't check" },
};

/** "2026-08-31T13:04:11Z" → "6:04 AM". */
function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "2026-09-12" → "Sep 12". Bare string in, no timezone shift. */
function dayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function HomeTodos() {
  const access = useAccess();
  const canSee = access.can("digest");
  // Refresh stays a SEPARATE check because /api/digest/run — an org-wide sweep
  // plus a Claude call — authenticates on its own and accepts only the
  // scheduler or an admin session. That matters for the one case the view still
  // allows: a per-user grant handing this card to a non-admin, who then reads
  // the digest the morning run stored without the button that rebuilds it.
  const canRefresh = access.role === "admin";

  // Collapsed by default, remembered per device (localStorage), like every other
  // menu on the launcher. Reads are wrapped because storage can throw (private
  // windows, blocked site data).
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "1") setExpanded(true);
    } catch {
      /* storage unavailable — stay collapsed */
    }
  }, []);
  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable — the choice just won't persist */
      }
      return next;
    });
  }, []);

  const [data, setData] = useState<DigestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});

  // The live JobTread to-dos.
  const [todos, setTodos] = useState<TodosResponse | null>(null);
  const [todosLoading, setTodosLoading] = useState(true);
  const [todosErr, setTodosErr] = useState("");

  // Dismissals made in THIS visit. The server already filters the ones it knows
  // about, so this list only has to cover the gap between tapping Dismiss and
  // the next load — and to keep an Undo on screen while the reader is still
  // looking at the card.
  const [dismissed, setDismissed] = useState<{ key: string; checkId: string; title: string }[]>([]);
  const [dismissing, setDismissing] = useState<Record<string, boolean>>({});

  // Returns what it loaded so `refresh` can tell a fresh digest apart from the
  // one that was already showing, without relying on `data` state (which
  // wouldn't have updated yet inside the same async call).
  const load = useCallback(async (): Promise<DigestResponse | null> => {
    try {
      const res = await fetch("/api/digest");
      if (!res.ok) {
        setErr(res.status === 403 ? "" : "Couldn't load the digest.");
        return null;
      }
      const json: DigestResponse = await res.json();
      setData(json);
      setErr("");
      return json;
    } catch {
      setErr("Couldn't load the digest.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTodos = useCallback(async () => {
    try {
      const res = await fetch(`/api/todos?limit=${TODO_LIMIT}`);
      const json: TodosResponse = await res.json();
      if (!res.ok || !json.ok) {
        setTodosErr(json.error || "Couldn't read to-dos from JobTread.");
        return;
      }
      setTodos(json);
      setTodosErr("");
    } catch {
      setTodosErr("Couldn't read to-dos from JobTread.");
    } finally {
      setTodosLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canSee) {
      setLoading(false);
      setTodosLoading(false);
      return;
    }
    load();
    loadTodos();
  }, [canSee, load, loadTodos]);

  /**
   * "Refresh" only has to START the digest run — /api/digest/run detaches the
   * actual work (`after()`) so it keeps going on the server for its full
   * duration even if this tab closes right after tapping it, which is a real
   * risk on a phone for something that can take tens of seconds. Once started,
   * this polls for the fresh result while the tab happens to stay open; if it
   * doesn't stick around, the next normal load shows it anyway. The to-do list
   * is re-read straight away, since that one is live.
   */
  async function refresh() {
    setRefreshing(true);
    setErr("");
    setNote("");
    const before = data?.digest?.generatedAt ?? null;
    loadTodos();

    let started = false;
    try {
      const res = await fetch("/api/digest/run", { method: "POST" });
      started = res.ok;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error || "The refresh didn't start. Try again in a moment.");
      }
    } catch {
      setErr("The refresh didn't start. Try again in a moment.");
    }

    if (started) {
      const MAX_ATTEMPTS = 40; // ~80s — a run reads several sources plus a Claude call
      let found = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await sleep(2000);
        const latest = await load();
        if (latest?.digest && latest.digest.generatedAt !== before) {
          found = true;
          break;
        }
      }
      if (!found) {
        setNote("Still working — it'll show up next time you open this page.");
      }
    }
    setRefreshing(false);
  }

  /**
   * Post a dismissal (or its undo). Optimistic: the row disappears on tap and
   * comes back only if the write fails, because the alternative — a spinner on
   * every item in a list you are working through — is worse than a rare
   * reappearing row.
   */
  const postDismiss = useCallback(
    async (entry: { key: string; checkId: string; title: string }, undo: boolean) => {
      setDismissing((d) => ({ ...d, [entry.key]: true }));
      setDismissed((list) =>
        undo ? list.filter((d) => d.key !== entry.key) : [...list, entry],
      );
      try {
        const res = await fetch("/api/digest/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...entry, undo }),
        });
        if (!res.ok) throw new Error("failed");
      } catch {
        // Put it back the way it was and say so.
        setDismissed((list) =>
          undo ? [...list, entry] : list.filter((d) => d.key !== entry.key),
        );
        setErr(undo ? "Couldn't undo that. Try again." : "Couldn't dismiss that. Try again.");
      } finally {
        setDismissing((d) => {
          const next = { ...d };
          delete next[entry.key];
          return next;
        });
      }
    },
    [],
  );

  const dismissedKeys = useMemo(() => new Set(dismissed.map((d) => d.key)), [dismissed]);

  // Filtered through the SAME pure function the server uses, so a just-dismissed
  // item leaves the counts and the category chip exactly as it will after the
  // next load — no second definition of "what a dismissal does".
  const categories = useMemo(() => {
    if (!data?.digest) return [];
    const results = applyDismissals(data.digest.results, dismissedKeys).filter(
      (r) => !HIDDEN_CHECKS.has(r.id),
    );
    return groupByCategory(results, data.categories ?? []).filter((c) => c.results.length > 0);
  }, [data, dismissedKeys]);

  if (!canSee) return null;

  const digest = data?.digest ?? null;
  const flaggedInDigest = categories.reduce(
    (n, c) => n + (c.status === "warning" ? c.itemCount : 0),
    0,
  );
  // A badge means work is waiting on YOU, so it counts every to-do assigned to
  // the reader — not just the few the card lists, and never the unclaimed ones —
  // plus whatever the digest flagged. A folded card still says what is in it.
  const badge = (todos?.counts.mine ?? 0) + flaggedInDigest;

  return (
    <section className="mb-6 space-y-2">
      <SectionHeading
        onToggle={toggleExpanded}
        open={expanded}
        trailing={
          <span className="flex items-center gap-2">
            {badge > 0 && <CountBadge n={badge} />}
            {canRefresh && expanded && (
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-50 dark:text-accent-soft"
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            )}
          </span>
        }
      >
        To Dos
      </SectionHeading>

      {expanded && (
        <>
          {/* The to-dos themselves, first and live. */}
          <TodoList data={todos} loading={todosLoading} error={todosErr} />

          <CreateTodo onCreated={loadTodos} />

          {err && <Banner tone="error">{err}</Banner>}
          {!err && note && <Banner tone="info">{note}</Banner>}

          {loading && (
            <Card>
              <Loading label="Loading this morning's digest…" />
            </Card>
          )}

          {!loading && !digest && !err && (
            <Card>
              <p className="text-sm text-neutral-500">
                {canRefresh ? (
                  <>
                    No digest yet. It&rsquo;s generated automatically each morning — tap{" "}
                    <strong>Refresh</strong> to build one immediately.
                  </>
                ) : (
                  <>No digest yet. It&rsquo;s generated automatically each morning.</>
                )}
              </p>
            </Card>
          )}

          {!loading && digest && (
            <>
              {/* One collapsible block per category — entirely data-driven. */}
              {categories.map((cat) => {
                const isOpen = !!open[cat.id];
                const tone = categoryTone(cat);
                const mark = TONE_MARK[tone];
                return (
                  <Card key={cat.id} pad={false} className="overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpen((o) => ({ ...o, [cat.id]: !isOpen }))}
                      aria-expanded={isOpen}
                      className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-neutral-50 dark:hover:bg-white/5"
                    >
                      <span aria-hidden className="text-base leading-none">
                        {mark.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{cat.label}</span>
                        <span className="block truncate text-xs text-neutral-500">
                          {tone === "clear" || tone === "info"
                            ? cat.results.map((r) => r.summary).join(" ") || mark.label
                            : `${cat.itemCount} item${cat.itemCount === 1 ? "" : "s"} across ${cat.results.length} check${cat.results.length === 1 ? "" : "s"}`}
                        </span>
                      </span>
                      <Chip tone={mark.tone}>
                        {tone === "clear" ? "Clear" : String(cat.itemCount)}
                      </Chip>
                      <span
                        aria-hidden
                        className={`shrink-0 text-neutral-400 transition ${isOpen ? "rotate-90" : ""}`}
                      >
                        ›
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-line-soft px-3 py-2">
                        {cat.blurb && <p className="mb-2 text-[11px] text-neutral-500">{cat.blurb}</p>}
                        {cat.results.map((r) => (
                          <CheckBlock
                            key={r.id}
                            result={r}
                            openItems={openItems}
                            toggleItem={(key) => setOpenItems((o) => ({ ...o, [key]: !o[key] }))}
                            dismissible={!!cat.dismissible}
                            dismissedHere={dismissed.filter((d) => d.checkId === r.id)}
                            busy={dismissing}
                            onDismiss={(item) =>
                              postDismiss(
                                { key: dismissalKey(r.id, item), checkId: r.id, title: item.title },
                                false,
                              )
                            }
                            onUndo={(entry) => postDismiss(entry, true)}
                          />
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}

              <p className="px-1 text-[11px] text-neutral-500">
                {data?.stale ? (
                  <>
                    Digest from <strong>{digest.date}</strong> — today&rsquo;s hasn&rsquo;t run yet.
                  </>
                ) : (
                  <>Digest generated {timeOf(digest.generatedAt)}</>
                )}
                {digest.status === "partial" && " · some checks couldn't run"}
              </p>

              {/* The run log — which checks ran, how long each took, and the REASON
                  anything failed (a Claude outage, a bad model id, a timed-out
                  Google read). Kept collapsed: it's a diagnostic, not part of the
                  morning read, but it's the first place to look when the summary
                  says a source couldn't be reached. */}
              {digest.log.length > 0 && (
                <Card pad={false} className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, __log: !o.__log }))}
                    aria-expanded={!!open.__log}
                    className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-neutral-50 dark:hover:bg-white/5"
                  >
                    <span className="min-w-0 flex-1 text-xs font-semibold text-neutral-500">Run log</span>
                    <span
                      aria-hidden
                      className={`shrink-0 text-neutral-400 transition ${open.__log ? "rotate-90" : ""}`}
                    >
                      ›
                    </span>
                  </button>
                  {open.__log && (
                    <div className="border-t border-line-soft px-3 py-2">
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-neutral-500">
                        {digest.log.join("\n")}
                      </pre>
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The live list: your open JobTread to-dos, overdue first, then the ones nobody
 * has picked up — under their own label, because a list that mixes them reads
 * as somebody else's list. Read-only: a to-do is finished in JobTread, which is
 * where its progress, comments and files live, so every row links there.
 */
function TodoList({
  data,
  loading,
  error,
}: {
  data: TodosResponse | null;
  loading: boolean;
  error: string;
}) {
  if (loading) {
    return (
      <Card>
        <Loading label="Reading your to-dos…" />
      </Card>
    );
  }
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return null;

  const nothing = data.mine.length === 0 && data.unclaimed.length === 0;
  if (nothing) {
    return (
      <Card>
        <p className="text-sm text-neutral-500">
          Nothing open with your name on it.
          {!data.me.linked && (
            <>
              {" "}
              Your sign-in isn&rsquo;t a JobTread member, so this can only show
              unclaimed to-dos.
            </>
          )}
        </p>
      </Card>
    );
  }

  const moreMine = data.counts.mine - data.mine.length;
  const moreUnclaimed = data.counts.unclaimed - data.unclaimed.length;

  return (
    <ListCard className="divide-y divide-line-soft">
      {data.mine.length === 0 && (
        <p className="px-3 py-2 text-[11.5px] text-neutral-500">
          Nothing assigned to you. These are unclaimed:
        </p>
      )}
      {data.mine.map((t) => (
        <TodoRowView key={t.id} t={t} />
      ))}
      {moreMine > 0 && (
        <p className="px-3 py-2 text-[11.5px] text-neutral-500">
          {moreMine} more of yours — the rest are in JobTread.
        </p>
      )}

      {data.mine.length > 0 && data.unclaimed.length > 0 && (
        <p className="bg-neutral-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:bg-white/5">
          Unclaimed
        </p>
      )}
      {data.unclaimed.map((t) => (
        <TodoRowView key={t.id} t={t} />
      ))}
      {data.unclaimed.length > 0 && moreUnclaimed > 0 && (
        <p className="px-3 py-2 text-[11.5px] text-neutral-500">
          {moreUnclaimed} more unclaimed in JobTread.
        </p>
      )}
    </ListCard>
  );
}

/** One to-do row. Links to JobTread's TO-DO list, opened on this to-do. */
function TodoRowView({ t }: { t: TodoRow }) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <a
          href={jtToDoUrl(t.id)}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug hover:text-accent dark:hover:text-accent-soft"
        >
          {t.name}
        </a>
        {t.overdue && <Chip tone="warning">Overdue</Chip>}
      </div>
      <MetaLine
        className="mt-0.5"
        items={[
          t.jobName ?? "Company-wide",
          t.due ? `${t.overdue ? "was due " : "due "}${dayOf(t.due)}` : "no due date",
        ]}
      />
      {t.description && (
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-neutral-500">
          {t.description}
        </p>
      )}
    </div>
  );
}

/**
 * Create a JobTread to-do — the write half of this card (POST /api/todos →
 * `createToDo`).
 *
 * A to-do is filed against a JOB, or against the company when no job is picked;
 * JobTread has no "to-do on a document", so a bill or an invoice is named in the
 * details rather than linked. Assignment is by MEMBERSHIP id, which is why the
 * picker is built from /api/jt-users rather than from the Employee roster.
 *
 * The pickers load on first open, not on page load: this is the home screen, and
 * a jobs list plus a user list is a cost only paid by somebody who is adding a
 * to-do.
 */
function CreateTodo({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [jobId, setJobId] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");

  const [users, setUsers] = useState<JtUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  // One load, the first time the form opens. (JobPicker fetches its own list.)
  useEffect(() => {
    if (!open || usersLoaded) return;
    setUsersLoaded(true);
    (async () => {
      try {
        const u = await fetch("/api/jt-users").then((r) => r.json());
        setUsers(((u?.users ?? []) as JtUser[]).filter((x) => x.isInternal && x.membershipId));
      } catch {
        setErr("Couldn't load the employee list.");
      }
    })();
  }, [open, usersLoaded]);

  async function save() {
    const text = name.trim();
    if (!text) return;
    setSaving(true);
    setErr("");
    setDone("");
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: text,
          jobId: jobId || undefined,
          membershipIds: membershipId ? [membershipId] : [],
          dueDate: dueDate || undefined,
          description: description.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json.error || "Couldn't create that to-do.");
        return;
      }
      setDone(
        json.previewed
          ? "Writes are off, so nothing was sent to JobTread."
          : "Added to JobTread.",
      );
      setName("");
      setDescription("");
      setDueDate("");
      onCreated();
    } catch {
      setErr("Couldn't create that to-do.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-line px-3 py-2.5 text-left text-[12.5px] font-semibold text-neutral-500 transition hover:border-accent hover:text-accent dark:text-neutral-400"
      >
        + New to-do
      </button>
    );
  }

  return (
    <Card className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>New to-do</SectionLabel>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] font-semibold text-neutral-500 hover:text-accent"
        >
          Close
        </button>
      </div>

      <div>
        <Label htmlFor="todo-name">What needs doing</Label>
        <Input
          id="todo-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Order the tile for the Bunkhouse bath"
          disabled={saving}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="todo-who">Assign to</Label>
          <Select
            id="todo-who"
            value={membershipId}
            onChange={(e) => setMembershipId(e.target.value)}
            disabled={saving}
          >
            <option value="">Nobody yet</option>
            {users.map((u) => (
              <option key={u.membershipId} value={u.membershipId}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="todo-due">Due</Label>
          <Input
            id="todo-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={saving}
          />
        </div>
      </div>

      <div>
        <Label>Job</Label>
        {/* The app's own picker, so this searches jobs the same way every other
            job field does. No job picked = the to-do goes on the company. */}
        <JobPicker
          value={jobId}
          onChange={setJobId}
          allLabel="Company-wide"
          allDescription="A to-do with no job attached"
        />
      </div>

      <div>
        <Label htmlFor="todo-detail">Details</Label>
        <Textarea
          id="todo-detail"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Anything the person doing it needs — a bill number, a phone number, a document to look at."
          disabled={saving}
        />
      </div>

      {err && <Banner tone="error">{err}</Banner>}
      {done && <p className="text-[12.5px] text-neutral-500">✓ {done}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving || !name.trim()}
        className={btn("primary", "sm")}
      >
        {saving ? "Adding…" : "Add to JobTread"}
      </button>
    </Card>
  );
}

/** One check inside an expanded category: its own status line, then its items. */
function CheckBlock({
  result,
  openItems,
  toggleItem,
  dismissible,
  dismissedHere,
  busy,
  onDismiss,
  onUndo,
}: {
  result: StoredCheckResult;
  openItems: Record<string, boolean>;
  toggleItem: (key: string) => void;
  /** Does this check's category allow "handled, stop showing it" (settings.ts). */
  dismissible: boolean;
  /** Dismissed during this visit — drawn under the list so Undo stays reachable. */
  dismissedHere: { key: string; checkId: string; title: string }[];
  busy: Record<string, boolean>;
  onDismiss: (item: DigestItem) => void;
  onUndo: (entry: { key: string; checkId: string; title: string }) => void;
}) {
  const mark = TONE_MARK[categoryTone({ status: result.status, itemCount: result.items.length })];
  // Items keep whatever `group` their check gave them — a calendar day, a vendor,
  // a flag type — so grouping is the check's decision, not this component's.
  const groups = new Map<string, DigestItem[]>();
  for (const item of result.items) {
    const key = item.group ?? "";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  return (
    <div className="border-b border-line-soft py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="text-xs leading-none">
          {mark.icon}
        </span>
        <span className="text-xs font-semibold">{result.title}</span>
        {result.items.length > 0 && (
          <span className="text-[11px] tabular-nums text-neutral-500">{result.items.length}</span>
        )}
      </div>
      <p className="ml-5 mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">{result.summary}</p>

      {[...groups.entries()].map(([group, items]) => (
        <div key={group || "_"} className="ml-5 mt-1.5">
          {group && (
            <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-400">
              {group}
            </p>
          )}
          <ul className="space-y-0.5">
            {items.map((item, i) => {
              const key = `${result.id}:${group}:${i}`;
              const isOpen = !!openItems[key];
              const expandable = Boolean(item.detail || item.sourceLink);
              const dismissKey = dismissalKey(result.id, item);
              return (
                <li key={key}>
                  {/* The row and its Dismiss are SIBLINGS, not nested buttons —
                      tapping the title still expands the item. */}
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => expandable && toggleItem(key)}
                      aria-expanded={expandable ? isOpen : undefined}
                      className={`flex min-w-0 flex-1 items-start gap-2 rounded py-1 text-left text-[12.5px] leading-snug ${
                        expandable ? "hover:text-accent dark:hover:text-accent-soft" : "cursor-default"
                      }`}
                    >
                      {expandable && (
                        <span
                          aria-hidden
                          className={`mt-0.5 shrink-0 text-[10px] text-neutral-400 transition ${isOpen ? "rotate-90" : ""}`}
                        >
                          ›
                        </span>
                      )}
                      <span className="min-w-0 flex-1">{item.title}</span>
                    </button>
                    {dismissible && (
                      <button
                        type="button"
                        onClick={() => onDismiss(item)}
                        disabled={!!busy[dismissKey]}
                        aria-label={`Dismiss: ${item.title}`}
                        className="shrink-0 rounded px-1.5 py-1 text-[11px] font-semibold text-neutral-400 transition hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                      >
                        {busy[dismissKey] ? "…" : "Dismiss"}
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <div className="mb-1 ml-4 border-l-2 border-line pl-2.5">
                      {item.detail && (
                        <p className="text-[11.5px] leading-relaxed text-neutral-500">{item.detail}</p>
                      )}
                      {item.sourceLink && (
                        <a
                          href={item.sourceLink}
                          target={item.sourceLink.startsWith("http") ? "_blank" : undefined}
                          rel="noreferrer"
                          className={btn("outline", "sm", "mt-1.5")}
                        >
                          {item.sourceLabel ?? "Open source"}
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* Just-dismissed items, kept on screen with an Undo for the rest of the
          visit — a mis-tap on a phone list must not be a one-way door. They are
          already out of every count above. */}
      {dismissedHere.length > 0 && (
        <ul className="ml-5 mt-1.5 space-y-0.5">
          {dismissedHere.map((d) => (
            <li key={d.key} className="flex items-start gap-2 py-0.5 text-[11.5px] text-neutral-400">
              <span className="min-w-0 flex-1 truncate line-through">{d.title}</span>
              <button
                type="button"
                onClick={() => onUndo(d)}
                disabled={!!busy[d.key]}
                className="shrink-0 font-semibold text-accent hover:underline disabled:opacity-50 dark:text-accent-soft"
              >
                {busy[d.key] ? "…" : "Undo"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
