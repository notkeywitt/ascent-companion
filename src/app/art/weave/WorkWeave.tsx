"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, ChipScroller, FilterChip, SectionLabel, Segmented } from "@/components/ui";
import { ArtCanvas, ArtPage, CanvasNote, Tip, ease, useArtRows, type DrawFrame } from "../artKit";
import {
  WEAVE_FIRST_HOUR,
  WEAVE_HOURS,
  WEEKDAYS,
  buildWeave,
  hourLabel,
  weaveStats,
  weaveTarget,
} from "@/lib/art/weave";

/**
 * WORK WEAVE. Every hour the crew worked, on a day × hour grid.
 *   - Load:     a thin line sweeps left to right over 2.5 s; each day-column
 *               fades in as the line passes, like a loom.
 *   - Change:   every cell tweens its intensity and colour over 900 ms, each
 *               column on a small delay, so the change ripples left to right.
 * Under prefers-reduced-motion everything lands at once.
 */

const SWEEP_MS = 2500;
const FADE_MS = 320;
const TWEEN_MS = 900;
const RIPPLE_MS = 600;

const ML = 34;
const MR = 8;
const MT = 8;
const MB = 22;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR_TICKS: [number, string][] = [
  [6, "6a"],
  [9, "9a"],
  [12, "12p"],
  [15, "3p"],
  [18, "6p"],
];
const FONT = "10.5px ui-sans-serif, system-ui, sans-serif";

type Mode = "one" | "person";
const MODES: { value: Mode; label: string }[] = [
  { value: "one", label: "One colour" },
  { value: "person", label: "By person" },
];

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const alphaOf = (v: number) => (v > 0.001 ? 0.14 + 0.84 * v : 0);
const hoursText = (h: number) => `${h.toFixed(1)} h`;

function layout(w: number, h: number, days: number) {
  return { cw: (w - ML - MR) / Math.max(1, days), ch: (h - MT - MB) / WEAVE_HOURS };
}

