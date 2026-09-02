"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  Card,
  Chip,
  CountBadge,
  Loading,
  SectionLabel,
  Textarea,
  btn,
  type ChipTone,
} from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { applyDismissals, dismissalKey } from "@/lib/digest/dismissals";
import { categoryTone, groupByCategory, type CategoryTone } from "@/lib/digest/grouping";
import type { DigestCategory } from "@/lib/digest/settings";
import { parseSummary } from "@/lib/digest/summary";
import type { DigestItem, DigestPayload, StoredCheckResult } from "@/lib/digest/types";

/**
 * The Daily Digest card on the home launcher (office and admin — see the
 * `digest` view in src/lib/views.ts).
 *
 * WHAT IT DRAWS AND WHAT IT DOESN'T DECIDE. Every heading, count, status mark
 * and row here comes out of the STORED digest — this component contains no
 * knowledge of what a check is or what any particular one means. Categories are
 * whatever the results carry, ordered and labelled from the `categories` list
 * the API sends (which comes from src/lib/digest/settings.ts). So adding a
 * seventh check, or a fourth category, changes nothing in this file: the new
 * group simply appears, in its configured place, with its own count and status.
 * That is the reason there are no hardcoded "Billing / Calendar / Follow-ups"
 * tabs below.
 *
 * DISMISSING. Items in a `dismissible` category (To-Do, Follow-ups — the flag
 * comes from settings.ts, not from a list here) carry a Dismiss button meaning
 * "this one is handled". The row goes immediately, the key is POSTed to
 * /api/digest/dismiss, and an Undo stays under the check for the rest of the
 * visit. The key is built by the SAME pure function the server stores
 * (`dismissalKey`), which is what lets the button name an item the server can
 * recognise without the digest carrying ids the UI would have to pass around.
 *
 * IT NEVER RUNS THE CHECKS. It GETs /api/digest, which reads the row the
 * scheduled job wrote. "Refresh now" is the one exception and it is an explicit
 * tap: it POSTs /api/digest/run, waits, and re-reads.
 *
 * Self-hiding: renders nothing at all for a user without the `digest` view, so
 * it can sit on the home page every role loads.
 */

interface DigestResponse {
  today: string;
  digest: DigestPayload | null;
  stale: boolean;
  categories: DigestCategory[];
  checks: { id: string; title: string; category: string; enabled: boolean }[];
  error?: string;
}

/**
 * Keyed on the derived TONE, not on `status` — see `categoryTone` in
 * lib/digest/grouping.ts for why the two differ. `info` is a check that reported
 * no problem but did return items (the calendar, most days): it gets the count
 * and a calm blue, deliberately not the amber that means work is waiting.
 */
const TONE_MARK: Record<CategoryTone, { icon: string; tone: ChipTone; label: string }> = {
  clear: { icon: "✅", tone: "success", label: "All clear" },
  info: { icon: "•", tone: "info", label: "For your information" },
  warning: { icon: "⚠️", tone: "warning", label: "Needs attention" },
  error: { icon: "❌", tone: "danger", label: "Couldn't check" },
};

