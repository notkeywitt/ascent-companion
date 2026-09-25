"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Banner,
  Button,
  Card,
  CountBadge,
  IconButton,
  QuietInput,
  Select,
  StickyActionBar,
} from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { useEffectiveLayout } from "@/components/NavLayoutProvider";
import { PAGE_CATALOG } from "@/lib/pagesMenu";
import type { NavItem, NavMenu } from "@/lib/navLayout";

/**
 * The admin home launcher as CARDS — the same card shape as the job board
 * above it. Each menu of the layout (src/lib/navLayout.ts) is one card: its
 * title in bold, its pages as a plain list, and beside each page a SIGNAL — the
 * count that says whether the page has work waiting (bills to code, live
 * requisitions, open invoices). A card can also lead with a headline chart
 * taken from one of its pages' signals.
 *
 * EDIT MODE is in place. "Edit home page" turns every card editable: drag a
 * card to reorder the grid, drag a page between cards, rename a title, add or
 * remove pages, choose the headline. Save writes the whole layout to
 * /api/admin/home-layout, the same document the older form editor writes —
 * "More options" still opens that one, for buttons, custom links and
 * descriptions.
 *
 * ponytail: HTML5 drag and drop only — it does not fire on a touchscreen, so an
 * iPad arranges cards through "More options" (arrow buttons). Add pointer-event
 * dragging if the iPad needs to drag too.
 */

/* ---------------------------------------------------------------- signals */

/** What a page's row shows, plus the optional headline its card can lead with. */
interface Signal {
  /** Quiet text beside the row, e.g. "3 requested · 2 ordered". */
  text: string;
  /** Work waiting — shown as a badge. 0 or absent: none. */
  alert?: number;
  /** The card headline: one figure, then a bar per part of it. */
  hero?: { value: string; label: string };
  bars?: { label: string; value: number; display: string }[];
}

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function getJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

/**
 * One loader per page that has something worth counting, keyed by view id.
 * Every loader reads an endpoint the page itself already uses, so the count on
 * the card is the page's own number. `gate` is an extra view the reader needs
 * (the office-only half of a page), on top of the page's own view.
 *
 * Add a page's signal here and every card that lists the page shows it.
 */
const SIGNALS: Record<string, { gate?: string; load: () => Promise<Signal | null> }> = {
  recode: {
    // Draft vendor bills — the coding queue the Tracking Sheets clear.
    load: async () => {
      const j = await getJson("/api/coding-queue");
      const bills = (j.bills ?? []) as { cost?: number; jobName?: string }[];
      const byJob = new Map<string, number>();
      for (const b of bills) byJob.set(b.jobName || "No job", (byJob.get(b.jobName || "No job") ?? 0) + 1);
      return {
        text: bills.length ? `${bills.length} to code` : "All coded",
        alert: bills.length,
        hero: { value: String(bills.length), label: "bills to code" },
        bars: [...byJob]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([label, n]) => ({ label, value: n, display: String(n) })),
      };
    },
  },
  requisitions: {
    load: async () => {
      const j = await getJson("/api/requisitions");
      const rows = (j.requisitions ?? []) as Record<string, string>[];
      const requested = rows.filter((r) => !r.Status || r.Status === "Requested").length;
      const ordered = rows.filter((r) => r.Status === "Ordered").length;
      return {
        text: requested + ordered ? `${requested} requested · ${ordered} ordered` : "None live",
        alert: requested,
        hero: { value: String(requested + ordered), label: "live requisitions" },
        bars: [
          { label: "Requested", value: requested, display: String(requested) },
          { label: "Ordered", value: ordered, display: String(ordered) },
        ],
      };
    },
  },
  "ar-aging": {
    load: async () => {
      const j = await getJson("/api/ar-aging");
      const invoices = (j.invoices ?? []) as unknown[];
      const buckets = (j.buckets ?? []) as { short: string; amount: number }[];
      return {
        text: `${invoices.length} open · ${money0(Number(j.totalOverdue ?? 0))} overdue`,
        hero: { value: money0(Number(j.totalOutstanding ?? 0)), label: "receivable" },
        bars: buckets.map((b) => ({ label: b.short, value: b.amount, display: money0(b.amount) })),
      };
    },
  },
  "time-off": {
    gate: "time-off-admin",
    load: async () => {
      const j = await getJson("/api/time-off/requests?scope=all");
      const n = ((j.requests ?? []) as { status?: string }[]).filter(
        (r) => r.status === "pending",
      ).length;
      return { text: n ? `${n} to approve` : "", alert: n };
    },
  },
  "bill-review": {
    load: async () => {
      const n = ((await getJson("/api/bill-review")).bills as unknown[] | undefined)?.length ?? 0;
      return { text: n ? `${n} flagged` : "", alert: n };
    },
  },
  requests: {
    load: async () => {
      const rows = ((await getJson("/api/feature-requests")).requests ?? []) as {
        status?: string;
      }[];
      const n = rows.filter((r) => r.status === "open").length;
      return { text: n ? `${n} open` : "" };
    },
  },
  email: {
    load: async () => {
      const n = Number((await getJson("/api/stuck-vendors")).billCount ?? 0);
      return { text: n ? `${n} stuck` : "", alert: n };
    },
  },
};

