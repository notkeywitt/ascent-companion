"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAccess } from "@/components/AccessProvider";
import { Button, Input, Textarea, EmptyState, SectionLabel } from "@/components/ui";
import { guidePathKey, selectorFor, type GuideTopic } from "@/lib/pageGuide";

/**
 * THE HELP OVERLAY — "what is that thing on the screen?", answered on the
 * screen it is about.
 *
 * A mark in the bottom-left corner of every page opens it. The app itself is
 * not screenshotted or redrawn: it is SCALED IN PLACE (one transform on
 * `#app-shell`) into the top-right of the overlay, so what the reader studies
 * is the live page they were just using — their job, their month, their data.
 * The left pane lists the page's elements, the bottom pane carries the chosen
 * one's description, and an arrow is drawn from the list item to the element
 * itself.
 *
 * The topics are DATA (src/lib/pageGuide.ts → the `page_guides` table), written
 * by an admin from inside this overlay: Edit → Add element → tap the thing.
 * The selector is captured from that tap, so nobody types CSS.
 *
 * NARROW SCREENS get the list and the description with no scaled page and no
 * arrow: a phone cannot show a readable page at 60% beside two panes. The words
 * are the part that has to survive; the picture is what gets dropped.
 */

const LIST_W = 268; // left pane, px
const DETAIL_H = 208; // bottom pane, px
const PAD = 14;
const TOP = 52; // the overlay's own title row

type Pt = { x: number; y: number };

/** Undo every style the overlay sets on the shell. */
function clear(shell: HTMLElement) {
  for (const k of ["transform", "transformOrigin", "position", "zIndex", "pointerEvents", "cursor"] as const) {
    shell.style[k] = "";
  }
}

