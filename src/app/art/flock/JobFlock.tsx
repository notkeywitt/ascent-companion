"use client";

import { useMemo, useRef, useState } from "react";
import { Banner, ChipScroller, FilterChip, Segmented, SectionLabel } from "@/components/ui";
import { money0 } from "@/lib/money";
import type { CloudSetId } from "@/lib/art/cloud";
import { divisionOf, type ArtBillRow, type ArtBudgetRow, type ArtRows, type ArtTimeRow } from "@/lib/art/rows";
import { Flock, flockSetup, OTHER, type FlockItem, type FlockSetup } from "@/lib/art/flock";
import { ArtCanvas, ArtPage, CanvasNote, Tip, useArtRows, type DrawFrame } from "../artKit";

/**
 * JOB FLOCK (owner, 2026-11-16). A boids simulation: every row is a bird, and
 * birds flock with their own group (src/lib/art/flock.ts). Groups that share
 * links drift toward each other: jobs that use the same vendors, or the same
 * crew. A group's speed follows how busy it was in the last 45 days.
 *
 *   - A new grouping re-sorts the same birds: no bird jumps, the new flocks
 *     gather over a few seconds.
 *   - A new data set flies on from the old birds' places; extra birds enter
 *     from the edges.
 *   - The pointer is a hawk: birds scatter from it. On a phone, a tap is.
 * Under prefers-reduced-motion the flock is settled off screen and drawn still.
 */

const SETS: { value: CloudSetId; label: string }[] = [
  { value: "bills", label: "Bill lines" },
  { value: "labor", label: "Crew time" },
  { value: "budget", label: "Budget lines" },
];

type By = "job" | "division" | "vendor" | "type" | "person";
const BY: Record<CloudSetId, { value: By; label: string }[]> = {
  bills: [
    { value: "job", label: "Job" },
    { value: "vendor", label: "Vendor" },
    { value: "division", label: "Division" },
    { value: "type", label: "Cost type" },
  ],
  labor: [
    { value: "job", label: "Job" },
    { value: "person", label: "Person" },
    { value: "division", label: "Division" },
  ],
  budget: [
    { value: "job", label: "Job" },
    { value: "division", label: "Division" },
    { value: "type", label: "Cost type" },
  ],
};

/** What links two groups, for each grouping. */
const LINK_NOTE: Record<By, string> = {
  job: "Jobs that share vendors or crew fly near each other.",
  vendor: "Vendors that bill the same jobs fly near each other.",
  division: "Divisions that meet on the same jobs fly near each other.",
  type: "Cost types that meet on the same jobs fly near each other.",
  person: "People who work the same jobs fly near each other.",
};

function items(set: CloudSetId, rows: unknown[], by: By): FlockItem[] {
  if (set === "bills") {
    return (rows as ArtBillRow[]).map((r) => {
      const key = by === "vendor" ? r.vendor : by === "division" ? `Div ${divisionOf(r.code)}` : by === "type" ? r.type : r.job;
      return { key: key || "None", link: by === "job" ? r.vendor : r.job, value: r.cost, date: r.date };
    });
  }
  if (set === "labor") {
    return (rows as ArtTimeRow[]).map((r) => {
      const key = by === "person" ? r.person : by === "division" ? `Div ${divisionOf(r.code)}` : r.job;
      return { key, link: by === "job" ? r.person : r.job, value: r.hours, date: r.start.slice(0, 10) };
    });
  }
  return (rows as ArtBudgetRow[]).map((r) => {
    const key = by === "division" ? `Div ${divisionOf(r.code)}` : by === "type" ? r.type : r.job;
    return { key, link: by === "job" ? divisionOf(r.code) : r.job, value: r.cost, date: "" };
  });
}

const TRAIL = 7; // positions kept per bird
const SETTLE_STEPS = 500; // for a still picture under reduced motion

