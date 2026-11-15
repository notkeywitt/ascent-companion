"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RIBBON_SOURCES,
  daysInYear,
  ribbonTotal,
  weekPosition,
  type RibbonJob,
  type RibbonSource,
} from "@/lib/yearRibbon";

/**
 * THE YEAR RIBBON (owner, 2026-11-15). The current year, January to December,
 * on one canvas with no chart library. Ink lines on the page, no colour per job,
 * no panel: printed straight on the page background.
 *
 * It shows ONE series at a time (owner, 2026-11-14): Labor hours (crew hours per
 * work day), Bills (vendor bill cost) or Invoiced to clients (invoice price).
 * A click on any line moves to the next one; the name of the one showing is
 * printed small at the top.
 *
 *   The summation line:  every job's line added, week by week. The heaviest
 *                        line, over a faint fill; every job line sits inside it.
 *   A line per job:      that job's own series from the ground, on the same
 *                        scale. Its name is written inline along the line in
 *                        tiny letters. Biggest jobs are labelled first; a label
 *                        that would overlap one already placed is skipped.
 *
 * It sits faded behind a header line, filling it:
 *   Home       `HomeMasthead`'s `backdrop`, from `/api/home/ribbon` (the
 *              largest jobs plus "Other").
 *   Jobs page  the same `HomeMasthead`, from `/api/jobs-hub/ribbon` (every
 *              job), the picked job in place of the date. `focusId` keeps the picked job's line and fades the rest.
 *
 * It draws itself from January to today once, when it loads; the labels come
 * in when the line is drawn. It hides itself when the read fails or holds nothing.
 */

interface Payload {
  year: number;
  today: string;
  jobs: RibbonJob[];
  error?: string;
}

const DRAW_MS = 2400;
/** The labels' letter height (px). The job lines are 1px; this is as small as
 *  letters stay letters. */
const LABEL_PX = 6.5;
/** How near a click must land to a line to count (px). */
const HIT_PX = 7;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

type Pt = [number, number];

/** The soft curve through `pts` (quadratic through the midpoints), sampled. */
function sampleSoft(pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]];
  let cur = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i];
    const end: Pt = [(c[0] + pts[i + 1][0]) / 2, (c[1] + pts[i + 1][1]) / 2];
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      out.push([u * u * cur[0] + 2 * u * t * c[0] + t * t * end[0], u * u * cur[1] + 2 * u * t * c[1] + t * t * end[1]]);
    }
    cur = end;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Running arc length along a sampled line. */
function arcLengths(p: Pt[]): number[] {
  const s = [0];
  for (let i = 1; i < p.length; i++) s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return s;
}

/** The point and direction at arc length `at`. */
function pointAt(p: Pt[], s: number[], at: number): { x: number; y: number; a: number } {
  let i = 1;
  while (i < s.length - 1 && s[i] < at) i++;
  const seg = s[i] - s[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (at - s[i - 1]) / seg));
  const [x0, y0] = p[i - 1];
  const [x1, y1] = p[i];
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, a: Math.atan2(y1 - y0, x1 - x0) };
}

/** The line's y at screen x (the sample nearest it). */
function yAt(p: Pt[], x: number): number {
  let best = p[0];
  for (const q of p) if (Math.abs(q[0] - x) < Math.abs(best[0] - x)) best = q;
  return best[1];
}

interface Glyph {
  ch: string;
  x: number;
  y: number;
  a: number;
}
type Box = [number, number, number, number];

