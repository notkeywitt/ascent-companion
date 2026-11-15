"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { money0 } from "@/lib/money";
import { daysInYear, isoWeekStartDay, weekPosition, type RibbonJob } from "@/lib/yearRibbon";

/**
 * THE YEAR RIBBON (owner, 2026-11-15). The current year, January to December,
 * on one canvas with no chart library.
 *
 *   Above the centre line: crew hours per work day.
 *   Below it:              vendor bill cost.
 *
 * Hours and dollars never share a scale: each has its own half.
 *
 * Two shapes:
 *   dock        Home. Every job stacked, one colour per job, fixed to the foot
 *               of the screen on every width (`/api/home/ribbon`).
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SERIES = ["--viz-1", "--viz-2", "--viz-3", "--viz-4", "--viz-5", "--viz-6"];
const PAD_QUERY = "(min-width: 744px)"; // the `pad` breakpoint (tailwind.config.ts)
const DRAW_MS = 2400;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const colorVar = (job: RibbonJob, i: number) => (job.id ? SERIES[i % SERIES.length] : "--viz-other");

export function YearRibbon({ jobId, dock = false }: { jobId?: string; dock?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [week, setWeek] = useState(0);
  const [tick, setTick] = useState(0); // a resize or a theme change
  const [progress, setProgress] = useState(0);

  // The read. The Jobs page shape waits for a `pad`-wide screen.
  useEffect(() => {
    if (!dock && (!jobId || !window.matchMedia(PAD_QUERY).matches)) return;
    const stop = new AbortController();
    setData(null);
    fetch(dock ? "/api/home/ribbon" : `/api/jobs-hub/ribbon?jobId=${encodeURIComponent(jobId ?? "")}`, {
      signal: stop.signal,
    })
      .then((r) => r.json())
      .then((d: Payload) => setData(d.error ? null : d))
      .catch(() => {});
    return () => stop.abort();
  }, [dock, jobId]);

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
    const ground = css.backgroundColor;
    x.font = `10px ${css.fontFamily}`;
    x.lineJoin = "round";

    const L = 8;
    const R = w - 8;
    const foot = h - 14; // month labels sit under this
    const mid = Math.round(foot * 0.52);
    const up = mid - 6;
    const down = foot - 4 - mid;
    const days = daysInYear(data.year);
    const at = (pos: number) => L + pos * (R - L);
    const weeks = Array.from({ length: 53 }, (_, i) => i + 1);
    const wx = (wk: number) => at(weekPosition(data.year, wk));

    // Month grid and labels.
    x.globalAlpha = 0.14;
    x.strokeStyle = ink;
    x.lineWidth = 1;
    let day = 0;
    const starts = MONTHS.map((_, m) => {
      const s = day;
      day += new Date(Date.UTC(data.year, m + 1, 0)).getUTCDate();
      return s;
    });
    for (const s of starts) {
      x.beginPath();
      x.moveTo(at(s / days), 2);
      x.lineTo(at(s / days), foot);
      x.stroke();
    }
    x.globalAlpha = 0.55;
    x.fillStyle = ink;
    starts.forEach((s, m) => x.fillText(w < 520 ? MONTHS[m][0] : MONTHS[m], at(s / days) + 3, h - 3));
    x.globalAlpha = 0.4;
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
    if (dock) {
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

    // Today, and the touched week.
    x.strokeStyle = ink;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(at(todayPos * progress), 2);
    x.lineTo(at(todayPos * progress), foot);
    x.stroke();
    if (week) {
      x.setLineDash([2, 3]);
      x.globalAlpha = 0.6;
      x.beginPath();
      x.moveTo(wx(week), 2);
      x.lineTo(wx(week), foot);
      x.stroke();
      x.setLineDash([]);
      x.globalAlpha = 1;
    }
  }, [data, has, jobs, dock, week, tick, progress]);

  if (!data || !has) return null;

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const dayOfYear = ((e.clientX - b.left - 8) / (b.width - 16)) * daysInYear(data.year);
    const wk = Math.round((dayOfYear - isoWeekStartDay(data.year, 1) - 3.5) / 7) + 1;
    setWeek(Math.max(1, Math.min(53, wk)));
  };

  const hoursAt = (wk: number) => sum(jobs.map((j) => j.hours[wk]));
  const billsAt = (wk: number) => sum(jobs.map((j) => j.bills[wk]));
  let line: string;
  if (week) {
    const monday = new Date(Date.UTC(data.year, 0, 1 + isoWeekStartDay(data.year, week)));
    const label = monday.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const busiest = jobs.slice().sort((a, b) => b.hours[week] - a.hours[week])[0];
    line =
      `Week of ${label}: ${Math.round(hoursAt(week))} crew hours a day, ${money0(billsAt(week))} in bills` +
      (dock && busiest.hours[week] > 0 ? `. Busiest: ${busiest.name}` : "");
  } else {
    // hours[] is per work day, so a week's hours is five of them.
    const yearHours = Math.round(sum(jobs.map((j) => sum(j.hours))) * 5);
    line = `${data.year}: ${yearHours.toLocaleString("en-US")} crew hours above the line, ${money0(sum(jobs.map((j) => sum(j.bills))))} in vendor bills below`;
  }

  const body = (
    <div ref={box} className="bg-white text-neutral-900 dark:bg-ink-raised dark:text-neutral-100">
      <div className="flex items-center gap-x-3 px-3 pt-1.5 text-[11px] leading-4 text-neutral-500">
        <span className="min-w-0 flex-1 truncate tabular-nums" aria-live="polite">
          {line}
        </span>
        {dock && (
          <span className="hidden shrink-0 gap-x-3 lg:flex">
            {jobs.map((j, i) => (
              <span key={j.id || "other"} className="flex items-center gap-1 whitespace-nowrap">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: `var(${colorVar(j, i)})` }} />
                {j.name}
              </span>
            ))}
          </span>
        )}
      </div>
      <canvas
        ref={canvas}
        role="img"
        aria-label={
          dock
            ? "This year by week: crew hours per day above the line and vendor bills below it, one colour per job"
            : "This job's year by week: crew hours per day above the line and vendor bills below it"
        }
        className="block h-[4.75rem] w-full touch-pan-y pad:h-24"
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setWeek(0)}
      />
    </div>
  );

  if (!dock) {
    return <div className="hidden overflow-hidden rounded-xl border border-line pad:block">{body}</div>;
  }
  return (
    <>
      {/* Holds the page clear of the dock, so the last row is never under it. */}
      <div className="h-28 pad:h-32" aria-hidden />
      <div
        className="fixed inset-x-0 z-20 border-t border-line"
        style={{ bottom: "var(--tabbar-h)", left: "var(--rail-w)" }}
      >
        {body}
      </div>
    </>
  );
}