/** "2026-08-31T13:04:11Z" → "6:04 AM". */
function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Draws the parsed brief: paragraphs and bulleted lists, in written order. */
function SummaryBody({ text }: { text: string }) {
  const blocks = useMemo(() => parseSummary(text), [text]);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="text-sm leading-relaxed">
            {b.text}
          </p>
        ) : (
          // list-outside + the left padding keeps a wrapped bullet's second
          // line aligned under its first word on a phone, not under the dot.
          <ul key={i} className="list-outside list-disc space-y-1 pl-5 text-sm leading-relaxed marker:text-neutral-400">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function DailyDigest() {
  const access = useAccess();
  const canSee = access.can("digest");
  // OFFICE READS IT, ADMIN REBUILDS IT. The card is granted to office as well
  // as admin, but /api/digest/run — an org-wide sweep plus two Claude calls —
  // authenticates on its own and accepts only the scheduler or an admin
  // session. So the button is hidden for office rather than shown and answered
  // with a 403; office sees the digest the morning run stored.
  const canRefresh = access.role === "admin";

  // Collapsed by default — the digest is a morning read, not something that
  // should own the top of the launcher on every visit. The choice is remembered
  // per device (localStorage), so once you open it it stays open; a fresh
  // browser starts collapsed. Reads are wrapped because storage can throw
  // (private windows, blocked site data).
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("digest.expanded") === "1") setExpanded(true);
    } catch {
      /* storage unavailable — stay collapsed */
    }
  }, []);
  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("digest.expanded", next ? "1" : "0");
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

  // Dismissals made in THIS visit. The server already filters the ones it knows
  // about, so this list only has to cover the gap between tapping Dismiss and
  // the next load — and to keep an Undo on screen while the reader is still
  // looking at the card.
  const [dismissed, setDismissed] = useState<{ key: string; checkId: string; title: string }[]>([]);
  const [dismissing, setDismissing] = useState<Record<string, boolean>>({});

  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyResult, setReplyResult] = useState<{ ok: boolean; lines: string[] } | null>(null);

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

  useEffect(() => {
    if (!canSee) {
      setLoading(false);
      return;
    }
    load();
  }, [canSee, load]);

  /**
   * "Refresh now" only has to START the run — /api/digest/run detaches the
   * actual work (`after()`) so it keeps going on the server for its full
   * duration even if this tab closes right after tapping it, which is a real
   * risk on a phone for something that can take tens of seconds. Once
   * started, this polls for the fresh result while the tab happens to stay
   * open; if it doesn't stick around, the next normal load shows it anyway.
   */
  async function refresh() {
    setRefreshing(true);
    setErr("");
    setNote("");
    const before = data?.digest?.generatedAt ?? null;

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
      const MAX_ATTEMPTS = 40; // ~80s — a run reads several sources plus two Claude calls
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
   * Reply box — turns a free-text note into a reminder, a snooze, an email
   * ignore rule, or a STANDING INSTRUCTION that shapes how every future brief is
   * written (see /api/digest/reply). It's memory the owner talks to, not a
   * notepad. The confirmation echoes back exactly what was applied; it never
   * re-fetches the digest, since anything set here only takes effect on the NEXT
   * run, not this one.
   */
  async function sendReply() {
    const text = replyText.trim();
    if (!text) return;
    setReplySending(true);
    setReplyResult(null);
    try {
      const res = await fetch("/api/digest/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReplyResult({ ok: false, lines: [json.error || "Couldn't send that. Try again."] });
      } else {
        const lines: string[] = (json.applied ?? []).map((a: { summary: string }) => a.summary);
        setReplyResult({ ok: true, lines: lines.length ? lines : [json.note || "Got it."] });
        setReplyText("");
      }
    } catch {
      setReplyResult({ ok: false, lines: ["Couldn't send that. Try again."] });
    } finally {
      setReplySending(false);
    }
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
  const categories = useMemo(
    () =>
      data?.digest
        ? groupByCategory(applyDismissals(data.digest.results, dismissedKeys), data.categories ?? [])
        : [],
    [data, dismissedKeys],
  );

  if (!canSee) return null;

  const digest = data?.digest ?? null;
  const flagged = categories.reduce(
    (n, c) => n + (c.status === "warning" ? c.itemCount : 0),
    0,
  );

  return (
    <section className="mb-6 space-y-2">
      {/* The heading is the collapse toggle. The flagged count rides alongside
          it so a collapsed digest still shows when work is waiting; "Refresh
          now" (admin) is only offered once it's open. */}
      <div className="flex min-h-[28px] items-center gap-2.5">
        <span aria-hidden className="h-0.5 w-5 shrink-0 rounded-full bg-accent" />
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="flex items-center gap-2 text-left"
        >
          <SectionLabel>Daily Digest</SectionLabel>
          <span
            aria-hidden
            className={`text-neutral-400 transition ${expanded ? "rotate-90" : ""}`}
          >
            ›
          </span>
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {flagged > 0 && <CountBadge n={flagged} />}
          {canRefresh && expanded && (
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-50 dark:text-accent-soft"
            >
              {refreshing ? "Refreshing…" : "Refresh now"}
            </button>
          )}
        </span>
      </div>

      {expanded && (
        <>
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
                <strong>Refresh now</strong> to build one immediately.
              </>
            ) : (
              <>No digest yet. It&rsquo;s generated automatically each morning.</>
            )}
          </p>
        </Card>
      )}

      {!loading && digest && (
        <>
          {/* The Claude brief, first — the one thing to read if nothing else.
              Drawn as its own topic blocks (see parseSummary above), not as one
              run-on paragraph. */}
          <Card>
            <SummaryBody text={digest.summary} />
            <p className="mt-2 text-[11px] text-neutral-500">
              {data?.stale ? (
                <>
                  From <strong>{digest.date}</strong> — today&rsquo;s hasn&rsquo;t run yet.
                </>
              ) : (
                <>Generated {timeOf(digest.generatedAt)}</>
              )}
              {digest.summarySource === "fallback" && " · summary written locally (Claude unavailable)"}
              {digest.status === "partial" && " · some checks couldn't run"}
            </p>
          </Card>

          {/* The reply box — talk back to the digest: add a reminder, snooze one,
              tell it to stop flagging a sender, or give it a standing instruction
              for how to write the brief. Applied on the NEXT run. */}
          <Card>
            <Textarea
              rows={2}
              placeholder={`Tell it something — "remind me about the L&I thing tomorrow", "stop mentioning the logo-update emails"…`}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              disabled={replySending}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={sendReply}
                disabled={replySending || !replyText.trim()}
                className={btn("primary", "sm")}
              >
                {replySending ? "Sending…" : "Send"}
              </button>
            </div>
            {replyResult && (
              <div className="mt-2 space-y-1">
                {replyResult.lines.map((line, i) => (
                  <p
                    key={i}
                    className={`text-[12.5px] leading-relaxed ${replyResult.ok ? "text-neutral-500" : "text-red-600"}`}
                  >
                    {replyResult.ok ? "✓ " : ""}
                    {line}
                  </p>
                ))}
              </div>
            )}
          </Card>

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