export function JobFlock() {
  const [set, setSet] = useState<CloudSetId>("bills");
  const [by, setBy] = useState<By>("job");
  const [focus, setFocus] = useState<number | null>(null);
  const [hover, setHover] = useState<{ g: number; x: number; y: number; w: number } | null>(null);
  const { rows, error } = useArtRows(set);

  const setup: FlockSetup | null = useMemo(
    () => (rows ? flockSetup(items(set, rows as ArtRows[typeof set], by)) : null),
    [rows, set, by],
  );

  const flockRef = useRef<Flock | null>(null);
  const shownRows = useRef<unknown>(null);
  const shownSetup = useRef<FlockSetup | null>(null);
  const trail = useRef<Float32Array | null>(null);
  const trailAt = useRef(0);
  const hawk = useRef<{ x: number; y: number; until: number } | null>(null);
  const focusRef = useRef<number | null>(null);
  focusRef.current = focus;

  const draw = (f: DrawFrame) => {
    const { ctx, w, h, colors, ink, quiet, reduced, now } = f;
    if (!setup) return;

    // Build, re-group or replace the flock when the data or grouping changed.
    let flock = flockRef.current;
    if (!flock || shownRows.current !== rows) {
      const fresh = new Flock(setup.birds, setup.params, w, h);
      if (flock) fresh.inherit(flock);
      if (reduced) for (let s = 0; s < SETTLE_STEPS; s++) fresh.step();
      flock = flockRef.current = fresh;
      shownRows.current = rows;
      shownSetup.current = setup;
      trail.current = null;
    } else if (shownSetup.current !== setup) {
      flock.regroup(
        setup.birds.map((b) => b.group),
        setup.params,
      );
      if (reduced) for (let s = 0; s < SETTLE_STEPS; s++) flock.step();
      shownSetup.current = setup;
    }
    flock.resize(w, h);

    if (!reduced) {
      const hk = hawk.current && hawk.current.until > now ? hawk.current : null;
      flock.step(hk);
    }

    // Trails: a ring of the last few positions per bird.
    const n = flock.n;
    if (!trail.current || trail.current.length !== n * TRAIL * 2) {
      trail.current = new Float32Array(n * TRAIL * 2);
      for (let k = 0; k < TRAIL; k++) {
        for (let i = 0; i < n; i++) {
          trail.current[(k * n + i) * 2] = flock.x[i];
          trail.current[(k * n + i) * 2 + 1] = flock.y[i];
        }
      }
    }
    const tr = trail.current;
    const slot = trailAt.current;
    for (let i = 0; i < n; i++) {
      tr[(slot * n + i) * 2] = flock.x[i];
      tr[(slot * n + i) * 2 + 1] = flock.y[i];
    }
    trailAt.current = (slot + 1) % TRAIL;

    const G = setup.names.length;
    const colorOf = (g: number) => (setup.names[g] === OTHER ? quiet : colors[g % colors.length]);
    const fcs = focusRef.current;
    const alphaOf = (g: number) => (fcs === null || fcs === g ? 1 : 0.12);

    for (let g = 0; g < G; g++) {
      const col = colorOf(g);
      const a = alphaOf(g);
      // Trail, oldest to newest.
      if (!reduced) {
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.22 * a;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (flock.group[i] !== g) continue;
          let first = true;
          for (let k = 1; k <= TRAIL; k++) {
            const s = (slot + k) % TRAIL;
            const px = tr[(s * n + i) * 2];
            const py = tr[(s * n + i) * 2 + 1];
            if (first) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
            first = false;
          }
        }
        ctx.stroke();
      }
      // Birds: a small dart pointing where it flies.
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.9 * a;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (flock.group[i] !== g) continue;
        const sp = Math.hypot(flock.vx[i], flock.vy[i]) || 1;
        const ux = flock.vx[i] / sp;
        const uy = flock.vy[i] / sp;
        const L = 3 + flock.size[i] * 4;
        const W = 1.2 + flock.size[i] * 1.6;
        const x = flock.x[i];
        const y = flock.y[i];
        ctx.moveTo(x + ux * L, y + uy * L);
        ctx.lineTo(x - ux * L * 0.6 - uy * W, y - uy * L * 0.6 + ux * W);
        ctx.lineTo(x - ux * L * 0.6 + uy * W, y - uy * L * 0.6 - ux * W);
        ctx.closePath();
      }
      ctx.fill();
    }

    // Each flock's name, faint, at its centre.
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = ink;
    for (let g = 0; g < G; g++) {
      if (setup.names[g] === OTHER || flock.count[g] < 8) continue;
      ctx.globalAlpha = 0.6 * alphaOf(g);
      ctx.fillText(setup.names[g].slice(0, 24), flock.cx[g], flock.cy[g] - 10);
    }
    ctx.globalAlpha = 1;
  };

  const point = (x: number, y: number, w: number) => {
    // A touch scatters the birds for a moment; a mouse hawks while it moves.
    hawk.current = { x, y, until: performance.now() + 1200 };
    const flock = flockRef.current;
    if (!flock || !setup) return;
    let best = -1;
    let bd = 60 * 60;
    for (let g = 0; g < setup.names.length; g++) {
      if (!flock.count[g]) continue;
      const d = (flock.cx[g] - x) ** 2 + (flock.cy[g] - y) ** 2;
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    setHover(best >= 0 ? { g: best, x, y, w } : null);
  };

  const unit = set === "labor" ? "hours" : "money";
  const fmt = (v: number) => (unit === "hours" ? `${Math.round(v).toLocaleString("en-US")} h` : money0(v));
  const paceWord = (p: number) => (p >= 1.3 ? "busy" : p <= 0.8 ? "quiet" : "steady");

  const chooseSet = (s: CloudSetId) => {
    setFocus(null);
    setHover(null);
    setSet(s);
    if (!BY[s].some((o) => o.value === by)) setBy("job");
  };

  return (
    <ArtPage
      title="Job Flock"
      description="Every row is a bird. Birds flock with their own group, groups that share work drift together, and busy groups fly faster. Move the pointer through them, or tap, to scatter them."
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented label="Data set" value={set} onChange={chooseSet} options={SETS} size="md" />
      </div>
      <SectionLabel className="mb-1.5">Flock by</SectionLabel>
      <ChipScroller className="mb-3">
        {BY[set].map((o) => (
          <FilterChip
            key={o.value}
            on={o.value === by}
            onClick={() => {
              setFocus(null);
              setHover(null);
              setBy(o.value);
            }}
          >
            {o.label}
          </FilterChip>
        ))}
      </ChipScroller>

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      <ArtCanvas
        draw={draw}
        aspect={0.66}
        label={setup ? `A flock of ${setup.birds.length} birds in ${setup.names.length} groups` : "Loading the flock"}
        onPointer={point}
        onLeave={() => {
          hawk.current = null;
          setHover(null);
        }}
      >
        {!rows && !error && (
          <CanvasNote>Reading {SETS.find((s) => s.value === set)?.label.toLowerCase()} from JobTread…</CanvasNote>
        )}
        {hover && setup && (
          <Tip x={hover.x} y={hover.y} w={hover.w}>
            <div className="font-semibold">{setup.names[hover.g]}</div>
            <div>
              {flockRef.current?.count[hover.g] ?? 0} birds · {fmt(setup.totals[hover.g])}
            </div>
            <div className="text-neutral-500">Flying {paceWord(setup.params.pace[hover.g])}</div>
          </Tip>
        )}
      </ArtCanvas>

      {setup && (
        <section className="mt-4">
          <p className="mb-3 text-sm text-neutral-500">{LINK_NOTE[by]}</p>
          <SectionLabel className="mb-1.5">Flocks — tap one to pick it out</SectionLabel>
          <ul className="grid gap-x-6 gap-y-0.5 pad:grid-cols-2">
            {setup.names.map((name, g) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => setFocus((f) => (f === g ? null : g))}
                  aria-pressed={focus === g}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm transition ${
                    focus === g ? "bg-neutral-100 dark:bg-white/[0.07]" : ""
                  } ${focus !== null && focus !== g ? "opacity-50" : ""}`}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: name === OTHER ? "currentColor" : `var(--viz-${(g % 8) + 1})` }}
                  />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="text-xs text-neutral-500">{paceWord(setup.params.pace[g])}</span>
                  <span className="w-20 text-right font-mono text-xs text-neutral-500">{fmt(setup.totals[g])}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ArtPage>
  );
}
