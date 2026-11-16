"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, ChipScroller, FilterChip, PageHeader, Segmented, SectionLabel } from "@/components/ui";
import { money } from "@/lib/money";
import type { CloudPayload, CloudSetId } from "@/lib/art/cloud";

/**
 * THE COST CLOUD (owner, 2026-11-16). A data set drawn as a flock of dots on
 * one canvas, no chart library. Each dot is one row; its place is its score on
 * two principal components (PCA), its colour its k-means cluster.
 *
 * Motion is the point of the piece:
 *   - Load:       the dots burst out of the centre into their places.
 *   - New axes:   every dot glides to its new place, each on a small delay of
 *                 its own, so the cloud moves like a flock rather than a slide.
 *   - New set:    old dots and new dots are paired by their angle around the
 *                 centre, so the cloud swirls from one shape into the other.
 *                 Spare new dots grow out of the centre; spare old dots sink in.
 *   - At rest:    each dot drifts a little on its own slow orbit.
 *   - Tour:       steps through the component pairs on its own.
 * Under prefers-reduced-motion every move lands at once and nothing drifts.
 */

const SETS: { value: CloudSetId; label: string }[] = [
  { value: "bills", label: "Bill lines" },
  { value: "labor", label: "Crew time" },
  { value: "budget", label: "Budget lines" },
];

/** Component pairs, as [x, y] indexes into the six components. */
const PAIRS: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
];
const pairKey = (p: [number, number]) => `${p[0]}-${p[1]}`;

const MOVE_MS = 1400;
const MORPH_MS = 2000;
const TOUR_MS = 5000;
const SPREAD_MS = 450; // the most any one dot waits before it moves
const EDGE = 1.3; // a score past this sits on the frame's edge