export function YearRibbon({
  url = "/api/home/ribbon",
  focusId = null,
}: {
  url?: string;
  focusId?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  /** Every drawn line, sampled, for the click test. */
  const lines = useRef<Pt[][]>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [source, setSource] = useState<RibbonSource>("hours");
  const [tick, setTick] = useState(0); // a resize or a theme change
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const stop = new AbortController();
    setData(null);
    fetch(url, { signal: stop.signal })
      .then((r) => r.json())
      .then((d: Payload) => setData(d.error ? null : d))
      .catch(() => {});
    return () => stop.abort();
  }, [url]);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const has = jobs.some((j) => sum(j.hours) > 0 || sum(j.bills) > 0 || sum(j.invoiced ?? []) > 0);
  const sourceIdx = RIBBON_SOURCES.findIndex((s) => s.key === source);
  const next = () => setSource(RIBBON_SOURCES[(sourceIdx + 1) % RIBBON_SOURCES.length].key);

  // Draw once from January to today.
  useEffect(() => {
    if (!has) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setProgress(1);
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, Math.max(0, (now - start) / DRAW_MS));
      setProgress(1 - (1 - u) * (1 - u));
      if (u < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [has, data]);

  // Redraw when the box changes size or the theme or palette changes.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const bump = () => setTick((t) => t + 1);
    const size = new ResizeObserver(bump);
    size.observe(el);
    const theme = new MutationObserver(bump);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-palette"] });
    return () => {
      size.disconnect();
      theme.disconnect();
    };
  }, [has]);

  useEffect(() => {
    const c = canvas.current;
    const el = box.current;
    if (!c || !el || !data || !has) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const x = c.getContext("2d");
    if (!x) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    const ink = getComputedStyle(el).color;
    x.lineJoin = "round";
    x.strokeStyle = ink;
    x.fillStyle = ink;

    const L = 8;
    const R = w - 8;
    const base = h - 2;
    const top = 12; // room for the source name
    const span = base - top;
    const at = (pos: number) => L + pos * (R - L);
    const weeks = Array.from({ length: 53 }, (_, i) => i + 1);
    const wx = (wk: number) => at(weekPosition(data.year, wk));
    const todayPos =
      (Date.UTC(data.year, Number(data.today.slice(5, 7)) - 1, Number(data.today.slice(8, 10))) -
        Date.UTC(data.year, 0, 1)) /
      86400000 /
      daysInYear(data.year);
    const todayX = at(todayPos);

    const series = (j: RibbonJob) => j[source] ?? [];
    const total = ribbonTotal(jobs, source);
    const max = Math.max(1, ...total);
    const line = (v: number[]) => sampleSoft(weeks.map((wk) => [wx(wk), base - (v[wk] / max) * span] as Pt));
    const trace = (p: Pt[]) => {
      x.beginPath();
      x.moveTo(p[0][0], p[0][1]);
      for (const q of p) x.lineTo(q[0], q[1]);
    };

    const outer = line(total);
    // Biggest first: that is the labelling order. The picked job goes first.
    const order = jobs
      .map((j) => ({ j, size: sum(series(j)), p: line(series(j)) }))
      .filter((r) => r.size > 0)
      .sort((a, b) => (b.j.id === focusId ? 1 : 0) - (a.j.id === focusId ? 1 : 0) || b.size - a.size);
    lines.current = [outer, ...order.map((r) => r.p)];
    const dim = (id: string) => (focusId && id !== focusId ? 0.12 : 1);

    // The labels, once the line is drawn. A label sits only where its line is
    // off the ground, inside the ends the mask fades, and before today.
    const labels = new Map<string, { glyphs: Glyph[]; from: number; to: number }>();
    if (progress >= 1) {
      x.font = `600 ${LABEL_PX}px system-ui, sans-serif`;
      const placed: Box[] = [];
      const xMin = w * 0.12;
      const xMax = Math.min(w * 0.88, todayX);
      for (const { j, p } of order) {
        const s = arcLengths(p);
        const chars = [...j.name];
        const widths = chars.map((ch) => x.measureText(ch).width);
        const len = sum(widths);
        if (len + 8 > s[s.length - 1]) continue;
        // Try the stretch around the line's peak first, then outward.
        const peak = p.reduce((b, q, i) => (q[1] < p[b][1] ? i : b), 0);
        const starts: number[] = [];
        for (let a = 0; a + len < s[s.length - 1]; a += 4) starts.push(a);
        starts.sort((a, b) => Math.abs(a + len / 2 - s[peak]) - Math.abs(b + len / 2 - s[peak]));
        for (const a of starts) {
          let off = a;
          const glyphs: Glyph[] = [];
          const boxes: Box[] = [];
          let ok = true;
          for (let k = 0; k < widths.length && ok; k++) {
            const g = pointAt(p, s, off + widths[k] / 2);
            off += widths[k];
            const r = Math.max(widths[k], LABEL_PX) / 2 + 1;
            const prev = glyphs[glyphs.length - 1];
            ok =
              g.x >= xMin &&
              g.x <= xMax &&
              g.y < base - LABEL_PX &&
              Math.abs(g.a) < 1.1 &&
              (!prev || Math.abs(g.a - prev.a) < 0.5);
            glyphs.push({ ch: chars[k], ...g });
            boxes.push([g.x - r, g.y - r, g.x + r, g.y + r]);
          }
          if (!ok) continue;
          const hits = (b: Box) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
          if (boxes.some(hits)) continue;
          placed.push(...boxes);
          labels.set(j.id, { glyphs, from: a - 2, to: a + len + 2 });
          break;
        }
      }
    }

    x.save();
    x.beginPath();
    x.rect(0, 0, at(todayPos * progress), h);
    x.clip();

    // The faint fill under the summation line.
    trace(outer);
    x.lineTo(outer[outer.length - 1][0], base);
    x.lineTo(outer[0][0], base);
    x.closePath();
    x.globalAlpha = focusId ? 0.04 : 0.08;
    x.fill();

    // A line per job, broken where its name is written.
    x.lineWidth = 1;
    for (const { j, p } of order) {
      const lab = labels.get(j.id);
      const s = lab ? arcLengths(p) : [];
      x.globalAlpha = 0.6 * dim(j.id);
      x.beginPath();
      let pen = false;
      p.forEach((q, i) => {
        const gap = lab && s[i] > lab.from && s[i] < lab.to;
        if (gap) pen = false;
        else if (pen) x.lineTo(q[0], q[1]);
        else {
          x.moveTo(q[0], q[1]);
          pen = true;
        }
      });
      x.stroke();
      if (!lab) continue;
      x.globalAlpha = 0.9 * dim(j.id);
      x.textBaseline = "middle";
      for (const g of lab.glyphs) {
        x.save();
        x.translate(g.x, g.y);
        x.rotate(g.a);
        x.fillText(g.ch, -x.measureText(g.ch).width / 2, 0);
        x.restore();
      }
    }

    // The summation line: it dominates.
    x.globalAlpha = focusId ? 0.35 : 1;
    trace(outer);
    x.lineWidth = 2;
    x.stroke();
    x.restore();

    // The ground, and the name of the series showing.
    x.globalAlpha = 1;
    x.beginPath();
    x.moveTo(L, base);
    x.lineTo(R, base);
    x.lineWidth = 1;
    x.stroke();
  }, [data, has, jobs, source, sourceIdx, focusId, tick, progress]);

  if (!data || !has) return null;

  /** True when the pointer is on a line. */
  const onLine = (e: React.PointerEvent | React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return lines.current.some((p) => Math.abs(yAt(p, px) - py) <= HIT_PX);
  };
  const label = RIBBON_SOURCES[sourceIdx].label;

  // Fills the header line, faded, and fades out at both ends so the text at
  // either end reads over it. Only the lines take a tap.
  return (
    <div className="pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
      <div ref={box} className="h-full text-neutral-900 dark:text-neutral-100">
        <canvas
          ref={canvas}
          role="button"
          tabIndex={0}
          aria-label={`This year by week: ${label}, a line per job and their total. Press to switch between labor hours, bills and invoiced to clients.`}
          className="pointer-events-auto block h-full w-full"
          onClick={(e) => onLine(e) && next()}
          onPointerMove={(e) => (e.currentTarget.style.cursor = onLine(e) ? "pointer" : "")}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            next();
          }}
        />
      </div>
    </div>
  );
}
