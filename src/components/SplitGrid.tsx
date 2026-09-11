"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The three-up workbench row — budget rail | bills | coding — with a drag
 * handle between each pair.
 *
 * Widths are `fr` fractions summing to 3, so the row still fills whatever the
 * screen gives it. They live in localStorage under one key for every page that
 * uses this shape: the three panels mean the same thing on each, so a split set
 * on the month's bills should hold when you open a job.
 *
 * Only the `xl` layout is split. Below that the grid falls back to the classes
 * the caller passes (one column on a phone), and the handles are `display:none`
 * — which takes them out of the grid entirely rather than leaving empty tracks.
 *
 * `hideFirst` closes the first panel down to a narrow FIXED strip, not to zero:
 * the caller puts its reopen tab in there, and a tab positioned over the next
 * panel covers the figures it is parked on.
 *
 * Fixed, not `max-content`, and that is not a style choice. The tab is set in a
 * vertical writing mode, and a grid track cannot measure an orthogonal flow's
 * intrinsic inline size — there is no block size to resolve it against during
 * the sizing pass — so `max-content` came out short and the tab spilled into
 * the column beside it. A number the caller and this file agree on cannot.
 *
 * The panel is not unmounted, so the width it was dragged to comes back with it.
 */

/** Width of one handle track, in px. It IS the gutter at xl (`xl:gap-x-0`). */
const HANDLE_PX = 20;
/**
 * Width of the first track once `hideFirst` closes it — room for a reopen tab
 * plus its gutter. Keep in step with the caller's own `lg:` column class; the
 * two are the same measurement at two breakpoints (Board.tsx, `railHidden`).
 */
const CLOSED_PX = 56;
const MIN_FR = 0.4;
const KEY = "ts.cols";

type Cols = [number, number, number];

function ColHandle({
  label,
  onPointerDown,
  onNudge,
}: {
  label: string;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onNudge(e.key === "ArrowLeft" ? -0.1 : 0.1);
      }}
      title="Drag to resize · ← → to nudge"
      className="group hidden cursor-col-resize touch-none select-none outline-none xl:flex xl:items-stretch xl:justify-center"
    >
      {/* A hairline at rest, the accent under the pointer — the strip is 20px
          wide so it can be grabbed, but only 1px of it is ever drawn. */}
      <div className="w-px bg-line transition-all group-hover:w-1 group-hover:rounded-full group-hover:bg-accent group-focus:w-1 group-focus:rounded-full group-focus:bg-accent" />
    </div>
  );
}

export function SplitGrid({
  className = "",
  hideFirst = false,
  children,
}: {
  /** Grid classes for the breakpoints below xl (e.g. `lg:grid-cols-2`). */
  className?: string;
  /** Shrink the first panel's track to its content — see the note above. */
  hideFirst?: boolean;
  /** Exactly three panels, in column order. */
  children: ReactNode;
}) {
  const kids = Array.isArray(children) ? children : [children];
  const [cols, setCols] = useState<Cols>([1, 1, 1]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // A drag reads the widths at pointerdown; a state updater would not run until
  // the next render, so the live value is mirrored here.
  const colsRef = useRef(cols);
  colsRef.current = cols;

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && n > 0))
        setCols(v as Cols);
    } catch {
      /* a bad or blocked value just leaves the even split */
    }
  }, []);

  const apply = useCallback((start: Cols, i: 0 | 1, delta: number): Cols => {
    const room = Math.min(start[i + 1] - MIN_FR, Math.max(-(start[i] - MIN_FR), delta));
    const next = [...start] as Cols;
    next[i] = start[i] + room;
    next[i + 1] = start[i + 1] - room;
    return next;
  }, []);

  const remember = useCallback((c: Cols) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* private mode — the split is just per-session then */
    }
  }, []);

  const startDrag = useCallback(
    (i: 0 | 1) => (e: React.PointerEvent<HTMLDivElement>) => {
      const grid = gridRef.current;
      if (!grid) return;
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      // The two handle tracks are fixed px; only the rest is shared by `fr`.
      const flexible = Math.max(grid.getBoundingClientRect().width - 2 * HANDLE_PX, 1);
      const start = colsRef.current;
      const move = (ev: PointerEvent) =>
        setCols(apply(start, i, ((ev.clientX - x0) / flexible) * 3));
      const up = () => {
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        remember(colsRef.current);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    },
    [apply, remember],
  );

  const nudge = useCallback(
    (i: 0 | 1) => (delta: number) => {
      const next = apply(colsRef.current, i, delta);
      setCols(next);
      remember(next);
    },
    [apply, remember],
  );

  return (
    <div
      ref={gridRef}
      style={
        {
          "--tsc": hideFirst
            ? `${CLOSED_PX}px 0px ${cols[1]}fr ${HANDLE_PX}px ${cols[2]}fr`
            : `${cols[0]}fr ${HANDLE_PX}px ${cols[1]}fr ${HANDLE_PX}px ${cols[2]}fr`,
        } as React.CSSProperties
      }
      // `!` on the arbitrary template because two utilities set
      // grid-template-columns, and STYLESHEET order decides which wins.
      className={`grid grid-cols-1 gap-4 transition-[grid-template-columns] duration-300 xl:gap-x-0 xl:![grid-template-columns:var(--tsc)] ${className}`}
    >
      {kids[0]}
      {/* Still rendered while the first panel is closed: the track list has a
          fixed five slots, and dropping a child here would slide every panel
          into the wrong one. Its own track is 0px then, so there is nothing to
          grab. */}
      <ColHandle label="Resize the budget rail" onPointerDown={startDrag(0)} onNudge={nudge(0)} />
      {kids[1]}
      <ColHandle label="Resize the coding panel" onPointerDown={startDrag(1)} onNudge={nudge(1)} />
      {kids[2]}
    </div>
  );
}
