"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui";
import type { CloudSetId } from "@/lib/art/cloud";
import type { ArtRows } from "@/lib/art/rows";
import { SchemePicker, schemeStyle, useArtScheme } from "./SchemePicker";

/**
 * Shared parts for the pieces on /art: the page frame, the row fetch and the
 * animated canvas. A piece supplies its selectors and a `draw` function.
 */

/** The page frame every piece uses: the way back to the gallery, a title, a
 *  line, and the colour scheme picker. The chosen scheme is set as
 *  `--viz-1..8` on this <main>, so it reaches the piece and nothing else. */
export function ArtPage({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  const [scheme, setScheme] = useArtScheme();
  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6 lg:max-w-5xl" style={schemeStyle(scheme)}>
      <Link href="/art" className="text-xs font-semibold text-neutral-500 hover:text-accent">
        ← Art that Makes Itself
      </Link>
      <PageHeader
        title={title}
        description={description}
        actions={<SchemePicker choice={scheme} onChange={setScheme} />}
      />
      {children}
    </main>
  );
}

/** Rows read once per data set per tab; every piece shares the same copy. */
const rowCache = new Map<CloudSetId, Promise<unknown>>();

export function useArtRows<S extends CloudSetId>(set: S): { rows: ArtRows[S] | null; error: string } {
  const [state, setState] = useState<{ set: S; rows: ArtRows[S] | null; error: string }>({
    set,
    rows: null,
    error: "",
  });
  useEffect(() => {
    let live = true;
    let p = rowCache.get(set);
    if (!p) {
      p = fetch(`/api/art/rows?set=${set}`).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `The read failed (HTTP ${res.status}).`);
        return body.rows;
      });
      p.catch(() => rowCache.delete(set));
      rowCache.set(set, p);
    }
    p.then(
      (rows) => live && setState({ set, rows: rows as ArtRows[S], error: "" }),
      (e: unknown) => live && setState({ set, rows: null, error: e instanceof Error ? e.message : "The read failed." }),
    );
    return () => {
      live = false;
    };
  }, [set]);
  return state.set === set ? { rows: state.rows, error: state.error } : { rows: null, error: "" };
}

/** The eight categorical chart colours (`--viz-1..8`) as `el` sees them: the
 *  picked scheme inside an ArtPage, the theme's own elsewhere. */
export function vizColors(el: Element = document.documentElement): string[] {
  const css = getComputedStyle(el);
  return Array.from({ length: 8 }, (_, i) => css.getPropertyValue(`--viz-${i + 1}`).trim() || "#888888");
}

function rgbOf(c: string): [number, number, number] | null {
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Cross-fades the canvas colours when the scheme or theme changes, so a new
 * scheme washes over the piece instead of snapping. `set` starts a fade from
 * whatever is showing; `at` gives the colours for a frame.
 */
export class ColorFade {
  private from: string[] = [];
  private to: string[] = [];
  private t0 = 0;
  constructor(private readonly ms = 700) {}
  set(colors: string[], now: number, instant = false) {
    this.from = this.to.length && !instant ? this.at(now) : colors;
    this.to = colors;
    this.t0 = now;
  }
  at(now: number): string[] {
    const t = Math.min(1, (now - this.t0) / this.ms);
    if (t >= 1 || !this.from.length) return this.to;
    const e = ease(t);
    return this.to.map((c, i) => {
      const a = rgbOf(this.from[i] ?? c);
      const b = rgbOf(c);
      if (!a || !b) return c;
      const mix = a.map((v, k) => Math.round(v + (b[k] - v) * e));
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    });
  }
}

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface DrawFrame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** performance.now() of this frame. */
  now: number;
  colors: string[];
  /** The canvas's text colour (the theme's ink), for marks and labels. */
  ink: string;
  /** Quiet text colour. */
  quiet: string;
  reduced: boolean;
}

/**
 * A canvas that fills its box's width, redraws every animation frame, and
 * re-reads the theme's colours when the theme changes. `draw` comes through a
 * ref, so a piece can pass a fresh closure each render without restarting.
 * `aspect` is height ÷ width, clamped between 300px and 640px tall.
 */