interface Dot {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  a0: number;
  a1: number;
  c0: number;
  c1: number;
  delay: number;
  /** Index into the payload's points; -1 for an old dot on its way out. */
  idx: number;
  phase: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clampEdge = (v: number) => Math.max(-EDGE, Math.min(EDGE, v));
const pct = (v: number) => `${Math.round(v * 100)}%`;

function readColors(): string[] {
  const css = getComputedStyle(document.documentElement);
  return Array.from({ length: 8 }, (_, i) => css.getPropertyValue(`--viz-${i + 1}`).trim() || "#888");
}

/** Pseudo-random 0..1 from an integer, so a dot's delay and orbit are stable. */
const hash = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function CostCloud() {
  const [set, setSet] = useState<CloudSetId>("bills");
  const [pair, setPair] = useState<[number, number]>([0, 1]);
  const [tour, setTour] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const [data, setData] = useState<Partial<Record<CloudSetId, CloudPayload>>>({});
  const [error, setError] = useState("");
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const startRef = useRef(0);
  const durRef = useRef(MOVE_MS);
  const shownRef = useRef<CloudPayload | null>(null);
  const focusRef = useRef<number | null>(null);
  const colorsRef = useRef<string[]>([]);
  const sizeRef = useRef({ w: 600, h: 480 });
  const reduced = useRef(false);

  const payload = data[set];
  focusRef.current = focus;

  // ---- data -------------------------------------------------------------
  const load = useCallback(async (which: CloudSetId) => {
    const res = await fetch(`/api/art/cloud?set=${which}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `The read failed (HTTP ${res.status}).`);
    return body as CloudPayload;
  }, []);

  useEffect(() => {
    if (data[set]) return;
    let live = true;
    setError("");
    load(set)
      .then((p) => live && setData((d) => ({ ...d, [set]: p })))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "The read failed."));
    return () => {
      live = false;
    };
  }, [set, data, load]);

  // ---- motion -----------------------------------------------------------
  /** Where a dot is right now, part way through its move. */
  const posNow = useCallback((d: Dot, now: number) => {
    const t = reduced.current ? 1 : Math.max(0, Math.min(1, (now - startRef.current - d.delay) / durRef.current));
    const e = ease(t);
    return { x: d.x0 + (d.x1 - d.x0) * e, y: d.y0 + (d.y1 - d.y0) * e, a: d.a0 + (d.a1 - d.a0) * e, t };
  }, []);

  /** Send every dot to `p` on axes `xy`. A new payload swirls in; the same one glides. */
  const retarget = useCallback(
    (p: CloudPayload, xy: [number, number]) => {
      const now = performance.now();
      const [cx, cy] = xy;
      const next = p.points.map((pt) => ({ x: clampEdge(pt[cx] as number), y: clampEdge(pt[cy] as number), c: pt[6] }));
      const old = dotsRef.current.filter((d) => d.idx >= 0 || posNow(d, now).t < 1);

      if (shownRef.current === p && old.length === next.length) {
        // Same set, new axes: each dot from where it is to its new place.
        dotsRef.current = old.map((d, i) => {
          const at = posNow(d, now);
          return {
            ...d,
            x0: at.x,
            y0: at.y,
            a0: at.a,
            a1: 1,
            x1: next[i].x,
            y1: next[i].y,
            delay: hash(i) * SPREAD_MS,
          };
        });
        durRef.current = MOVE_MS;
      } else {
        // A new set: pair old and new by angle so the cloud swirls between shapes.
        const angle = (x: number, y: number) => Math.atan2(y, x);
        const fromOrder = old
          .map((d, i) => ({ i, at: posNow(d, now) }))
          .sort((a, b) => angle(a.at.x, a.at.y) - angle(b.at.x, b.at.y));
        const toOrder = next.map((n, i) => ({ i, n })).sort((a, b) => angle(a.n.x, a.n.y) - angle(b.n.x, b.n.y));
        const dots: Dot[] = [];
        toOrder.forEach(({ i, n }, k) => {
          const from = fromOrder.length
            ? fromOrder[Math.floor((k * fromOrder.length) / toOrder.length)]
            : null;
          const fresh = !from || k >= fromOrder.length;
          dots.push({
            x0: fresh ? 0 : from!.at.x,
            y0: fresh ? 0 : from!.at.y,
            a0: fresh ? 0 : from!.at.a,
            a1: 1,
            x1: n.x,
            y1: n.y,
            c0: fresh ? n.c : old[from!.i].c1,
            c1: n.c,
            delay: (k / toOrder.length) * SPREAD_MS * 1.6,
            idx: i,
            phase: hash(i + 101) * Math.PI * 2,
          });
        });
        // Old dots beyond the new count sink into the centre and fade.
        for (let k = toOrder.length; k < fromOrder.length; k++) {
          const f = fromOrder[k];
          dots.push({
            x0: f.at.x,
            y0: f.at.y,
            a0: f.at.a,
            a1: 0,
            x1: 0,
            y1: 0,
            c0: old[f.i].c1,
            c1: old[f.i].c1,
            delay: hash(k) * SPREAD_MS,
            idx: -1,
            phase: 0,
          });
        }
        dotsRef.current = dots;
        durRef.current = old.length ? MORPH_MS : MORPH_MS * 0.8;
      }
      shownRef.current = p;
      startRef.current = now;
    },
    [posNow],
  );

  useEffect(() => {
    if (payload) retarget(payload, pair);
  }, [payload, pair, retarget]);

  // The tour steps through the pairs on its own.
  useEffect(() => {
    if (!tour) return;
    const t = setInterval(() => {
      setPair((p) => PAIRS[(PAIRS.findIndex((q) => pairKey(q) === pairKey(p)) + 1) % PAIRS.length]);
    }, TOUR_MS);
    return () => clearInterval(t);
  }, [tour]);

  // ---- drawing ----------------------------------------------------------
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    colorsRef.current = readColors();
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const fit = () => {
      const w = wrap.clientWidth;
      const h = Math.round(Math.min(Math.max(w * 0.78, 320), 620));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h };
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    // The theme toggle repaints the viz tokens: re-read them when <html> changes.
    const mo = new MutationObserver(() => (colorsRef.current = readColors()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-palette", "style"] });

    let raf = 0;
    const frame = (now: number) => {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const { w, h } = sizeRef.current;
        const pad = 18;
        const sx = (w / 2 - pad) / EDGE;
        const sy = (h / 2 - pad) / EDGE;
        ctx.clearRect(0, 0, w, h);

        // Faint cross-hairs through the centre: the zero of each component.
        ctx.strokeStyle = getComputedStyle(canvas).color;
        ctx.globalAlpha = 0.12;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad, h / 2);
        ctx.lineTo(w - pad, h / 2);
        ctx.moveTo(w / 2, pad);
        ctx.lineTo(w / 2, h - pad);
        ctx.stroke();

        const colors = colorsRef.current;
        const f = focusRef.current;
        const drift = reduced.current ? 0 : 0.012;
        const r = w < 500 ? 1.8 : 2.4;
        for (const d of dotsRef.current) {
          const at = posNow(d, now);
          if (at.a <= 0.01) continue;
          const c = at.t < 0.5 ? d.c0 : d.c1;
          const wob = drift * Math.sin(now / 1700 + d.phase);
          const wob2 = drift * Math.cos(now / 2300 + d.phase * 1.3);
          const x = w / 2 + (at.x + wob) * sx;
          const y = h / 2 - (at.y + wob2) * sy;
          ctx.globalAlpha = at.a * (f === null || c === f ? 0.78 : 0.08);
          ctx.fillStyle = colors[c % colors.length];
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
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
  }, [posNow]);

  // ---- pointer ----------------------------------------------------------
  /** The dot under the pointer, within 14px, at its resting place. */
  const pick = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const p = shownRef.current;
    if (!canvas || !p) return setHover(null);
    const box = canvas.getBoundingClientRect();
    const mx = clientX - box.left;
    const my = clientY - box.top;
    const { w, h } = sizeRef.current;
    const pad = 18;
    const sx = (w / 2 - pad) / EDGE;
    const sy = (h / 2 - pad) / EDGE;
    let best = -1;
    let bd = 14 * 14;
    for (const d of dotsRef.current) {
      if (d.idx < 0) continue;
      if (focus !== null && d.c1 !== focus) continue;
      const x = w / 2 + d.x1 * sx;
      const y = h / 2 - d.y1 * sy;
      const dd = (x - mx) ** 2 + (y - my) ** 2;
      if (dd < bd) {
        bd = dd;
        best = d.idx;
      }
    }
    setHover(best >= 0 ? { idx: best, x: mx, y: my } : null);
  };

  const comps = payload?.components ?? [];
  const xs = comps[pair[0]];
  const ys = comps[pair[1]];
  const hovered = hover && payload ? payload.points[hover.idx] : null;
  const value = (v: number) => (payload?.unit === "hours" ? `${v.toFixed(2)} h` : money(v));

  const chooseSet = (s: CloudSetId) => {
    setFocus(null);
    setHover(null);
    setSet(s);
  };
  const choosePair = (p: [number, number]) => {
    setTour(false);
    setHover(null);
    setPair(p);
  };

  const sizeOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of payload?.clusters ?? []) m.set(c.id, c.size);
    return m;
  }, [payload]);

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6 lg:max-w-5xl">
      <Link href="/art" className="text-xs font-semibold text-neutral-500 hover:text-accent">
        ← Art that Makes Itself
      </Link>
      <PageHeader
        title="Cost Cloud"
        description={payload ? `${payload.dot}. ${payload.points.length.toLocaleString("en-US")} dots, ${payload.features} measures each.` : "Every row drawn as one dot, placed by PCA."}
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented label="Data set" value={set} onChange={chooseSet} options={SETS} size="md" />
        <button
          type="button"
          onClick={() => setTour((t) => !t)}
          aria-pressed={tour}
          className={`ui-btn min-h-11 rounded-lg px-3 text-sm font-semibold transition ${
            tour ? "bg-accent text-accent-fg" : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          }`}
        >
          {tour ? "Stop tour" : "Tour the components"}
        </button>
      </div>

      <SectionLabel className="mb-1.5">Components</SectionLabel>
      <ChipScroller className="mb-3">
        {PAIRS.map((p) => (
          <FilterChip key={pairKey(p)} on={pairKey(p) === pairKey(pair)} onClick={() => choosePair(p)}>
            PC{p[0] + 1} × PC{p[1] + 1}
          </FilterChip>
        ))}
      </ChipScroller>

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-xl border border-line bg-white text-neutral-900 dark:bg-ink-raised dark:text-neutral-100"
      >
        <canvas
          ref={canvasRef}
          className="block w-full touch-none"
          onPointerMove={(e) => pick(e.clientX, e.clientY)}
          onPointerDown={(e) => pick(e.clientX, e.clientY)}
          onPointerLeave={() => setHover(null)}
          aria-label={payload ? `${payload.title} drawn as a cloud of ${payload.points.length} dots` : "Loading the cloud"}
          role="img"
        />
        {!payload && !error && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
            Reading {SETS.find((s) => s.value === set)?.label.toLowerCase()} from JobTread…
          </p>
        )}
        {xs && (
          <span className="pointer-events-none absolute bottom-1.5 right-2.5 text-[11px] text-neutral-500">
            PC{pair[0] + 1} →
          </span>
        )}
        {ys && (
          <span className="pointer-events-none absolute left-2.5 top-1.5 text-[11px] text-neutral-500">↑ PC{pair[1] + 1}</span>
        )}
        {hovered && hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-[16rem] rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs shadow-md dark:bg-ink"
            style={{
              left: Math.min(hover.x + 12, sizeRef.current.w - 260),
              top: Math.max(hover.y - 60, 4),
            }}
          >
            <div className="font-semibold">{hovered[7]}</div>
            <div className="font-mono">{value(hovered[8])}</div>
            <div className="text-neutral-500">{hovered[9]}</div>
            <div className="text-neutral-500">Cluster: {payload?.clusters[hovered[6]]?.label}</div>
          </div>
        )}
      </div>

      {payload && (
        <div className="mt-4 grid gap-4 pad:grid-cols-2">
          <section>
            <SectionLabel className="mb-1.5">What the axes mean</SectionLabel>
            {[
              { name: `PC${pair[0] + 1}`, dir: "Right", opp: "left", c: xs },
              { name: `PC${pair[1] + 1}`, dir: "Up", opp: "down", c: ys },
            ].map(
              (a) =>
                a.c && (
                  <p key={a.name} className="mb-2 text-sm">
                    <span className="font-semibold">{a.name}</span>{" "}
                    <span className="text-neutral-500">explains {pct(a.c.explained)} of the spread.</span>{" "}
                    {a.dir}: {a.c.plus.join(", ") || "nothing strong"}. {a.opp[0].toUpperCase() + a.opp.slice(1)}:{" "}
                    {a.c.minus.join(", ") || "nothing strong"}.
                  </p>
                ),
            )}
          </section>
          <section>
            <SectionLabel className="mb-1.5">Clusters — tap one to pick it out</SectionLabel>
            <ul className="space-y-0.5">
              {payload.clusters.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setFocus((f) => (f === c.id ? null : c.id))}
                    aria-pressed={focus === c.id}
                    className={`flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm transition ${
                      focus === c.id ? "bg-neutral-100 dark:bg-white/[0.07]" : ""
                    } ${focus !== null && focus !== c.id ? "opacity-50" : ""}`}
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: `var(--viz-${(c.id % 8) + 1})` }}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <span className="font-mono text-xs text-neutral-500">{sizeOf.get(c.id)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
