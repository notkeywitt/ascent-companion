"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { daysInYear, weekPosition, type RibbonJob } from "@/lib/yearRibbon";

/**
 * THE YEAR RIBBON (owner, 2026-11-15). The current year, January to December,
 * on one canvas with no chart library.
 *
 *   Above the centre line: crew hours per work day.
 *   Below it:              vendor bill cost.
 *
 * Hours and dollars never share a scale: each has its own half.
 *
 * It draws no text and no vertical lines, and has no panel of its own: it is
 * printed straight on the page background (owner, 2026-11-15).
 *
 * Two shapes:
 *   backdrop    Home. Every job stacked, one colour per job. It fills the
 *               masthead's line and sits faded behind the billing month
 *               (`HomeMasthead`'s `backdrop`, `/api/home/ribbon`).
 *   jobId       The Jobs page. One job: two lines with its colour between them.
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

const SERIES = ["--viz-1", "--viz-2", "--viz-3", "--viz-4", "--viz-5", "--viz-6"];
const PAD_QUERY = "(min-width: 744px)"; // the `pad` breakpoint (tailwind.config.ts)
const DRAW_MS = 2400;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const colorVar = (job: RibbonJob, i: number) => (job.id ? SERIES[i % SERIES.length] : "--viz-other");

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
    // The page itself: the strokes between stacked bands cut in its colour.
    const ground = `rgb(${root.getPropertyValue("--page").trim().split(/\s+/).join(" ")})`;
    x.lineJoin = "round";

    const L = 8;
    const R = w - 8;
    const foot = h - 2;
    const mid = Math.round(foot * 0.52);
    const up = mid - 6;
    const down = foot - 4 - mid;
    const days = daysInYear(data.year);
    const at = (pos: number) => L + pos * (R - L);
    const weeks = Array.from({ length: 53 }, (_, i) => i + 1);
    const wx = (wk: number) => at(weekPosition(data.year, wk));

    // The centre line only. No text and no vertical lines.
    x.globalAlpha = 0.4;
    x.strokeStyle = ink;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(L, mid);
    x.lineTo(R, mid);
    x.stroke();
    x.globalAlpha = 1;

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

    x.save();
    x.beginPath();
    x.rect(0, 0, at(todayPos * progress), h);
    x.clip();
    if (backdrop) {
      // Stacked: each job is a band on each side of the centre line.
      const hMax = Math.max(1, ...weeks.map((wk) => sum(jobs.map((j) => j.hours[wk]))));
      const bMax = Math.max(1, ...weeks.map((wk) => sum(jobs.map((j) => j.bills[wk]))));
      const accH = new Array<number>(54).fill(0);
      const accB = new Array<number>(54).fill(0);
      jobs.forEach((j, i) => {
        const fill = root.getPropertyValue(colorVar(j, i)).trim();
        const sides: [number[], number[], number][] = [
          [j.hours, accH, -up / hMax],
          [j.bills, accB, down / bMax],
        ];
        for (const [v, acc, k] of sides) {
          const lo = weeks.map((wk) => [wx(wk), mid + acc[wk] * k]);
          const hi = weeks.map((wk) => [wx(wk), mid + (acc[wk] + v[wk]) * k]);
          weeks.forEach((wk) => (acc[wk] += v[wk]));
          x.beginPath();
          soft(hi, true);
          soft(lo.reverse(), false);
          x.closePath();
          x.fillStyle = fill;
          x.fill();
          x.strokeStyle = ground;
          x.lineWidth = 0.8;
          x.stroke();
        }
      });
    } else {
      // One job: two lines with its colour between them.
      const j = jobs[0];
      const fill = root.getPropertyValue("--viz-1").trim();
      const hMax = Math.max(1, ...j.hours);
      const bMax = Math.max(1, ...j.bills);
      const hi = weeks.map((wk) => [wx(wk), mid - (j.hours[wk] / hMax) * up]);
      const lo = weeks.map((wk) => [wx(wk), mid + (j.bills[wk] / bMax) * down]);
      x.beginPath();
      soft(hi, true);
      soft(lo.slice().reverse(), false);
      x.closePath();
      x.fillStyle = fill;
      x.globalAlpha = 0.3;
      x.fill();
      x.globalAlpha = 1;
      x.strokeStyle = fill;
      x.lineWidth = 1.8;
      for (const p of [hi, lo]) {
        x.beginPath();
        soft(p, true);
        x.stroke();
      }
    }
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
            ? "This year by week: crew hours per day above the line and vendor bills below it, one colour per job"
            : "This job's year by week: crew hours per day above the line and vendor bills below it"
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