/** The signals above that carry a headline — what a card's Headline picker offers. */
const HERO_VIEWS = new Set(["recode", "requisitions", "ar-aging"]);

/**
 * The signal for every page on the cards the reader can open. Each loader runs
 * once per visit; a failure is no signal, never a broken card.
 */
function useSignals(views: string[], badges: Record<string, number>) {
  const access = useAccess();
  const [loaded, setLoaded] = useState<Record<string, Signal>>({});
  const key = [...new Set(views)].sort().join(",");

  useEffect(() => {
    let alive = true;
    for (const view of key.split(",")) {
      const s = SIGNALS[view];
      if (!s || !access.can(view) || (s.gate && !access.can(s.gate))) continue;
      s.load()
        .then((sig) => {
          if (alive && sig) setLoaded((m) => ({ ...m, [view]: sig }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [key, access]);

  // The queue counts the page already reads (Needs Project, Time Sync).
  return useMemo(() => {
    const out = { ...loaded };
    for (const [view, n] of Object.entries(badges)) {
      if (n > 0) out[view] = { text: `${n} waiting`, alert: n };
    }
    return out;
  }, [loaded, badges]);
}

/* ------------------------------------------------------------------ cards */

/**
 * Cards per row, per width — the admin's "Menus per row" is the widest step.
 * Static strings, because Tailwind cannot see a class built at runtime.
 */
const GRID_CLS: Record<number, string> = {
  1: "pad:mx-auto pad:max-w-2xl",
  2: "pad:grid-cols-2",
  3: "pad:grid-cols-2 xl:grid-cols-3",
  4: "pad:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
};

/** The headline a card leads with: its chosen page's, or the first one that has one. */
function headlineFor(menu: NavMenu, signals: Record<string, Signal>): Signal | null {
  if (menu.summary === "") return null;
  const views = menu.summary ? [menu.summary] : menu.items.map((i) => i.view);
  for (const v of views) if (signals[v]?.hero) return signals[v];
  return null;
}

/** The headline: one figure, and a bar per part of it (a single series, one colour). */
function Headline({ s }: { s: Signal }) {
  const max = Math.max(1, ...(s.bars ?? []).map((b) => b.value));
  return (
    <div className="border-b border-line-soft pb-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums tracking-tight">{s.hero!.value}</span>
        <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
          {s.hero!.label}
        </span>
      </div>
      {s.bars && s.bars.length > 0 && (
        <ul className="mt-2 space-y-1">
          {s.bars.map((b) => (
            <li
              key={b.label}
              title={`${b.label}: ${b.display}`}
              className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-[11px]"
            >
              <span className="truncate text-neutral-500 dark:text-neutral-400">{b.label}</span>
              <span className="h-2 rounded-full bg-neutral-100 dark:bg-white/5">
                <span
                  className="block h-2 rounded-full"
                  style={{
                    width: `${(b.value / max) * 100}%`,
                    background: "var(--viz-1)",
                  }}
                />
              </span>
              <span className="tabular-nums text-neutral-600 dark:text-neutral-300">
                {b.display}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A fresh unique id for a new card or page row. */
function newId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** What is being dragged: a whole card, or one page row out of a card. */
type Drag = { kind: "menu"; id: string } | { kind: "item"; menuId: string; id: string } | null;

export function HomeCards({
  qs,
  badges,
  onAdvanced,
}: {
  qs: string;
  badges: Record<string, number>;
  /** Opens the full form editor (buttons, custom links, descriptions). */
  onAdvanced: () => void;
}) {
  const access = useAccess();
  const c = useCopy();
  const router = useRouter();
  const { menus, items: topItems, columns, isCustom } = useEffectiveLayout();

  /* On the SHIPPED layout the wording resolves through the copy registry, so an
     office Page-Text edit still shows; a saved layout's strings are its own. */
  const resolved = useMemo<NavMenu[]>(
    () =>
      menus.map((m) => ({
        ...m,
        title: isCustom ? m.title : c(`home.area.${m.id}.title`) || m.title,
        items: m.items.map((it) => ({
          ...it,
          label: isCustom ? it.label : c(`home.dest.${it.view}.label`) || it.label,
          desc: isCustom ? it.desc : c(`home.dest.${it.view}.desc`) || it.desc,
        })),
      })),
    [menus, isCustom, c],
  );

  // null = viewing; an array = the edit draft.
  const [draft, setDraft] = useState<NavMenu[] | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editing = draft !== null;

  const signals = useSignals(
    resolved.flatMap((m) => m.items.map((i) => i.view)),
    badges,
  );

  const shown = (draft ?? resolved)
    .map((m) => ({
      ...m,
      items: editing ? m.items : m.items.filter((it) => it.view === "" || access.can(it.view)),
    }))
    .filter((m) => editing || m.items.length > 0);

  /* --------------------------------------------------------- draft edits */
  const patch = (id: string, p: Partial<NavMenu>) =>
    setDraft((d) => d && d.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const addPage = (menuId: string, view: string) => {
    const page = PAGE_CATALOG.flatMap((g) => g.pages).find((p) => p.view === view);
    if (!page) return;
    const item: NavItem = { id: newId("item"), kind: "link", ...page };
    setDraft((d) => d && d.map((m) => (m.id === menuId ? { ...m, items: [...m.items, item] } : m)));
  };

  /** Drop what is being dragged onto a card, before `beforeItemId` or at the end. */
  const drop = (e: DragEvent, menuId: string, beforeItemId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!drag || !draft) return;
    if (drag.kind === "menu") {
      if (drag.id === menuId) return;
      const from = draft.findIndex((m) => m.id === drag.id);
      const next = draft.slice();
      const [moved] = next.splice(from, 1);
      next.splice(next.findIndex((m) => m.id === menuId), 0, moved);
      setDraft(next);
    } else {
      const item = draft.find((m) => m.id === drag.menuId)?.items.find((i) => i.id === drag.id);
      if (!item || item.id === beforeItemId) return;
      // A page moving into a card is always a list row there.
      const moved = { ...item, kind: "link" as const };
      setDraft(
        draft
          .map((m) => (m.id === drag.menuId ? { ...m, items: m.items.filter((i) => i.id !== item.id) } : m))
          .map((m) => {
            if (m.id !== menuId) return m;
            const at = beforeItemId ? m.items.findIndex((i) => i.id === beforeItemId) : -1;
            const items = m.items.slice();
            items.splice(at < 0 ? items.length : at, 0, moved);
            return { ...m, items };
          }),
      );
    }
    setDrag(null);
  };

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/home-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: { version: 1, columns, items: topItems, menus: draft } }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
      router.refresh();
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function revert() {
    if (!confirm("Put back the original cards? Your changes will be discarded.")) return;
    setSaving(true);
    try {
      await fetch("/api/admin/home-layout", { method: "DELETE" });
      router.refresh();
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {editing && (
        <Banner tone="info">
          Drag a card by its title to move it, or drag a page to another card. Nothing changes until
          you tap <strong>Save</strong>.
        </Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}

      <div className={`grid items-start gap-3 ${GRID_CLS[columns] ?? GRID_CLS[3]}`}>
        {shown.map((menu) => {
          const head = editing ? null : headlineFor(menu, signals);
          const onCard = new Set(menu.items.map((i) => i.view));
          const heroViews = menu.items.filter((i) => HERO_VIEWS.has(i.view));
          return (
            <Card
              key={menu.id}
              className={`space-y-3 transition ${
                drag?.kind === "menu" && drag.id === menu.id ? "opacity-40" : ""
              } ${editing ? "border-dashed" : ""}`}
              onDragOver={editing ? (e) => e.preventDefault() : undefined}
              onDrop={editing ? (e) => drop(e, menu.id) : undefined}
            >
              {/* Title row. In edit mode the grip drags the card. */}
              {editing ? (
                <div
                  draggable
                  onDragStart={() => setDrag({ kind: "menu", id: menu.id })}
                  onDragEnd={() => setDrag(null)}
                  className="flex cursor-grab items-center gap-1"
                >
                  <span aria-hidden className="select-none text-neutral-400">
                    ⋮⋮
                  </span>
                  <QuietInput
                    aria-label="Card title"
                    value={menu.title}
                    onChange={(e) => patch(menu.id, { title: e.target.value })}
                    className="text-base font-bold"
                  />
                  <IconButton
                    label="Delete card"
                    tone="danger"
                    onClick={() => {
                      if (
                        menu.items.length === 0 ||
                        confirm(`Delete the "${menu.title}" card and its ${menu.items.length} page(s)?`)
                      )
                        setDraft((d) => d && d.filter((m) => m.id !== menu.id));
                    }}
                  >
                    ✕
                  </IconButton>
                </div>
              ) : (
                <h2 className="text-base font-bold tracking-tight">{menu.title}</h2>
              )}

              {head && <Headline s={head} />}

              <ul className="-mx-3 divide-y divide-line-soft">
                {menu.items.map((it) => {
                  const sig = signals[it.view];
                  if (editing) {
                    return (
                      <li
                        key={it.id}
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setDrag({ kind: "item", menuId: menu.id, id: it.id });
                        }}
                        onDragEnd={() => setDrag(null)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => drop(e, menu.id, it.id)}
                        className={`flex min-h-10 cursor-grab items-center gap-2 px-3 text-sm ${
                          drag?.kind === "item" && drag.id === it.id ? "opacity-40" : ""
                        }`}
                      >
                        <span aria-hidden className="select-none text-neutral-400">
                          ⋮⋮
                        </span>
                        <span className="min-w-0 flex-1 truncate">{it.label}</span>
                        <IconButton
                          label={`Remove ${it.label}`}
                          onClick={() =>
                            patch(menu.id, { items: menu.items.filter((x) => x.id !== it.id) })
                          }
                        >
                          ✕
                        </IconButton>
                      </li>
                    );
                  }
                  return (
                    <li key={it.id}>
                      <Link
                        href={it.href + qs}
                        title={it.desc || undefined}
                        className="group flex min-h-10 items-center gap-2 px-3 py-1.5 text-sm transition hover:bg-accent/5 dark:hover:bg-white/5"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium group-hover:text-accent">
                          {it.label}
                        </span>
                        {sig?.text && (
                          <span className="shrink-0 text-[11.5px] tabular-nums text-neutral-500 dark:text-neutral-400">
                            {sig.alert ? sig.text.replace(/^\d+\s*/, "") : sig.text}
                          </span>
                        )}
                        {!!sig?.alert && <CountBadge n={sig.alert} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {editing && (
                <div className="space-y-2 border-t border-line-soft pt-3">
                  <Select
                    aria-label="Add a page"
                    value=""
                    onChange={(e) => addPage(menu.id, e.target.value)}
                  >
                    <option value="">+ Add a page…</option>
                    {PAGE_CATALOG.map((g) => (
                      <optgroup key={g.id} label={g.title}>
                        {g.pages
                          .filter((p) => !onCard.has(p.view))
                          .map((p) => (
                            <option key={p.view} value={p.view}>
                              {p.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </Select>
                  {heroViews.length > 0 && (
                    <Select
                      aria-label="Headline"
                      value={menu.summary ?? "auto"}
                      onChange={(e) =>
                        patch(menu.id, {
                          summary: e.target.value === "auto" ? undefined : e.target.value,
                        })
                      }
                    >
                      <option value="auto">Headline: automatic</option>
                      <option value="">Headline: none</option>
                      {heroViews.map((i) => (
                        <option key={i.id} value={i.view}>
                          Headline: {i.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              )}
            </Card>
          );
        })}

        {editing && (
          <button
            type="button"
            onClick={() =>
              setDraft((d) => d && [...d, { id: newId("menu"), title: "New card", blurb: "", items: [] }])
            }
            className="min-h-24 rounded-xl border border-dashed border-line-strong text-sm font-semibold text-neutral-500 transition hover:border-accent hover:text-accent"
          >
            + Add a card
          </button>
        )}
      </div>

      {access.role === "admin" &&
        (editing ? (
          <StickyActionBar>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                onAdvanced();
              }}
              className="text-xs font-semibold text-neutral-500 hover:text-accent"
            >
              More options
            </button>
            {isCustom && (
              <button
                type="button"
                onClick={() => void revert()}
                disabled={saving}
                className="ml-auto text-xs text-neutral-500 underline disabled:opacity-50"
              >
                Revert to original
              </button>
            )}
          </StickyActionBar>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setDraft(resolved)}
              className="text-[11px] font-semibold text-accent hover:underline dark:text-accent-soft"
            >
              Edit home page
            </button>
          </div>
        ))}
    </div>
  );
}
