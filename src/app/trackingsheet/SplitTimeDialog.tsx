"use client";

import { useEffect, useState } from "react";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JobPicker, jobLabel, type JobRef } from "@/components/JobPicker";
import { Banner, Button, Dialog, Input, Label, Loading, Textarea } from "@/components/ui";
import { toast } from "@/components/Toast";
import { orgParts, prettyClock } from "@/lib/orgTime";
import { splitClocks } from "@/lib/splitTime";
import { laborOptions, type TimeEntryRow } from "./TimeCodingCard";

/**
 * SPLIT ONE TIME ENTRY INTO TWO, side by side. The halves run back to back and
 * always add up to the original: the hours box on either side sets that side
 * and the other takes the rest (lib/splitTime.ts).
 *
 * Writes only through the two routes the panel already uses: the first half
 * edits the original in place (POST /api/time-entry, journaled there) and the
 * second is created (POST /api/time-entry/create, journaled there). The original
 * shrinks first, so the new entry cannot trip the create route's overlap check.
 */
interface Side {
  job: JobRef | null; // null = the entry's own job
  leafId: string;
  notes: string;
}

function SideForm({
  title,
  side,
  onChange,
  hours,
  onHours,
  clocks,
  jobId,
  ownOptions,
}: {
  title: string;
  side: Side;
  onChange: (s: Side) => void;
  hours: string;
  onHours: (v: string) => void;
  clocks: string;
  jobId: string;
  ownOptions: Option[];
}) {
  const moving = Boolean(side.job && side.job.id !== jobId);
  const [other, setOther] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!side.job || side.job.id === jobId) {
      setOther([]);
      setErr("");
      return;
    }
    let alive = true;
    setLoading(true);
    setErr("");
    fetch(`/api/time-entry?jobId=${encodeURIComponent(side.job.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        if (b.error) setErr(b.error);
        else setOther(laborOptions(b.budget ?? [], []));
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Failed to load cost codes"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [side.job, jobId]);

  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-line-soft p-3">
      <p className="text-sm font-semibold">{title}</p>
      <div>
        <Label>Job</Label>
        <JobPicker
          value={side.job?.id ?? jobId}
          onChange={() => {}}
          onSelect={(j) => onChange({ ...side, job: j, leafId: j?.id === jobId ? side.leafId : "" })}
          includeAll={false}
        />
        {moving && side.job && (
          <p className="mt-1 text-[11px] text-warn">{jobLabel(side.job)} — pick a cost code on it.</p>
        )}
      </div>
      <div>
        <Label>Cost code</Label>
        {loading ? (
          <Loading label="Loading cost codes…" />
        ) : err ? (
          <Banner tone="error" className="!py-1.5 !text-[11px]">
            {err}
          </Banner>
        ) : (
          <CostCodeSelect
            options={moving ? other : ownOptions}
            value={side.leafId}
            onChange={(id) => onChange({ ...side, leafId: id })}
          />
        )}
      </div>
      <div>
        <Label>Hours</Label>
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.25"
          value={hours}
          onChange={(e) => onHours(e.target.value)}
          className="tabular-nums"
        />
        <p className="mt-1 text-[11px] text-neutral-400">{clocks}</p>
      </div>
      <div>
        <Label>Item</Label>
        <Textarea
          rows={3}
          value={side.notes}
          onChange={(e) => onChange({ ...side, notes: e.target.value })}
        />
      </div>
    </div>
  );
}

export function SplitTimeDialog({
  entry,
  jobId,
  codeOptions,
  onClose,
  onSaved,
}: {
  entry: TimeEntryRow;
  jobId: string;
  codeOptions: Option[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const started = orgParts(entry.startedAt);
  const ended = orgParts(entry.endedAt);
  const totalMin = Math.round(
    (Date.parse(entry.endedAt ?? "") - Date.parse(entry.startedAt ?? "")) / 60000,
  );
  const [firstMin, setFirstMin] = useState(Math.floor(totalMin / 2));
  const base: Side = { job: null, leafId: entry.costItemId ?? "", notes: entry.notes };
  const [a, setA] = useState<Side>(base);
  const [b, setB] = useState<Side>(base);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const split = splitClocks(started.time, ended.time, firstMin);
  const setHours = (isFirst: boolean) => (v: string) => {
    const m = Math.round(Number(v) * 60);
    if (!Number.isFinite(m)) return;
    setFirstMin(isFirst ? m : totalMin - m);
  };
  const hrs = (m: number) => (m / 60).toFixed(2);
  const ready = Boolean(split && a.leafId && b.leafId && entry.userId);

  async function post(url: string, body: object) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async function save() {
    if (!split) return;
    setBusy(true);
    setMsg("");
    let firstDone = false;
    try {
      const upd: Record<string, string> = {
        id: entry.id,
        date: started.date,
        startTime: split.a.start,
        endTime: split.a.end,
        costItemId: a.leafId,
        notes: a.notes,
      };
      if (a.job && a.job.id !== jobId) upd.jobId = a.job.id;
      const r1 = await post("/api/time-entry", upd);
      if (r1.error) return setMsg(r1.error);
      if (r1.previewed) return setMsg(r1.message);
      firstDone = true;

      const d = new Date(`${started.date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + split.b.dayOffset);
      const r2 = await post("/api/time-entry/create", {
        userId: entry.userId,
        jobId: b.job?.id ?? jobId,
        costItemId: b.leafId,
        payType: entry.type,
        date: d.toISOString().slice(0, 10),
        startTime: split.b.start,
        endTime: split.b.end,
        notes: b.notes,
      });
      if (r2.error) {
        setMsg(`The first half saved, but the second did not: ${r2.error} Add it with Add time.`);
        onSaved();
        return;
      }
      toast("Split in JobTread.");
      onSaved();
      onClose();
    } catch (e) {
      setMsg(
        (firstDone ? "The first half saved, but the second did not: " : "") +
          (e instanceof Error ? e.message : "Failed to split"),
      );
    } finally {
      setBusy(false);
    }
  }

  const clocks = (c?: { start: string; end: string }) =>
    c ? `${prettyClock(c.start)} – ${prettyClock(c.end)}` : "";

  return (
    <Dialog
      onClose={onClose}
      title={`Split ${entry.employee}'s entry`}
      description={`${hrs(totalMin)}h in total. The two halves always add up to it.`}
      size="xl"
      busy={busy}
      footer={
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={!ready || busy} className="flex-1">
            {busy ? "Splitting…" : "Split & save"}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SideForm
          title="First half"
          side={a}
          onChange={setA}
          hours={hrs(firstMin)}
          onHours={setHours(true)}
          clocks={clocks(split?.a)}
          jobId={jobId}
          ownOptions={codeOptions}
        />
        <SideForm
          title="Second half"
          side={b}
          onChange={setB}
          hours={hrs(totalMin - firstMin)}
          onHours={setHours(false)}
          clocks={clocks(split?.b)}
          jobId={jobId}
          ownOptions={codeOptions}
        />
      </div>
      {!split && (
        <Banner tone="warning" className="mt-3 !py-1.5 !text-[11px]">
          Each half needs more than zero time.
        </Banner>
      )}
      {msg && (
        <Banner tone="error" className="mt-3 !py-1.5 !text-[11px]">
          {msg}
        </Banner>
      )}
    </Dialog>
  );
}
