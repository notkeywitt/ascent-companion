"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  Card,
  Chip,
  CountBadge,
  Loading,
  SectionHeading,
  btn,
  type ChipTone,
} from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { groupByCategory, type CategoryView } from "@/lib/digest/grouping";
import type { DigestCategory } from "@/lib/digest/settings";
import type { DigestItem, DigestPayload, StoredCheckResult } from "@/lib/digest/types";

/**
 * The Admin Daily Digest card on the home launcher.
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

const STATUS_MARK: Record<CategoryView["status"], { icon: string; tone: ChipTone; label: string }> = {
  ok: { icon: "✅", tone: "success", label: "All clear" },
  warning: { icon: "⚠️", tone: "warning", label: "Needs attention" },
  error: { icon: "❌", tone: "danger", label: "Couldn't check" },
};

/** "2026-08-31T13:04:11Z" → "6:04 AM". */
function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function DailyDigest() {
  const access = useAccess();
  const canSee = access.can("digest");

  const [data, setData] = useState<DigestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/digest");
      if (!res.ok) {
        setErr(res.status === 403 ? "" : "Couldn't load the digest.");
        return;
      }
      setData(await res.json());
      setErr("");
    } catch {
      setErr("Couldn't load the digest.");
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

  async function refresh() {
    setRefreshing(true);
    setErr("");
    try {
      const res = await fetch("/api/digest/run", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error || "The refresh didn't finish. Try again in a moment.");
      }
      await load();
    } catch {
      setErr("The refresh didn't finish. Try again in a moment.");
    } finally {
      setRefreshing(false);
    }
  }

  const categories = useMemo(
    () => (data?.digest ? groupByCategory(data.digest.results, data.categories ?? []) : []),
    [data],
  );

  if (!canSee) return null;

  const digest = data?.digest ?? null;
  const flagged = categories.reduce(
    (n, c) => n + (c.status === "warning" ? c.itemCount : 0),
    0,
  );

  return (
    <section className="mb-6 space-y-2">
      <SectionHeading
        trailing={
          <span className="flex items-center gap-2">
            {flagged > 0 && <CountBadge n={flagged} />}
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-50 dark:text-accent-soft"
            >
              {refreshing ? "Refreshing…" : "Refresh now"}
            </button>
          </span>
        }
      >
        Daily Digest
      </SectionHeading>

      {err && <Banner tone="error">{err}</Banner>}

      {loading && (
        <Card>
          <Loading label="Loading this morning's digest…" />
        </Card>
      )}

      {!loading && !digest && !err && (
        <Card>
          <p className="text-sm text-neutral-500">
            No digest yet. It&rsquo;s generated automatically each morning — tap{" "}
            <strong>Refresh now</strong> to build one immediately.
          </p>
        </Card>
      )}

      {!loading && digest && (
        <>
          {/* The Gemini paragraph, first — the one thing to read if nothing else. */}
          <Card>
            <p className="text-sm leading-relaxed">{digest.summary}</p>
            <p className="mt-2 text-[11px] text-neutral-500">
              {data?.stale ? (
                <>
                  From <strong>{digest.date}</strong> — today&rsquo;s hasn&rsquo;t run yet.
                </>
              ) : (
                <>Generated {timeOf(digest.generatedAt)}</>
              )}
              {digest.summarySource === "fallback" && " · summary written locally (Gemini unavailable)"}
              {digest.status === "partial" && " · some checks couldn't run"}
            </p>
          </Card>

          {/* One collapsible block per category — entirely data-driven. */}
          {categories.map((cat) => {
            const isOpen = !!open[cat.id];
            const mark = STATUS_MARK[cat.status];
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
                      {cat.status === "ok"
                        ? cat.results.map((r) => r.summary).join(" ") || mark.label
                        : `${cat.itemCount} item${cat.itemCount === 1 ? "" : "s"} across ${cat.results.length} check${cat.results.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <Chip tone={mark.tone}>{cat.status === "ok" ? "Clear" : String(cat.itemCount)}</Chip>
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
                      />
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
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
}: {
  result: StoredCheckResult;
  openItems: Record<string, boolean>;
  toggleItem: (key: string) => void;
}) {
  const mark = STATUS_MARK[result.status];
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
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => expandable && toggleItem(key)}
                    aria-expanded={expandable ? isOpen : undefined}
                    className={`flex w-full items-start gap-2 rounded py-1 text-left text-[12.5px] leading-snug ${
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
    </div>
  );
}
