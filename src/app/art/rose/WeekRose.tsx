"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, ChipScroller, FilterChip, SectionLabel } from "@/components/ui";
import { ArtCanvas, ArtPage, CanvasNote, Tip, ease, useArtRows, type DrawFrame } from "../artKit";
import { ROSE_BUCKETS, buildRose, overlaySeries, personSeries, petalRadius, type RoseSeries } from "@/lib/art/rose";
import { WEEKDAYS, hourLabel } from "@/lib/art/weave";

/**
 * WEEK ROSE. 168 petals, one per weekday-hour, Monday 00:00 at the top and
 * running clockwise. A petal's length is the square root of its hours.
 *   - Load:     petals grow from the centre with a stagger around the circle
 *               (1.8 s).
 *   - Change:   every petal tweens to its new length (1 s), staggered by angle.
 *   - At rest:  a very slow breathing, 1.5 % of length.
 * Under prefers-reduced-motion everything lands at once and nothing breathes.
 */

const LOAD_MS = 1800;
const LOAD_SPREAD = 1000;
const CHANGE_MS = 1000;
const CHANGE_SPREAD = 350;
const INNER = 0.12; // inner radius, as a share of the outer ring
const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];
const FONT = "11px ui-sans-serif, system-ui, sans-serif";
const TAU = Math.PI * 2;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const hoursText = (h: number) => `${h.toFixed(1)} h`;
const colorVar = (c: number) => (c >= 0 ? `var(--viz-${(c % 8) + 1})` : "currentColor");

interface Layer {
  key: string;
  color: number;
  r0: Float32Array;
  r1: Float32Array;
  a0: number;
  a1: number;
  out: boolean;
}

interface Run {
  start: number;
  dur: number;
  spread: number;
}

