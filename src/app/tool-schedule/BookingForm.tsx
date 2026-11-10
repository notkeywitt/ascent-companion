"use client";

import { useEffect, useState } from "react";
import { Banner, Button, Input, Loading, Segmented, Select } from "@/components/ui";

/**
 * Book a tool by hand — no JobTread task needed. For a job (a need before its
 * Gantt exists, a tool kept on site) or for a place that is not a job (the
 * Shop, out for repair, loaned out). It counts like a scheduled task. Stored as
 * a "hold" (`/api/tool-schedule/holds`); office and admin only.
 */

const PLACES = ["Shop", "Out for repair", "Loaned out", "Rented out"];

interface Choices {
  kinds: { id: string; name: string }[];
  jobs: { id: string; name: string }[];
}

export function BookingForm({ kindId = "", onSaved }: { kindId?: string; onSaved: () => void }) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState<"job" | "place">("job");
  const [form, setForm] = useState({ kindId, jobId: "", place: "", startDate: "", endDate: "", qty: "1", note: "" });

  useEffect(() => {
    fetch("/api/tool-schedule/holds")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        setChoices(j as Choices);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const ready =
    form.kindId &&
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
          ? { kindId: form.kindId, jobId: form.jobId, jobName, startDate: form.startDate, endDate: form.endDate, qty: Number(form.qty) || 1, note: form.note }
          : { kindId: form.kindId, place: form.place.trim(), startDate: form.startDate, endDate: form.endDate, qty: Number(form.qty) || 1, note: form.note };
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
  if (choices.kinds.length === 0) return <p className="text-sm text-neutral-500">Add a tool type in the catalogue first.</p>;

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void save();
      }}
    >
      {error && <Banner tone="error" className="sm:col-span-2">{error}</Banner>}
      <label className="grid gap-1 text-[12px] text-neutral-500 sm:col-span-2">
        Tool type
        <Select id="book-kind" value={form.kindId} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, kindId: v })); }}>
          <option value="">Choose…</option>
          {choices.kinds.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </Select>
      </label>
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
      <label className="grid gap-1 text-[12px] text-neutral-500">
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