function dateText(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function cellPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (r > 0.6 && typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

interface Tween {
  v0: Float32Array;
  v1: Float32Array;
  c0: Uint8Array;
  c1: Uint8Array;
  start: number;
}

export function WorkWeave() {
  const { rows, error } = useArtRows("labor");
  const grid = useMemo(() => (rows ? buildWeave(rows) : null), [rows]);
  const [person, setPerson] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("one");
  const [hover, setHover] = useState<{ col: number; row: number; x: number; y: number; w: number } | null>(null);

  const tween = useRef<Tween>({ v0: new Float32Array(0), v1: new Float32Array(0), c0: new Uint8Array(0), c1: new Uint8Array(0), start: 0 });
  const loadStart = useRef(0);
  const reducedRef = useRef(false);
  const hoverRef = useRef<{ col: number; row: number } | null>(null);
  hoverRef.current = hover;

  const personIdx = useMemo(() => (grid && person ? grid.people.findIndex((p) => p.name === person) : -1), [grid, person]);
  const sel = personIdx >= 0 ? personIdx : null;

  // Retarget on every change of data or selector.
  useEffect(() => {
    if (!grid || !grid.days) return;
    const next = weaveTarget(grid, sel, mode === "person");
    const t = tween.current;
    const now = performance.now();
    if (t.v1.length !== next.v.length || reducedRef.current) {
      tween.current = { v0: next.v, v1: next.v, c0: next.c, c1: next.c, start: now - 1e7 };
      return;
    }
    const cols = grid.days;
    const v0 = new Float32Array(t.v1.length);
    const c0 = new Uint8Array(t.v1.length);
    for (let col = 0; col < cols; col++) {
      const e = ease(clamp01((now - t.start - (col / cols) * RIPPLE_MS) / TWEEN_MS));
      for (let r = 0; r < WEAVE_HOURS; r++) {
        const i = col * WEAVE_HOURS + r;
        v0[i] = t.v0[i] + (t.v1[i] - t.v0[i]) * e;
        c0[i] = e < 0.5 ? t.c0[i] : t.c1[i];
      }
    }
    tween.current = { v0, v1: next.v, c0, c1: next.c, start: now };
  }, [grid, sel, mode]);

  const draw = (f: DrawFrame) => {
    const { ctx, w, h, now, colors, ink, quiet, reduced } = f;
    reducedRef.current = reduced;
    if (!grid || !grid.days) return;
    if (!loadStart.current) loadStart.current = now;
    const since = now - loadStart.current;
    const { cw, ch } = layout(w, h, grid.days);
    const t = tween.current;
    const cols = grid.days;
    const gap = cw > 3.5 ? 1 : 0;
    const rad = Math.min(2, cw / 3, ch / 3);

    // Weekend bands.
    ctx.fillStyle = quiet;
    ctx.globalAlpha = 0.09;
    for (let col = 0; col < cols; col++) {
      const wd = (grid.firstDay + col + 3) % 7;
      if (wd === 5 || wd === 6) ctx.fillRect(ML + col * cw, MT, cw, ch * WEAVE_HOURS);
    }

    // Cells.
    for (let col = 0; col < cols; col++) {
      const reveal = reduced ? 1 : clamp01((since - (col / cols) * SWEEP_MS) / FADE_MS);
      if (reveal <= 0) continue;
      const e = reduced ? 1 : ease(clamp01((now - t.start - (col / cols) * RIPPLE_MS) / TWEEN_MS));
      const x = ML + col * cw + gap / 2;
      for (let r = 0; r < WEAVE_HOURS; r++) {
        const i = col * WEAVE_HOURS + r;
        const y = MT + r * ch + gap / 2;
        const draws: [number, number][] =
          t.c0[i] === t.c1[i]
            ? [[t.c1[i], alphaOf(t.v0[i] + (t.v1[i] - t.v0[i]) * e)]]
            : [
                [t.c0[i], alphaOf(t.v0[i]) * (1 - e)],
                [t.c1[i], alphaOf(t.v1[i]) * e],
              ];
        for (const [c, a] of draws) {
          if (a <= 0.004) continue;
          ctx.globalAlpha = a * reveal;
          ctx.fillStyle = colors[c % colors.length];
          cellPath(ctx, x, y, cw - gap, ch - gap, rad);
          ctx.fill();
        }
      }
    }

    // The loom's sweep line.
    if (!reduced && since < SWEEP_MS + FADE_MS) {
      const sx = ML + clamp01(since / SWEEP_MS) * (w - ML - MR);
      ctx.globalAlpha = 0.55 * (1 - clamp01((since - SWEEP_MS) / FADE_MS));
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, MT);
      ctx.lineTo(sx, MT + ch * WEAVE_HOURS);
      ctx.stroke();
    }

    // Hovered cell.
    const hv = hoverRef.current;
    if (hv) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.strokeRect(ML + hv.col * cw, MT + hv.row * ch, Math.max(cw, 2), ch);
    }

    // Labels.
    ctx.globalAlpha = 1;
    ctx.fillStyle = quiet;
    ctx.font = FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const [hr, text] of HOUR_TICKS) ctx.fillText(text, ML - 6, MT + (hr - WEAVE_FIRST_HOUR + 0.5) * ch);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    for (let col = 0; col < cols; col++) {
      const iso = grid.dates[col];
      if (col !== 0 && iso.slice(8) !== "01") continue;
      const label = MONTHS[Number(iso.slice(5, 7)) - 1];
      const x = ML + col * cw;
      if (x + 26 > w) continue;
      ctx.fillText(label, x, h - 6);
    }
  };

  const point = (x: number, y: number, w: number, h: number) => {
    if (!grid || !grid.days) return;
    const { cw, ch } = layout(w, h, grid.days);
    const col = Math.floor((x - ML) / cw);
    const row = Math.floor((y - MT) / ch);
    if (col < 0 || col >= grid.days || row < 0 || row >= WEAVE_HOURS) return setHover(null);
    setHover({ col, row, x, y, w });
  };

  const choose = (name: string | null) => {
    setHover(null);
    setPerson(name);
  };

  // Tip and footer readouts.
  const tip = (() => {
    if (!grid || !hover) return null;
    const i = hover.col * WEAVE_HOURS + hover.row;
    const hour = hover.row + WEAVE_FIRST_HOUR;
    const who = grid.people
      .map((p, k) => ({ name: p.name, hours: grid.byPerson[k][i] }))
      .filter((p) => p.hours > 0 && (sel === null || p.name === person))
      .sort((a, b) => b.hours - a.hours);
    const total = who.reduce((s, p) => s + p.hours, 0);
    return { date: dateText(grid.dates[hover.col]), range: `${hourLabel(hour)}–${hourLabel(hour + 1)}`, total, who: who.slice(0, 3), more: who.length - 3 };
  })();

  const stats = grid && grid.days ? weaveStats(grid, sel) : null;
  const empty = !!rows && !rows.length;

  return (
    <ArtPage title="Work Weave" description="Every hour the crew worked, woven into one calendar. Each column is a day, each row an hour.">
      {grid && grid.people.length > 0 && (
        <>
          <SectionLabel className="mb-1.5">Who</SectionLabel>
          <ChipScroller className="mb-3">
            <FilterChip on={person === null} onClick={() => choose(null)}>
              Everyone
            </FilterChip>
            {grid.people.map((p) => (
              <FilterChip key={p.name} on={person === p.name} onClick={() => choose(p.name)}>
                {p.name}
              </FilterChip>
            ))}
          </ChipScroller>
          <Segmented label="Colour" value={mode} onChange={setMode} options={MODES} size="md" className="mb-3" />
        </>
      )}

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      <ArtCanvas
        draw={draw}
        aspect={0.5}
        label={grid ? `Heat calendar of ${Math.round(grid.total).toLocaleString("en-US")} crew hours across ${grid.days} days` : "Loading the weave"}
        onPointer={point}
        onLeave={() => setHover(null)}
      >
        {!rows && !error && <CanvasNote>Reading crew time from JobTread…</CanvasNote>}
        {empty && <CanvasNote>No crew time to weave yet.</CanvasNote>}
        {tip && hover && (
          <Tip x={hover.x} y={hover.y} w={hover.w}>
            <div className="font-semibold">{tip.date}</div>
            <div className="text-neutral-500">{tip.range}</div>
            <div className="font-mono">{hoursText(tip.total)}</div>
            {tip.who.map((p) => (
              <div key={p.name} className="text-neutral-500">
                {p.name} {hoursText(p.hours)}
              </div>
            ))}
            {tip.more > 0 && <div className="text-neutral-500">and {tip.more} more</div>}
          </Tip>
        )}
      </ArtCanvas>

      {stats && stats.total > 0 && (
        <p className="mt-3 text-sm text-neutral-500">
          {Math.round(stats.total).toLocaleString("en-US")} hours · busiest weekday {WEEKDAYS[stats.weekday]} · busiest hour{" "}
          {hourLabel(stats.hour)}–{hourLabel(stats.hour + 1)}
        </p>
      )}
    </ArtPage>
  );
}
