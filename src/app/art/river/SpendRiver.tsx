"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, SectionLabel, Segmented } from "@/components/ui";
import { money0 } from "@/lib/money";
import { divisionOf, type ArtBillRow } from "@/lib/art/rows";
import { foldTop, insideOut, stackWiggle, weekStartDay, weeklyByKey, type RiverLayer } from "@/lib/art/river";
import { ArtCanvas, ArtPage, CanvasNote, Tip, ease, useArtRows, type DrawFrame } from "../artKit";

/**
 * SPEND RIVER. Weekly bill spend as a streamgraph. On load the river flows in
 * from the left; a new grouping tweens every layer's weekly values, so layers
 * swell, shrink and re-sort. At rest the layers shimmer faintly. Under
 * prefers-reduced-motion everything lands at once and nothing shimmers.
 */

type GroupBy = "division" | "type" | "vendor";
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "division", label: "Division" },
  { value: "type", label: "Cost type" },
  { value: "vendor", label: "Vendor" },
];

const FLOW_MS = 2500;
const MORPH_MS = 1200;
const OTHER = "Other";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const FONT = "10px ui-sans-serif, system-ui, sans-serif";

interface Entry {
  key: string;
  from: number[];
  to: number[];
  /** Colour index; -1 draws in the quiet colour. */
  ci: number;
}

interface Geom {
  left: number;
  top: number;
  step: number;
  count: number;
  keys: string[];
  vals: number[][];
  lower: number[][];
  upper: number[][];
  yAt: (v: number) => number;
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const fmtDay = (day: number) =>
  new Date(day * DAY_MS).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A smooth cardinal curve through `pts`, joined to the current path. */
function curveThrough(ctx: CanvasRenderingContext2D, pts: [number, number][], first: boolean) {
  if (first) ctx.moveTo(pts[0][0], pts[0][1]);
  else ctx.lineTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    );
  }
}

