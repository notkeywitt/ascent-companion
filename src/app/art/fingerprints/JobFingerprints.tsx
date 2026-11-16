"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, Segmented } from "@/components/ui";
import { money0 } from "@/lib/money";
import {
  aggregateJobs,
  axisDivisions,
  glyphValues,
  topDivisionsOf,
  type FpMode,
} from "@/lib/art/fingerprints";
import { ArtCanvas, ArtPage, CanvasNote, Tip, ease, useArtRows, type DrawFrame } from "../artKit";

/**
 * JOB FINGERPRINTS. One radar glyph per job on one canvas. On load the glyphs
 * unfold from the centre, one after another. A new measure tweens every vertex
 * to its new radius. Under prefers-reduced-motion everything lands at once.
 */

const MODES: { value: FpMode; label: string }[] = [
  { value: "cost", label: "Budget" },
  { value: "price", label: "Budget price" },
  { value: "margin", label: "Margin" },
];

const JOBS = 12;
const STAGGER_MS = 80;
const UNFOLD_MS = 700;
const TWEEN_MS = 1000;
const LABEL_H = 32;
const SMALL = "11px ui-sans-serif, system-ui, sans-serif";
const TINY = "10px ui-sans-serif, system-ui, sans-serif";

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** Radius fraction for a value: shares are small, so they use a root scale. */
const radiusOf = (v: number, mode: FpMode) => (mode === "margin" ? v : Math.sqrt(v));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const divLabel = (d: string) => `Div ${d}`;

function layout(w: number, h: number, cols: number, n: number) {
  const rows = Math.max(1, Math.ceil(n / cols));
  const cw = w / cols;
  const ch = h / rows;
  const r = Math.max(8, Math.min(cw / 2 - 8, (ch - LABEL_H) / 2 - 2));
  return { rows, cw, ch, r, cy: (ch - LABEL_H) / 2 + 2 };
}

