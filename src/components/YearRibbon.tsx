"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { daysInYear, weekPosition, type RibbonJob } from "@/lib/yearRibbon";

/**
 * THE YEAR RIBBON (owner, 2026-11-15). The current year, January to December,
 * on one canvas with no chart library.
 *
 * Drawn like the Range (owner, 2026-11-15, test C "Contours"): ink lines on the
 * page, no colour per job.
 *
 *   The mountain:  crew hours per work day. The outer edge is the company's
 *                  total; each thin line inside it is where one job's hours end.
 *   Dashed ochre:  vendor bill cost.
 *
 * Hours and dollars never share a scale: each has its own maximum.
 *
 * It draws no text and no vertical lines, and has no panel of its own: it is
 * printed straight on the page background (owner, 2026-11-15).
 *
 * Two shapes:
 *   backdrop    Home. Every job stacked as contour lines. It fills the
 *               masthead's line and sits faded behind the billing month
 *               (`HomeMasthead`'s `backdrop`, `/api/home/ribbon`).
 *   jobId       The Jobs page. One job: its hours as the mountain, its bills dashed.
 *               Drawn from `pad` up only, and a phone never fetches it
 *               (`/api/jobs-hub/ribbon`).
 *
 * It draws itself from January to today once, when it loads. It hides itself
 * when the read fails or holds nothing.
 */

interface Payload {
  year: number;
  today: string;
  jobs: RibbonJob[];
  error?: string;
}

const PAD_QUERY = "(min-width: 744px)"; // the `pad` breakpoint (tailwind.config.ts)
const DRAW_MS = 2400;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export function YearRibbon({ jobId, backdrop = false }: { jobId?: string; backdrop?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [tick, setTick] = useState(0); // a resize or a theme change
  const [progress, setProgress] = useState(0);

  // The read. The Jobs page shape waits for a `pad`-wide screen.
  useEffect(() => {
    if (!backdrop && (!jobId || !window.matchMedia(PAD_QUERY).matches)) return;
    const stop = new AbortController();
    setData(null);
    fetch(backdrop ? "/api/home/ribbon" : `/api/jobs-hub/ribbon?jobId=${encodeURIComponent(jobId ?? "")}`, {
      signal: stop.signal,
    })
      .then((r) => r.json())
      .then((d: Payload) => setData(d.error ? null : d))
      .catch(() => {});
    return () => stop.abort();
  }, [backdrop, jobId]);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const has = jobs.some((j) => sum(j.hours) > 0 || sum(j.bills) > 0);

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

    const css = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    const ink = css.color;
    // The dashed bills line: the accent (ochre in the guidelines palette).
    const accent = `rgb(${root.getPropertyValue("--accent").trim().split(/\s+/).join(" ")})`;
    x.lineJoin = "round";

    const L = 8;
    const R = w - 8;
    const base = h - 2;
    const span = h - 6;
    const days = daysInYear(data.year);
    const at = (pos: number) => L + pos * (R - L);
    const weeks = Array.from({ length: 53 }, (_, i) => i + 1);
    const wx = (wk: number) => at(weekPosition(data.year, wk));

    const todayPos =
      (Date.UTC(data.year, Number(data.today.slice(5, 7)) - 1, Number(data.today.slice(8, 10))) -
        Date.UTC(data.year, 0, 1)) /
      86400000 /
      days;
    const soft = (p: number[][], first: boolean) => {
      if (first) x.moveTo(p[0][0], p[0][1]);
      else x.lineTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++)
        x.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      x.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    };
    const edge = (pts: number[][]) => {
      x.beginPath();
      soft(pts, true);
    };

    // Each series is a total per week; the mountain's contours are running totals.
    const largestFirst = jobs.slice().sort((a, b) => sum(b.hours) - sum(a.hours));
    const totalHours = weeks.map((wk) => sum(jobs.map((j) => j.hours[wk])));
    const totalBills = weeks.map((wk) => sum(jobs.map((j) => j.bills[wk])));
    const hMax = Math.max(1, ...totalHours);
    const bMax = Math.max(1, ...totalBills);

    x.save();
    x.beginPath();
    x.rect(0, 0, at(todayPos * progress), h);
    x.clip();

    // The mountain: a faint fill under the outer edge.
    const outer = weeks.map((wk, i) => [wx(wk), base - (totalHours[i] / hMax) * span]);
    x.beginPath();
    soft(outer, true);
    x.lineTo(outer[outer.length - 1][0], base);
    x.lineTo(outer[0][0], base);
    x.closePath();
    x.fillStyle = ink;
    x.globalAlpha = 0.08;
    x.fill();

    // A contour per job: where the running total of the larger jobs ends.
    if (backdrop) {
      const acc = new Array<number>(54).fill(0);
      largestFirst.slice(0, -1).forEach((j) => {
        weeks.forEach((wk) => (acc[wk] += j.hours[wk]));
        edge(weeks.map((wk) => [wx(wk), base - (acc[wk] / hMax) * span]));
        x.strokeStyle = ink;
        x.globalAlpha = 0.55;
        x.lineWidth = 0.8;
        x.stroke();
      });
    }
    x.globalAlpha = 1;
    edge(outer);
    x.strokeStyle = ink;
    x.lineWidth = 1.5;
    x.stroke();

    // The ground the mountain stands on.
    x.beginPath();
    x.moveTo(L, base);
    x.lineTo(R, base);
    x.strokeStyle = ink;
    x.lineWidth = 1;
    x.stroke();

    // Vendor bills: one dashed line, on its own scale.
    edge(weeks.map((wk, i) => [wx(wk), base - (totalBills[i] / bMax) * span * 0.95]));
    x.setLineDash([3, 2.5]);
    x.strokeStyle = accent;
    x.lineWidth = 1.3;
    x.stroke();
    x.setLineDash([]);
    x.restore();
  }, [data, has, jobs, backdrop, tick, progress]);

  if (!data || !has) return null;

  const body = (
    <div ref={box} className="pointer-events-none h-full text-neutral-900 dark:text-neutral-100">
      <canvas
        ref={canvas}
        role="img"
        aria-label={
          backdrop
            ? "This year by week: crew hours per day as a mountain with a line for each job, and vendor bills as a dashed line"
            : "This job's year by week: crew hours per day as a mountain, and vendor bills as a dashed line"
        }
        className={backdrop ? "block h-full w-full" : "block h-24 w-full"}
      />
    </div>
  );

  if (!backdrop) return <div className="hidden pad:block">{body}</div>;
  // Home: fills the masthead's line, faded, and fades out at both ends so the
  // month and the date read over it.
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
    >
      {body}
    </div>
  );
}