export function SpendRiver() {
  const { rows, error } = useArtRows("bills");
  const [group, setGroup] = useState<GroupBy>("division");
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    week: number;
    key: string;
    value: number;
    total: number;
  } | null>(null);

  const sets = useMemo(() => {
    if (!rows) return null;
    const keyOf: Record<GroupBy, (r: ArtBillRow) => string> = {
      division: (r) => (r.code.trim() ? `Div ${divisionOf(r.code)}` : "No code"),
      type: (r) => r.type.trim() || "No type",
      vendor: (r) => r.vendor.trim() || "No vendor",
    };
    const make = (g: GroupBy) => {
      const w = weeklyByKey(rows, keyOf[g]);
      return { first: w.first, count: w.count, layers: foldTop(w.series, 7) };
    };
    return { division: make("division"), type: make("type"), vendor: make("vendor") };
  }, [rows]);

  const tween = useRef<{ entries: Entry[]; start: number }>({ entries: [], start: 0 });
  const flowStart = useRef(0);
  const geom = useRef<Geom | null>(null);
  const fade = useRef(new Map<string, number>());

  const tweenAt = (now: number, reduced: boolean) => (reduced ? 1 : clamp01((now - tween.current.start) / MORPH_MS));
  const valuesNow = (en: Entry, e: number) => en.from.map((a, i) => a + (en.to[i] - a) * e);

  useEffect(() => {
    if (!sets) return;
    const now = performance.now();
    const s = sets[group];
    const t = tween.current;
    const e = ease(clamp01((now - t.start) / MORPH_MS));
    const old = new Map(t.entries.map((en) => [en.key, { vals: valuesNow(en, e), ci: en.ci }]));
    const first = t.entries.length === 0;
    const zeros = new Array<number>(s.count).fill(0);
    const rank = new Map(s.layers.map((l, i) => [l.key, l.key === OTHER ? -1 : i]));
    const entries: Entry[] = insideOut<RiverLayer>(s.layers).map((l) => ({
      key: l.key,
      from: first ? l.values : (old.get(l.key)?.vals ?? zeros),
      to: l.values,
      ci: rank.get(l.key) ?? -1,
    }));
    for (const [key, o] of old) {
      if (!rank.has(key)) entries.push({ key, from: o.vals, to: zeros, ci: o.ci });
    }
    tween.current = { entries, start: first ? now - MORPH_MS : now };
    if (first) flowStart.current = now;
  }, [sets, group]);

  const draw = (f: DrawFrame) => {
    const { ctx, w, h, now, colors, ink, quiet, reduced } = f;
    const tw = tween.current;
    if (!sets || !tw.entries.length) return;
    const count = sets[group].count;
    const first = sets[group].first;
    const left = 10;
    const top = 14;
    const pw = w - 20;
    const ph = h - top - 28;
    const step = pw / count;

    const t = tweenAt(now, reduced);
    const e = ease(t);
    if (t >= 1 && tw.entries.some((en) => !sets[group].layers.some((l) => l.key === en.key))) {
      tw.entries = tw.entries.filter((en) => sets[group].layers.some((l) => l.key === en.key));
    }
    const entries = tw.entries;
    const vals = entries.map((en) => valuesNow(en, e));
    const { lower, upper } = stackWiggle(vals);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < count; j++) {
      lo = Math.min(lo, lower[0][j]);
      hi = Math.max(hi, upper[upper.length - 1][j]);
    }
    const mid = (lo + hi) / 2;
    const scale = (ph * 0.96) / (hi - lo || 1);
    const yAt = (v: number) => top + ph / 2 - (v - mid) * scale;
    const xAt = (i: number) => left + (i + 0.5) * step;
    geom.current = { left, top, step, count, keys: entries.map((en) => en.key), vals, lower, upper, yAt };

    const flow = reduced ? 1 : clamp01((now - flowStart.current) / FLOW_MS);
    const sweep = left + pw * ease(flow);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, sweep, h);
    ctx.clip();
    entries.forEach((en, k) => {
      const want = focus === null || focus === en.key ? 1 : 0.15;
      const a = fade.current.get(en.key) ?? want;
      const next = reduced ? want : a + (want - a) * 0.2;
      fade.current.set(en.key, next);
      const shimmer = reduced ? 0 : 0.04 * Math.sin(now / 1800 + k * 1.3);
      ctx.globalAlpha = Math.max(0, Math.min(1, next * (0.88 + shimmer)));
      ctx.fillStyle = en.ci < 0 ? quiet : colors[en.ci % colors.length];
      const up: [number, number][] = [];
      const dn: [number, number][] = [];
      for (let j = 0; j < count; j++) {
        up.push([xAt(j), yAt(upper[k][j])]);
        dn.push([xAt(count - 1 - j), yAt(lower[k][count - 1 - j])]);
      }
      ctx.beginPath();
      curveThrough(ctx, up, true);
      curveThrough(ctx, dn, false);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    // Month ticks.
    const d0 = weekStartDay(first);
    const d1 = d0 + count * 7;
    ctx.globalAlpha = 1;
    ctx.font = FONT;
    ctx.fillStyle = quiet;
    ctx.strokeStyle = quiet;
    ctx.lineWidth = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const start = new Date(d0 * DAY_MS);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth() + 1;
    for (let guard = 0; guard < 36; guard++) {
      if (m > 11) {
        m = 0;
        y += 1;
      }
      const day = Math.floor(Date.UTC(y, m, 1) / DAY_MS);
      if (day >= d1) break;
      const x = left + ((day - d0) / 7) * step;
      ctx.beginPath();
      ctx.moveTo(x, h - 22);
      ctx.lineTo(x, h - 17);
      ctx.stroke();
      ctx.fillText(MONTHS[m], x + 3, h - 7);
      m += 1;
    }

    if (hover) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.moveTo(xAt(hover.week), top);
      ctx.lineTo(xAt(hover.week), top + ph);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  const onPointer = (x: number, y: number) => {
    const g = geom.current;
    if (!g) return;
    const i = Math.max(0, Math.min(g.count - 1, Math.floor((x - g.left) / g.step)));
    let key = "";
    let value = 0;
    for (let k = 0; k < g.keys.length; k++) {
      if (y >= g.yAt(g.upper[k][i]) && y <= g.yAt(g.lower[k][i])) {
        key = g.keys[k];
        value = g.vals[k][i];
      }
    }
    if (!key) return setHover(null);
    setHover({ x, y, week: i, key, value, total: g.vals.reduce((a, v) => a + v[i], 0) });
  };

  const layers = sets?.[group].layers ?? [];
  const range = (week: number) => {
    const s = sets ? weekStartDay(sets[group].first + week) : 0;
    return `${fmtDay(s)} – ${fmtDay(s + 6)}`;
  };

  return (
    <ArtPage
      title="Spend River"
      description="Weekly bill spend as a river. Each bill spreads over its own week and the weeks either side."
    >
      <div className="mb-3">
        <Segmented
          label="Group the river by"
          value={group}
          onChange={(g) => {
            setFocus(null);
            setHover(null);
            setGroup(g);
          }}
          options={GROUPS}
          size="md"
        />
      </div>
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}
      <ArtCanvas
        draw={draw}
        aspect={0.5}
        label="Streamgraph of weekly bill spend by group"
        onPointer={onPointer}
        onLeave={() => setHover(null)}
      >
        {!sets && !error && <CanvasNote>Reading bill lines from JobTread…</CanvasNote>}
        {hover && (
          <Tip x={hover.x} y={hover.y} w={geom.current ? geom.current.left * 2 + geom.current.step * geom.current.count : 600}>
            <div className="text-neutral-500">{range(hover.week)}</div>
            <div className="font-semibold">{hover.key}</div>
            <div className="font-mono">{money0(hover.value)}</div>
            <div className="text-neutral-500">Week total {money0(hover.total)}</div>
          </Tip>
        )}
      </ArtCanvas>

      {layers.length > 0 && (
        <section className="mt-4">
          <SectionLabel className="mb-1.5">Layers — tap one to pick it out</SectionLabel>
          <ul className="grid gap-x-4 gap-y-0.5 pad:grid-cols-2">
            {layers.map((l, i) => (
              <li key={l.key}>
                <button
                  type="button"
                  onClick={() => setFocus((c) => (c === l.key ? null : l.key))}
                  aria-pressed={focus === l.key}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-inner px-1.5 text-left text-sm transition ${
                    focus === l.key ? "bg-neutral-100 dark:bg-white/[0.07]" : ""
                  } ${focus !== null && focus !== l.key ? "opacity-50" : ""}`}
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${l.key === OTHER ? "bg-neutral-400" : ""}`}
                    style={l.key === OTHER ? undefined : { background: `var(--viz-${(i % 8) + 1})` }}
                  />
                  <span className="min-w-0 flex-1 truncate">{l.key}</span>
                  <span className="font-mono text-xs text-neutral-500">{money0(l.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ArtPage>
  );
}
