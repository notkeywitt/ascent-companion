"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useAccess } from "@/components/AccessProvider";
import { jobLabel, type JobRef } from "@/components/JobPicker";
import { Button, Select, Textarea } from "@/components/ui";
import { billingMonths } from "@/lib/billingMonths";
import { readBugSide } from "@/lib/timeClockShared";

/**
 * The Notes card — a small card that floats over every page on a DESKTOP
 * (1024px and up), opened by the rail's Notes button. It is for jotting a bug
 * or a UI tweak while you move through the app. The draft survives page changes
 * and reloads (localStorage), so it is "persistent".
 *
 * Save routes the note by its type:
 *   Feature request → /api/feature-requests (the Requests page). The page you
 *                     were on is added to the detail.
 *   General         → /api/notes, no job (an office-wide note)
 *   Job             → /api/notes with the job (the job's notes; Jobs page)
 *   Billing month   → /api/notes with the month (that month's notes, and the
 *                     job too if one is picked)
 * The note types other than Feature request need the "jobs-hub" view, the
 * gate of /api/notes.
 */

const OPEN_EVENT = "ascent:notes-open";
const LS = "notesBug.v1";
const LS_POS = "notesBug.pos.v1"; // { x, y, op } — card corner + opacity, per device

export const openNotesBug = () => window.dispatchEvent(new Event(OPEN_EVENT));

type Kind = "feature" | "general" | "job" | "month";
const KINDS: { id: Kind; label: string }[] = [
  { id: "feature", label: "Feature request" },
  { id: "general", label: "General" },
  { id: "job", label: "Job" },
  { id: "month", label: "Billing month" },
];

interface Draft {
  open: boolean;
  kind: Kind;
  body: string;
  jobId: string;
  ym: string;
}

const MONTHS = billingMonths(12);

function load(): Draft {
  const base: Draft = { open: false, kind: "feature", body: "", jobId: "", ym: MONTHS[0].value };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(LS) ?? "{}") };
  } catch {
    return base;
  }
}

export function NotesBug() {
  const { can } = useAccess();
  const path = usePathname();
  const [d, setD] = useState<Draft | null>(null); // null until mounted (localStorage)
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [desktop, setDesktop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [side, setSide] = useState<"left" | "right">("right");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // null = default corner
  const [op, setOp] = useState(1);
  const card = useRef<HTMLElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const clamp = (x: number, y: number) => {
    const r = card.current?.getBoundingClientRect();
    const w = r?.width ?? 320;
    const h = r?.height ?? 300;
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - w)),
      y: Math.max(0, Math.min(y, window.innerHeight - h)),
    };
  };

  const canNotes = can("jobs-hub");
  const kinds = canNotes ? KINDS : KINDS.slice(0, 1);

  useEffect(() => {
    setD(load());
    try {
      const v = JSON.parse(localStorage.getItem(LS_POS) ?? "{}");
      if (typeof v.op === "number") setOp(Math.max(0.3, Math.min(1, v.op)));
      if (typeof v.x === "number" && typeof v.y === "number") setPos(clamp(v.x, v.y));
    } catch {}
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    const show = () => {
      setSide(readBugSide() === "right" ? "left" : "right"); // the corner the time bug is not in
      setD((x) => (x ? { ...x, open: !x.open } : x));
    };
    window.addEventListener(OPEN_EVENT, show);
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      mq.removeEventListener("change", on);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, []);

  useEffect(() => {
    if (!d) return;
    try {
      localStorage.setItem(LS, JSON.stringify(d));
    } catch {}
  }, [d]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_POS, JSON.stringify({ ...pos, op }));
    } catch {}
  }, [pos, op]);

  const needsJob = d?.kind === "job" || d?.kind === "month";
  useEffect(() => {
    if (!d?.open || !needsJob || jobs.length) return;
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => {});
  }, [d?.open, needsJob, jobs.length]);

  if (!d || !d.open || !desktop) return null;
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const kind = kinds.some((k) => k.id === d.kind) ? d.kind : "feature";

  async function save() {
    if (!d || busy) return;
    const text = d.body.trim();
    if (!text) return setMsg("Write something first.");
    if (kind === "job" && !d.jobId) return setMsg("Pick a job.");
    const job = jobs.find((j) => j.id === d.jobId);
    setBusy(true);
    setMsg("");
    try {
      const res =
        kind === "feature"
          ? await fetch("/api/feature-requests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: text.split("\n")[0].slice(0, 120),
                detail: `${text}\n\n(from ${path})`,
              }),
            })
          : await fetch("/api/notes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                body: text,
                ...(kind !== "general" && d.jobId ? { jobId: d.jobId, jobLabel: job ? jobLabel(job) : "" } : {}),
                ...(kind === "month" ? { billingYm: d.ym } : {}),
              }),
            });
      if (!res.ok) throw new Error(String(res.status));
      setD({ ...d, body: "" });
      setMsg(kind === "feature" ? "Saved to Feature Requests." : "Saved to Notes.");
    } catch {
      setMsg("It did not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      ref={card}
      aria-label="Notes"
      className="fixed z-40 w-80 rounded-xl border border-line bg-white shadow-lg dark:bg-ink-raised print:hidden"
      style={{
        opacity: op,
        ...(pos
          ? { left: pos.x, top: pos.y }
          : {
              bottom: "calc(var(--actionbar-bottom) + var(--actionbar-h) + 0.5rem)",
              ...(side === "left" ? { left: "calc(var(--rail-w) + 2.75rem)" } : { right: "1rem" }),
            }),
      }}
    >
      <div className="flex items-center gap-2 border-b border-line-soft py-1 pl-3 pr-1">
        <span
          className="flex-1 cursor-move touch-none select-none text-sm font-semibold"
          title="Drag to move"
          onPointerDown={(e) => {
            const r = card.current!.getBoundingClientRect();
            drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current) setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          Notes
        </span>
        <input
          type="range"
          min={0.3}
          max={1}
          step={0.05}
          value={op}
          onChange={(e) => setOp(Number(e.target.value))}
          aria-label="Card opacity"
          title="Opacity"
          className="w-16"
        />
        <button
          type="button"
          onClick={() => set({ open: false })}
          aria-label="Close notes"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-accent/10 hover:text-accent dark:text-neutral-400"
        >
          ×
        </button>
      </div>
      <div className="space-y-2 p-3">
        <Textarea
          autoFocus
          rows={5}
          value={d.body}
          onChange={(e) => set({ body: e.target.value })}
          placeholder="A bug, a tweak, a thought…"
        />
        <Select aria-label="Type of note" value={kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
          {kinds.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </Select>
        {kind === "month" && (
          <Select aria-label="Billing month" value={d.ym} onChange={(e) => set({ ym: e.target.value })}>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        )}
        {(kind === "job" || kind === "month") && (
          <Select aria-label="Job" value={d.jobId} onChange={(e) => set({ jobId: e.target.value })}>
            <option value="">{kind === "job" ? "Pick a job…" : "No job (whole month)"}</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {jobLabel(j)}
              </option>
            ))}
          </Select>
        )}
        {msg && <p className="text-[12px] text-neutral-500">{msg}</p>}
        <Button type="button" className="w-full" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </aside>
  );
}