export function WeekRose() {
  const { rows, error } = useArtRows("labor");
  const rose = useMemo(() => (rows ? buildRose(rows) : null), [rows]);
  const [person, setPerson] = useState<string | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number; w: number } | null>(null);

  const layers = useRef<Layer[]>([]);
  const run = useRef<Run>({ start: 0, dur: LOAD_MS, spread: LOAD_SPREAD });
  const reducedRef = useRef(false);
  const hoverRef = useRef(-1);
  hoverRef.current = hover ? hover.i : -1;

  const personIdx = useMemo(() => (rose && person ? rose.people.findIndex((p) => p.name === person) : -1), [rose, person]);

  /** The roses on show, and the largest bucket among them. */
  const shown = useMemo(() => {
    if (!rose) return { series: [] as RoseSeries[], max: 0 };
    const one = personIdx >= 0 ? personSeries(rose, personIdx) : null;
    const series = one ? [one] : overlaySeries(rose);
    let max = 0;
    for (const s of series) for (let b = 0; b < ROSE_BUCKETS; b++) max = Math.max(max, s.buckets[b]);
    return { series, max };
  }, [rose, personIdx]);

  const legend = useMemo(() => (rose ? overlaySeries(rose) : []), [rose]);

  // Retarget the layers to the roses on show.
  useEffect(() => {
    if (!rose) return;
    const now = performance.now();
    const r = run.current;
    const first = layers.current.length === 0;
    const tg = clamp01((now - r.start) / r.dur);
    const prev = new Map(layers.current.map((l) => [l.key, l]));
    const rest = shown.series.length === 1 ? 0.8 : 0.34;
    const nowRadii = (l: Layer) => {
      const out = new Float32Array(ROSE_BUCKETS);
      for (let i = 0; i < ROSE_BUCKETS; i++) {
        const t = reducedRef.current ? 1 : clamp01((now - r.start - (i / ROSE_BUCKETS) * r.spread) / (r.dur - r.spread));
        out[i] = l.r0[i] + (l.r1[i] - l.r0[i]) * ease(t);
      }
      return out;
    };
    const next: Layer[] = [];
    for (const l of layers.current) {
      if (shown.series.some((s) => s.key === l.key)) continue;
      next.push({ ...l, r0: nowRadii(l), r1: new Float32Array(ROSE_BUCKETS), a0: l.a0 + (l.a1 - l.a0) * tg, a1: 0, out: true });
    }
    for (const s of shown.series) {
      const old = prev.get(s.key);
      const r1 = new Float32Array(ROSE_BUCKETS);
      for (let i = 0; i < ROSE_BUCKETS; i++) r1[i] = petalRadius(s.buckets[i], shown.max);
      next.push({
        key: s.key,
        color: s.color,
        r0: old ? nowRadii(old) : new Float32Array(ROSE_BUCKETS),
        r1,
        a0: old ? old.a0 + (old.a1 - old.a0) * tg : rest,
        a1: rest,
        out: false,
      });
    }
    layers.current = next;
    run.current = first
      ? { start: now, dur: LOAD_MS, spread: LOAD_SPREAD }
      : { start: now, dur: CHANGE_MS, spread: CHANGE_SPREAD };
  }, [rose, shown]);

  const geometry = (w: number, h: number) => {
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 24;
    return { cx, cy, R, r0: R * INNER };
  };

  const draw = (f: DrawFrame) => {
    const { ctx, w, h, now, colors, ink, quiet, reduced } = f;
    reducedRef.current = reduced;
    if (!rose) return;
    const { cx, cy, R, r0 } = geometry(w, h);
    const pt = (r: number, a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const angleOf = (i: number) => -Math.PI / 2 + (i / ROSE_BUCKETS) * TAU;

    // Rings at 25, 50, 75 and 100 %.
    ctx.strokeStyle = quiet;
    ctx.lineWidth = 1;
    for (const q of [0.25, 0.5, 0.75, 1]) {
      ctx.globalAlpha = q === 1 ? 0.3 : 0.14;
      ctx.beginPath();
      ctx.arc(cx, cy, r0 + (R - r0) * q, 0, TAU);
      ctx.stroke();
    }
    // Spokes at each day boundary, and the day initials outside the ring.
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (let d = 0; d < 7; d++) {
      const [x0, y0] = pt(r0, angleOf(d * 24));
      const [x1, y1] = pt(R, angleOf(d * 24));
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = quiet;
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let d = 0; d < 7; d++) {
      const [x, y] = pt(R + 14, angleOf(d * 24 + 12));
      ctx.fillText(DAY_INITIALS[d], x, y);
    }

    // The petals.
    const r = run.current;
    const tg = reduced ? 1 : clamp01((now - r.start) / r.dur);
    if (tg >= 1 && layers.current.some((l) => l.out)) layers.current = layers.current.filter((l) => !l.out);
    const breath = reduced ? 1 : 1 + 0.015 * Math.sin(now / 2400);
    const half = (Math.PI / ROSE_BUCKETS) * 0.92;
    const span = Math.max(1, r.dur - r.spread);
    for (const l of layers.current) {
      const alpha = l.a0 + (l.a1 - l.a0) * ease(tg);
      if (alpha <= 0.01) continue;
      const colour = l.color >= 0 ? colors[l.color % colors.length] : quiet;
      ctx.fillStyle = colour;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 0.8;
      for (let i = 0; i < ROSE_BUCKETS; i++) {
        const t = reduced ? 1 : clamp01((now - r.start - (i / ROSE_BUCKETS) * r.spread) / span);
        const n = l.r0[i] + (l.r1[i] - l.r0[i]) * ease(t);
        const len = (R - r0) * n * breath;
        if (len < 0.6) continue;
        const a = angleOf(i + 0.5);
        const [bx0, by0] = pt(r0, a - half);
        const [bx1, by1] = pt(r0, a + half);
        const [cx0, cy0] = pt(r0 + len * 0.6, a - half * 1.4);
        const [cx1, cy1] = pt(r0 + len * 0.6, a + half * 1.4);
        const [tx, ty] = pt(r0 + len, a);
        ctx.beginPath();
        ctx.moveTo(bx0, by0);
        ctx.quadraticCurveTo(cx0, cy0, tx, ty);
        ctx.quadraticCurveTo(cx1, cy1, bx1, by1);
        ctx.closePath();
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = Math.min(1, alpha + 0.3);
        ctx.stroke();
      }
    }

    // The petal under the pointer.
    const hv = hoverRef.current;
    if (hv >= 0) {
      const a = angleOf(hv + 0.5);
      const [x0, y0] = pt(r0, a);
      const [x1, y1] = pt(R, a);
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const point = (x: number, y: number, w: number, h: number) => {
    const { cx, cy, R, r0 } = geometry(w, h);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < r0 * 0.6 || dist > R + 10) return setHover(null);
    const a = (((Math.atan2(y - cy, x - cx) + Math.PI / 2) % TAU) + TAU) % TAU;
    setHover({ i: Math.min(ROSE_BUCKETS - 1, Math.floor((a / TAU) * ROSE_BUCKETS)), x, y, w });
  };

  const choose = (name: string | null) => {
    setHover(null);
    setPerson(name);
  };

  const tip = (() => {
    if (!hover) return null;
    const day = Math.floor(hover.i / 24);
    const hour = hover.i % 24;
    const lines = shown.series
      .map((s) => ({ name: s.name, hours: s.buckets[hover.i], share: s.total > 0 ? s.buckets[hover.i] / s.total : 0 }))
      .filter((s) => s.hours > 0)
      .sort((a, b) => b.hours - a.hours);
    return { head: `${WEEKDAYS[day]} ${hourLabel(hour)}–${hourLabel(hour + 1)}`, lines: lines.slice(0, 3), more: lines.length - 3 };
  })();

  const empty = !!rows && !rose?.people.length;

  return (
    <ArtPage title="Week Rose" description="Crew hours folded onto one week. Each petal is a weekday hour, Monday at the top, running clockwise.">
      {rose && rose.people.length > 0 && (
        <>
          <SectionLabel className="mb-1.5">Who</SectionLabel>
          <ChipScroller className="mb-3">
            <FilterChip on={person === null} onClick={() => choose(null)}>
              Everyone overlaid
            </FilterChip>
            {rose.people.map((p) => (
              <FilterChip key={p.name} on={person === p.name} onClick={() => choose(p.name)}>
                {p.name}
              </FilterChip>
            ))}
          </ChipScroller>
        </>
      )}

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      <ArtCanvas
        draw={draw}
        aspect={0.9}
        label={rose ? `Polar chart of ${Math.round(rose.total).toLocaleString("en-US")} crew hours by weekday and hour` : "Loading the rose"}
        onPointer={point}
        onLeave={() => setHover(null)}
      >
        {!rows && !error && <CanvasNote>Reading crew time from JobTread…</CanvasNote>}
        {empty && <CanvasNote>No crew time to draw yet.</CanvasNote>}
        {tip && hover && (
          <Tip x={hover.x} y={hover.y} w={hover.w}>
            <div className="font-semibold">{tip.head}</div>
            {tip.lines.length === 0 && <div className="text-neutral-500">No hours</div>}
            {tip.lines.map((l) => (
              <div key={l.name}>
                <span className="font-mono">{hoursText(l.hours)}</span>{" "}
                <span className="text-neutral-500">
                  {l.name}, {(l.share * 100).toFixed(1)}% of their week
                </span>
              </div>
            ))}
            {tip.more > 0 && <div className="text-neutral-500">and {tip.more} more</div>}
          </Tip>
        )}
      </ArtCanvas>

      {legend.length > 0 && (
        <section className="mt-4">
          <SectionLabel className="mb-1.5">Roses — tap one to see it alone</SectionLabel>
          <ul className="grid gap-x-4 pad:grid-cols-2">
            {legend.map((s) => {
              const pickable = s.person >= 0;
              const on = person === s.name;
              const dim = person !== null && !on;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    disabled={!pickable}
                    onClick={() => choose(on ? null : s.name)}
                    aria-pressed={pickable ? on : undefined}
                    className={`flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm transition ${
                      on ? "bg-neutral-100 dark:bg-white/[0.07]" : ""
                    } ${dim ? "opacity-50" : ""}`}
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full text-neutral-400"
                      style={{ background: colorVar(s.color) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="font-mono text-xs text-neutral-500">{Math.round(s.total).toLocaleString("en-US")} h</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </ArtPage>
  );
}