export function ArtCanvas({
  draw,
  aspect = 0.62,
  fill = false,
  label,
  onPointer,
  onLeave,
  onDrag,
  onWheel,
  children,
}: {
  draw: (f: DrawFrame) => void;
  aspect?: number;
  /** Fill the parent box (full screen) instead of a framed, aspect-sized card. */
  fill?: boolean;
  label: string;
  onPointer?: (x: number, y: number, w: number, h: number) => void;
  onLeave?: () => void;
  /** A press-and-move: the movement in pixels since the last move. */
  onDrag?: (dx: number, dy: number) => void;
  /** The wheel or a trackpad scroll over the canvas (the page does not scroll). */
  onWheel?: (dy: number) => void;
  children?: React.ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const size = useRef({ w: 600, h: 400 });

  useEffect(() => {
    const c = canvas.current;
    const box = wrap.current;
    if (!c || !box) return;
    const reduced = prefersReducedMotion();
    const fade = new ColorFade();
    let ink = getComputedStyle(c).color;
    let quiet = ink;
    let first = true;
    const readTheme = () => {
      fade.set(vizColors(c), performance.now(), first || reduced);
      first = false;
      ink = getComputedStyle(c).color;
      const q = document.createElement("span");
      q.className = "text-neutral-500";
      box.appendChild(q);
      quiet = getComputedStyle(q).color;
      q.remove();
    };
    readTheme();
    const fit = () => {
      const w = box.clientWidth;
      const h = fill ? box.clientHeight : Math.round(Math.min(Math.max(w * aspect, 300), 640));
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.height = `${h}px`;
      size.current = { w, h };
      c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    const mo = new MutationObserver(readTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-palette", "style"] });
    // The scheme picker sets --viz-* on the page's <main>.
    const scope = box.closest("main");
    if (scope) mo.observe(scope, { attributes: true, attributeFilter: ["style"] });
    let raf = 0;
    const frame = (now: number) => {
      const ctx = c.getContext("2d");
      if (ctx) {
        const { w, h } = size.current;
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        drawRef.current({ ctx, w, h, now, colors: fade.at(now), ink, quiet, reduced });
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [aspect, fill]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onPointer) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPointer(e.clientX - r.left, e.clientY - r.top, size.current.w, size.current.h);
  };

  // Dragging: track the last position by hand (movementX is 0 for touch on
  // some browsers), and capture the pointer so a drag can leave the canvas.
  const pressed = useRef<{ x: number; y: number } | null>(null);
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    point(e);
    if (!onDrag) return;
    pressed.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    point(e);
    const p = pressed.current;
    if (!onDrag || !p) return;
    onDrag(e.clientX - p.x, e.clientY - p.y);
    pressed.current = { x: e.clientX, y: e.clientY };
  };
  const up = () => {
    pressed.current = null;
  };

  // The wheel needs a non-passive listener to keep the page from scrolling.
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  const wantsWheel = !!onWheel;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !wantsWheel) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      wheelRef.current?.(e.deltaY);
    };
    c.addEventListener("wheel", on, { passive: false });
    return () => c.removeEventListener("wheel", on);
  }, [wantsWheel]);

  return (
    <div
      ref={wrap}
      className={
        fill
          ? "absolute inset-0 overflow-hidden text-neutral-900 dark:text-neutral-100"
          : "relative overflow-hidden rounded-xl border border-line bg-white text-neutral-900 dark:bg-ink-raised dark:text-neutral-100"
      }
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        className="block w-full touch-none"
        onPointerMove={move}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={onLeave}
      />
      {children}
    </div>
  );
}

/** The centred "Reading … from JobTread" line over an empty canvas. */
export function CanvasNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-neutral-500">
      {children}
    </p>
  );
}

/** A small floating label beside the pointer. */
export function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[16rem] rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs shadow-md dark:bg-ink"
      style={{ left: Math.max(4, Math.min(x + 12, w - 260)), top: Math.max(y - 64, 4) }}
    >
      {children}
    </div>
  );
}