export function PageGuide() {
  const pathname = usePathname() || "/";
  const path = guidePathKey(pathname);
  const { role } = useAccess();
  const isAdmin = role === "admin";

  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState<GuideTopic[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wide, setWide] = useState(false);
  const [arrow, setArrow] = useState<{ from: Pt; to: Pt; box: DOMRect } | null>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});

  const topic = topics.find((t) => t.id === selected) ?? null;

  /* ---------------------------------------------------------------- load */
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch(`/api/page-guide?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        const list: GuideTopic[] = d.topics ?? [];
        setTopics(list);
        setSelected((s) => s ?? list[0]?.id ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, path]);

  /* ------------------------------------------------- scale the live page */
  useEffect(() => {
    const shell = document.getElementById("app-shell");
    if (!shell) return;
    const apply = () => {
      const w = window.innerWidth >= 744;
      setWide(w);
      if (!open || !w) {
        clear(shell);
        return;
      }
      const scale = (window.innerWidth - LIST_W - PAD * 3) / window.innerWidth;
      shell.style.transformOrigin = "0 0";
      shell.style.transform = `translate(${LIST_W + PAD * 2}px, ${TOP}px) scale(${scale})`;
      // The shell has to sit ABOVE the overlay's backdrop, or the backdrop eats
      // every tap meant for the page — which is what stopped Pick element
      // working — and dims the page nobody can then read.
      shell.style.position = "relative";
      shell.style.zIndex = "35";
      // The page is a picture while the overlay is up — until an admin is
      // picking the element a topic points at, which is the one moment a tap
      // on the page means something.
      shell.style.pointerEvents = picking ? "auto" : "none";
      shell.style.cursor = picking ? "crosshair" : "";
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      clear(shell);
    };
  }, [open, picking]);

  /* --------------------------------------------------------- the arrow */
  const drawArrow = useCallback(() => {
    if (!open || !wide || !topic?.selector) return setArrow(null);
    let el: Element | null = null;
    try {
      el = document.querySelector(topic.selector);
    } catch {
      el = null; // a hand-edited selector must not throw here
    }
    const row = rowRefs.current[topic.id];
    if (!el || !row) return setArrow(null);
    const box = el.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const from = { x: r.right - 4, y: r.top + r.height / 2 };
    // Closest point on the element's box — the shortest arrow that still lands.
    const to = {
      x: Math.min(Math.max(from.x, box.left), box.right),
      y: Math.min(Math.max(from.y, box.top), box.bottom),
    };
    setArrow({ from, to, box });
  }, [open, wide, topic]);

  useEffect(() => {
    drawArrow();
    if (!open) return;
    window.addEventListener("scroll", drawArrow, true);
    window.addEventListener("resize", drawArrow);
    return () => {
      window.removeEventListener("scroll", drawArrow, true);
      window.removeEventListener("resize", drawArrow);
    };
  }, [open, drawArrow]);

  /* Bring the chosen element into the stage when it is off it. */
  useEffect(() => {
    if (!open || !wide || !topic?.selector) return;
    let el: Element | null = null;
    try {
      el = document.querySelector(topic.selector);
    } catch {
      return;
    }
    if (!el) return;
    const box = el.getBoundingClientRect();
    const floor = window.innerHeight - DETAIL_H - PAD * 2;
    const scale = (window.innerWidth - LIST_W - PAD * 3) / window.innerWidth;
    if (box.top < TOP + 16) window.scrollBy(0, (box.top - TOP - 48) / scale);
    else if (box.bottom > floor) window.scrollBy(0, (box.bottom - floor + 24) / scale);
  }, [open, wide, topic]);

  /* ------------------------------------------------- pick an element */
  useEffect(() => {
    if (!picking) return;
    const inShell = (e: Event) => {
      const el = e.target as Element | null;
      return !!el && !!document.getElementById("app-shell")?.contains(el);
    };
    // A press on the page must not ALSO drive the page: half these controls act
    // on pointerdown, long before the click we listen for. Every event in the
    // press is swallowed at capture, so the tap only ever names an element.
    const swallow = (e: Event) => {
      if (!inShell(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const grab = (e: MouseEvent) => {
      if (!inShell(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.target as Element;
      const selector = selectorFor(el);
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      setPicking(false);
      setDirty(true);
      if (selected) {
        setTopics((list) => list.map((t) => (t.id === selected ? { ...t, selector } : t)));
        return;
      }
      const id = Math.random().toString(36).slice(2, 10);
      setTopics((list) => [...list, { id, label: text || "New element", selector, body: "" }]);
      setSelected(id);
    };
    const press = ["pointerdown", "mousedown", "touchstart", "mouseup", "pointerup"];
    for (const type of press) document.addEventListener(type, swallow, true);
    document.addEventListener("click", grab, true);
    return () => {
      for (const type of press) document.removeEventListener(type, swallow, true);
      document.removeEventListener("click", grab, true);
    };
  }, [picking, selected]);

  /* Esc closes; the browser back gesture is not in play here. */
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picking) setPicking(false);
      else setOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, picking]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/page-guide", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, topics }),
      });
      if (res.ok) setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  function patch(id: string, fields: Partial<GuideTopic>) {
    setTopics((l) => l.map((t) => (t.id === id ? { ...t, ...fields } : t)));
    setDirty(true);
  }

  /* ------------------------------------------------------------- render */
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help for this page"
        className="fixed bottom-0 left-0 z-40 flex h-8 w-8 items-center justify-center text-sm text-neutral-400/70 transition hover:text-accent"
      >
        ?
      </button>
    );
  }

  const list = (
    <div className="flex h-full flex-col gap-2 overflow-y-auto">
      <SectionLabel>On this page</SectionLabel>
      {topics.length === 0 && (
        <EmptyState>
          {isAdmin ? "No help yet. Tap Edit, then Add element." : "No help yet for this page."}
        </EmptyState>
      )}
      {topics.map((t) => (
        <div
          key={t.id}
          ref={(n) => {
            rowRefs.current[t.id] = n;
          }}
          className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${
            t.id === selected
              ? "border-accent bg-accent/10 text-accent"
              : "border-line-soft text-neutral-700 dark:text-neutral-300"
          }`}
        >
          <button
            type="button"
            className="flex-1 truncate text-left"
            onClick={() => setSelected(t.id)}
          >
            {t.label}
            {!t.selector && <span className="ml-1 text-xs text-neutral-500">· no element</span>}
          </button>
          {editing && (
            <button
              type="button"
              aria-label={`Delete ${t.label}`}
              className="px-1 text-neutral-500 hover:text-red-600"
              onClick={() => {
                setTopics((l) => l.filter((x) => x.id !== t.id));
                setDirty(true);
                if (selected === t.id) setSelected(null);
              }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {editing && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const id = Math.random().toString(36).slice(2, 10);
            setTopics((l) => [...l, { id, label: "New element", selector: "", body: "" }]);
            setSelected(id);
            setDirty(true);
            if (wide) setPicking(true);
          }}
        >
          Add element
        </Button>
      )}
    </div>
  );

  const detail = (
    <div className="flex h-full flex-col gap-2 overflow-y-auto">
      {!topic && <p className="text-sm text-neutral-500">Select an element on the left.</p>}
      {topic && !editing && (
        <>
          <h3 className="text-sm font-medium">{topic.label}</h3>
          <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
            {topic.body || "No description yet."}
          </p>
        </>
      )}
      {topic && editing && (
        <>
          <div className="flex items-center gap-2">
            <Input
              value={topic.label}
              onChange={(e) => patch(topic.id, { label: e.target.value })}
              placeholder="Element name"
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={() => setPicking(true)} disabled={!wide}>
              {topic.selector ? "Re-pick" : "Pick element"}
            </Button>
          </div>
          <Textarea
            rows={4}
            value={topic.body}
            onChange={(e) => patch(topic.id, { body: e.target.value })}
            placeholder="What this element is, and what the reader does with it."
          />
        </>
      )}
    </div>
  );

  return (
    <>
      {/* The ground behind the scaled page. Opaque panes sit on top of it, so
          the parts of the page that fall outside the stage are covered. */}
      <div className="pointer-events-none fixed inset-0 z-30 bg-ink/80" aria-hidden />

      {/* The arrow and the ring around the chosen element. */}
      {arrow && (
        <svg className="pointer-events-none fixed inset-0 z-40 h-full w-full text-brand" aria-hidden>
          <defs>
            <marker id="pg-head" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <polygon points="0,0 7,3.5 0,7" fill="currentColor" />
            </marker>
          </defs>
          <line
            x1={arrow.from.x}
            y1={arrow.from.y}
            x2={arrow.to.x}
            y2={arrow.to.y}
            stroke="currentColor"
            strokeWidth={3}
            markerEnd="url(#pg-head)"
          />
          <rect
            x={arrow.box.left - 3}
            y={arrow.box.top - 3}
            width={arrow.box.width + 6}
            height={arrow.box.height + 6}
            rx={6}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          />
        </svg>
      )}

      {/* Title row */}
      <div
        className="fixed inset-x-0 top-0 z-50 flex items-center gap-2 px-3"
        style={{ height: TOP }}
      >
        <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">Help</span>
        <span className="truncate text-xs text-neutral-500">{path}</span>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/help" className="text-xs text-neutral-400 hover:text-accent">
            All help ↗
          </Link>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Edit"}
            </Button>
          )}
          {isAdmin && editing && (
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPicking(false);
              setOpen(false);
            }}
          >
            Close
          </Button>
        </div>
      </div>

      {picking && (
        <div className="fixed left-1/2 top-[52px] z-50 -translate-x-1/2 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-accent-fg">
          Tap the element on the page. Esc cancels.
        </div>
      )}

      {/* The two panes. Wide: list at the left, description along the bottom,
          the live page between them. Narrow: one sheet, words only. */}
      {wide ? (
        <>
          <div
            className="fixed z-50 rounded-xl border border-line bg-white p-3 dark:bg-ink-raised"
            style={{ left: PAD, top: TOP, width: LIST_W, bottom: DETAIL_H + PAD * 2 }}
          >
            {list}
          </div>
          <div
            className="fixed z-50 rounded-xl border border-line bg-white p-3 dark:bg-ink-raised"
            style={{ left: PAD, right: PAD, bottom: PAD, height: DETAIL_H }}
          >
            {detail}
          </div>
        </>
      ) : (
        <div
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 rounded-t-xl border-t border-line bg-white p-3 dark:bg-ink-raised"
          style={{ top: TOP }}
        >
          <div className="max-h-[45%] shrink-0 overflow-y-auto">{list}</div>
          <div className="flex-1 overflow-y-auto border-t border-line-soft pt-3">{detail}</div>
        </div>
      )}
    </>
  );
}