export function JobFingerprints() {
  const { rows, error } = useArtRows("budget");
  const [mode, setMode] = useState<FpMode>("cost");
  const [wide, setWide] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; i: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 744px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const data = useMemo(() => {
    if (!rows) return null;
    const axes = axisDivisions(rows, 8);
    const jobs = aggregateJobs(rows).slice(0, JOBS);
    return { axes, jobs };
  }, [rows]);

  // Radius fractions per glyph, per axis, for the mode on show.
  const target = useMemo(
    () => data?.jobs.map((j) => glyphValues(j, data.axes, mode).map((v) => radiusOf(v, mode))) ?? null,
    [data, mode],
  );

  const from = useRef<number[][]>([]);
  const to = useRef<number[][]>([]);
  const shown = useRef<number[][]>([]);
  const tweenStart = useRef(0);
  const loadStart = useRef(0);

  useEffect(() => {
    if (!target) return;
    const now = performance.now();
    if (!to.current.length) loadStart.current = now;
    from.current = shown.current.length ? shown.current : target.map((t) => t.map(() => 0));
    to.current = target;
    tweenStart.current = now;
  }, [target]);

  const cols = wide ? 4 : 2;
  const nRows = Math.ceil(JOBS / cols);
  const aspect = (nRows * 1.12) / cols;

  const draw = (f: DrawFrame) => {
    const { ctx, w, h, now, colors, ink, quiet, reduced } = f;
    if (!data || !to.current.length) return;
    const n = data.axes.length;
    if (n < 3) return;
    const { cw, ch, r, cy } = layout(w, h, cols, data.jobs.length);
    const e = reduced ? 1 : ease(clamp01((now - tweenStart.current) / TWEEN_MS));
    const next: number[][] = [];
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    data.jobs.forEach((job, i) => {
      const cur = to.current[i].map((b, a) => {
        const a0 = from.current[i]?.[a] ?? 0;
        return a0 + (b - a0) * e;
      });
      next.push(cur);
      const u = reduced ? 1 : ease(clamp01((now - loadStart.current - i * STAGGER_MS) / UNFOLD_MS));
      const cx = (i % cols) * cw + cw / 2;
      const y0 = Math.floor(i / cols) * ch + cy;
      const spin = (1 - u) * -0.7;
      const ang = (a: number) => -Math.PI / 2 + (a * 2 * Math.PI) / n + spin;
      const colour = colors[i % colors.length];

      ctx.globalAlpha = 0.12 * u;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      for (const ring of [1 / 3, 2 / 3, 1]) {
        ctx.beginPath();
        for (let a = 0; a < n; a++) {
          const x = cx + Math.cos(ang(a)) * r * ring * u;
          const y = y0 + Math.sin(ang(a)) * r * ring * u;
          if (a) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.beginPath();
      for (let a = 0; a < n; a++) {
        ctx.moveTo(cx, y0);
        ctx.lineTo(cx + Math.cos(ang(a)) * r * u, y0 + Math.sin(ang(a)) * r * u);
      }
      ctx.stroke();

      const pts = cur.map((v, a) => [cx + Math.cos(ang(a)) * r * v * u, y0 + Math.sin(ang(a)) * r * v * u]);
      ctx.beginPath();
      pts.forEach(([x, y], a) => (a ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.28 * u;
      ctx.fill();
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.95 * u;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
      }

      // Name and total under the glyph.
      const ly = Math.floor(i / cols) * ch + cy + r + 14;
      ctx.globalAlpha = u;
      ctx.font = SMALL;
      ctx.fillStyle = ink;
      let name = job.job;
      while (name.length > 3 && ctx.measureText(name).width > cw - 12) name = `${name.slice(0, -2).trimEnd()}…`;
      ctx.fillText(name, cx, ly);
      ctx.font = TINY;
      ctx.fillStyle = quiet;
      ctx.fillText(money0(job.cost), cx, ly + 12);
    });
    shown.current = next;
    ctx.globalAlpha = 1;
  };

  const onPointer = (x: number, y: number, w: number, h: number) => {
    if (!data) return;
    const { cw, ch } = layout(w, h, cols, data.jobs.length);
    const i = Math.floor(y / ch) * cols + Math.floor(x / cw);
    if (i < 0 || i >= data.jobs.length) return setHover(null);
    setHover({ x, y, i });
  };

  const tipJob = hover && data ? data.jobs[hover.i] : null;
  const unitWord = mode === "margin" ? "margin" : "of its total";

  return (
    <ArtPage
      title="Job Fingerprints"
      description="Each job's budget spread across the eight biggest CSI divisions. A glyph is one job."
    >
      <div className="mb-3">
        <Segmented label="Measure" value={mode} onChange={(m) => { setHover(null); setMode(m); }} options={MODES} size="md" />
      </div>
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}
      <ArtCanvas
        draw={draw}
        aspect={aspect}
        label="One radar glyph per job, showing its budget across the eight biggest divisions"
        onPointer={onPointer}
        onLeave={() => setHover(null)}
      >
        {!data && !error && <CanvasNote>Reading budget lines from JobTread…</CanvasNote>}
        {tipJob && hover && (
          <Tip x={hover.x} y={hover.y} w={cols * 400}>
            <div className="font-semibold">{tipJob.job}</div>
            {topDivisionsOf(tipJob, mode, 3).map((d) => (
              <div key={d.div} className="flex justify-between gap-3">
                <span>{divLabel(d.div)}</span>
                <span className="font-mono">
                  {pct(d.value)} <span className="text-neutral-500">{unitWord === "margin" ? "" : "· "}{money0(d.dollars)}</span>
                </span>
              </div>
            ))}
          </Tip>
        )}
      </ArtCanvas>
      {data && (
        <p className="mt-3 text-xs text-neutral-500">
          Axes, clockwise from the top: {data.axes.map(divLabel).join(", ")}.{" "}
          {mode === "margin" ? "A long spoke is a high margin." : "A long spoke is a big share of the job."}
        </p>
      )}
    </ArtPage>
  );
}
