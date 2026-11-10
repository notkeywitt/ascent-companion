"use client";

import { useEffect, useState } from "react";
import { Banner, Button, Input, Loading, Segmented, Select } from "@/components/ui";
import type { Target } from "@/lib/toolSchedule";
import { TargetPicker, targetLabel, type PickTool, type PickType } from "./ToolPickers";

/**
 * Book a tool by hand — no JobTread task needed. A specific tool from the
 * Tools list, or any tool of a type. For a job (a need before its
 * Gantt exists, a tool kept on site) or for a place that is not a job (the
 * Shop, out for repair, loaned out). It counts like a scheduled task. Stored as
 * a "hold" (`/api/tool-schedule/holds`); office and admin only.
 */

const PLACES = ["Shop", "Out for repair", "Loaned out", "Rented out"];

interface Choices {
  tools: PickTool[];
  types: PickType[];
  jobs: { id: string; name: string }[];
}

export function BookingForm({ target = "", onSaved }: { target?: Target; onSaved: () => void }) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState<"job" | "place">("job");
  const [form, setForm] = useState({ target, jobId: "", place: "", startDate: "", endDate: "", qty: "1", note: "" });

  useEffect(() => {
    const get = async (url: string) => {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      return j;
    };
    Promise.all([get("/api/tool-schedule/catalog"), get("/api/tool-schedule/holds")])
      .then(([c, h]) => setChoices({ tools: c.tools ?? [], types: c.types ?? [], jobs: h.jobs ?? [] }))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const ready =
    form.target &&
    (where === "job" ? form.jobId : form.place.trim()) &&
    form.startDate &&
    form.endDate &&
    form.endDate >= form.startDate;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const jobName = choices?.jobs.find((j) => j.id === form.jobId)?.name ?? "";
      const body =
        where === "job"
          ? { target: form.target, jobId: form.jobId, jobName, startDate: form.startDate, endDate: form.endDate, qty: Number(form.qty) || 1, note: form.note }
          : { target: form.target, place: form.place.trim(), startDate: form.startDate, endDate: form.endDate, qty: Number(form.qty) || 1, note: form.note };
      const r = await fetch("/api/tool-schedule/holds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setForm((f) => ({ ...f, note: "" }));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!choices) return error ? <Banner tone="error">{error}</Banner> : <Loading />;
  const isTool = form.target.startsWith("tool:");

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void save();
      }}
    >
      {error && <Banner tone="error" className="sm:col-span-2">{error}</Banner>}
      <div className="grid gap-1 text-[12px] text-neutral-500 sm:col-span-2">
        Tool
        {form.target ? (
          <span className="flex flex-wrap items-center gap-2 text-sm text-neutral-900 dark:text-neutral-100">
            <b className="font-semibold">{targetLabel(form.target, choices.tools, choices.types)}</b>
            <Button variant="ghost" size="xs" onClick={() => setForm((f) => ({ ...f, target: "" }))}>
              Change
            </Button>
          </span>
        ) : (
          <TargetPicker tools={choices.tools} types={choices.types} onPick={(t) => setForm((f) => ({ ...f, target: t, qty: t.startsWith("tool:") ? "1" : f.qty }))} label="Choose a tool or a type…" />
        )}
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Segmented
          label="Book it for"
          value={where}
          onChange={setWhere}
          options={[
            { value: "job", label: "A job" },
            { value: "place", label: "Not a job" },
          ]}
        />
        {where === "job" ? (
          <Select id="book-job" aria-label="Job" value={form.jobId} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, jobId: v })); }}>
            <option value="">Choose a job…</option>
            {choices.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        ) : (
          <>
            <Input id="book-place" aria-label="Where" list="book-places" placeholder="Shop, Out for repair, Loaned to…" value={form.place} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, place: v })); }} />
            <datalist id="book-places">
              {PLACES.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </>
        )}
      </div>
      <label className="grid gap-1 text-[12px] text-neutral-500">
        From
        <Input id="book-start" type="date" value={form.startDate} onChange={(e) => {
            const startDate = e.target.value;
            setForm((f) => ({ ...f, startDate, endDate: f.endDate && f.endDate >= startDate ? f.endDate : startDate }));
          }} />
      </label>
      <label className="grid gap-1 text-[12px] text-neutral-500">
        To
        <Input id="book-end" type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, endDate: v })); }} />
      </label>
      <label className={`grid gap-1 text-[12px] text-neutral-500 ${isTool ? "hidden" : ""}`}>
        How many
        <Input id="book-qty" type="number" min={1} max={20} value={form.qty} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, qty: v })); }} />
      </label>
      <label className="grid gap-1 text-[12px] text-neutral-500">
        Note
        <Input id="book-note" value={form.note} placeholder="Optional" onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, note: v })); }} />
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || !ready}>
          Book tool
        </Button>
      </div>
    </form>
  );
}
