"use client";

import { useEffect, useState } from "react";

import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JobPicker, jobLabel } from "@/components/JobPicker";
import { Banner, Button, Input, Label, Select, Textarea } from "@/components/ui";

/**
 * The Time Sync editor — a pop-up over one record JobTread refused, so the
 * office can correct what JobTread objected to and post it in one step.
 *
 * The usual refusal is a pay type the employee does not hold in JobTread
 * ("Unknown time entry type 'Thomas - PM' for user Casey"), so the pay type
 * list is THAT person's own, read from JobTread. Job, cost code, times and
 * note are editable too, because each of them can be the thing JobTread
 * refuses.
 *
 * Saving posts through the same path as Retry (`retryWorked` with edits), with
 * all its duplicate guards. The sheet takes the corrections only once JobTread
 * accepts the entry; a refusal keeps the dialog open with JobTread's reason.
 */

export interface EditableRow {
  entryId: string;
  date: string;
  employee: string;
  jtUserId: string;
  jobLabel: string;
  jobId: string;
  costCode: string;
  costItemId: string;
  payType: string;
  start: string;
  end: string;
  note: string;
  detail: string;
}

/** The sheet's "2026-09-23 7:00" → the "2026-09-23T07:00" a datetime-local input takes. */
function toInput(v: string): string {
  const m = (v ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/);
  return m ? `${m[1]}T${m[2].padStart(2, "0")}:${m[3]}` : "";
}

export function TimeSyncEditor({
  row,
  onClose,
  onSaved,
}: {
  row: EditableRow;
  onClose: () => void;
  /** Called after JobTread took the entry, with any note the route returned. */
  onSaved: (note: string) => void;
}) {
  const [jobId, setJobId] = useState(row.jobId);
  const [jobName, setJobName] = useState(row.jobLabel);
  const [costItemId, setCostItemId] = useState(row.costItemId);
  const [costItems, setCostItems] = useState<Option[]>([]);
  const [costsLoading, setCostsLoading] = useState(false);
  const [payType, setPayType] = useState(row.payType);
  const [payTypes, setPayTypes] = useState<string[] | null>(null);
  const [start, setStart] = useState(toInput(row.start));
  const [end, setEnd] = useState(toInput(row.end));
  const [note, setNote] = useState(row.note);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!row.jtUserId) {
      setPayTypes([]);
      return;
    }
    fetch(`/api/time-sync/options?userId=${encodeURIComponent(row.jtUserId)}`)
      .then((r) => r.json())
      .then((j) => setPayTypes(j.ok === false ? [] : (j.payTypes ?? [])))
      .catch(() => setPayTypes([]));
  }, [row.jtUserId]);

  useEffect(() => {
    setCostItems([]);
    if (!jobId) return;
    setCostsLoading(true);
    fetch(`/api/time-sync/options?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j) => setCostItems(j.ok === false ? [] : (j.costItems ?? [])))
      .catch(() => setCostItems([]))
      .finally(() => setCostsLoading(false));
  }, [jobId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const payTypeKnown = !payTypes?.length || payTypes.includes(payType);
  const costItem = costItems.find((c) => c.id === costItemId);
  const canSave = !saving && !!jobId && !!costItemId && !!payType && !!start && !!end && payTypeKnown;

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/time-sync/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "edit",
          id: row.entryId,
          edits: {
            jobId,
            jobLabel: jobName,
            costItemId,
            costCode: costItem?.number ?? row.costCode,
            payType,
            start,
            end,
            note,
          },
        }),
      });
      const j = await res.json();
      if (j.ok && j.jtEntryId) onSaved(j.error || "Posted to JobTread.");
      else setErr(j.error || `Not posted: ${j.jtStatus || "unknown"}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={() => !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="time-sync-edit-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl dark:bg-ink-raised"
      >
        <h2 id="time-sync-edit-title" className="text-base font-bold tracking-tight">
          Edit and post to JobTread
        </h2>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
          {row.employee || "—"} · {row.date}
        </p>
        {row.detail && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">JobTread said: {row.detail}</p>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <Label>Job</Label>
            <JobPicker
              value={jobId}
              onChange={(id) => {
                // A line belongs to one job, so a new job clears the pick.
                if (id !== jobId) setCostItemId("");
                setJobId(id);
              }}
              onSelect={(j) => setJobName(j ? jobLabel(j) : "")}
              includeAll={false}
              fallbackLabel={row.jobLabel}
            />
          </div>

          <div>
            <Label>Cost code</Label>
            {costsLoading ? (
              <p className="text-sm text-neutral-500">Loading cost codes…</p>
            ) : costItems.length ? (
              <CostCodeSelect options={costItems} value={costItemId} onChange={setCostItemId} />
            ) : (
              <p className="text-sm text-neutral-500">{jobId ? "This job has no line that takes time." : "Pick a job first."}</p>
            )}
          </div>

          <div>
            <Label htmlFor="ts-pay-type">Pay type</Label>
            <Select id="ts-pay-type" value={payType} onChange={(e) => setPayType(e.target.value)}>
              {!payTypeKnown && <option value={payType}>{payType} — not in JobTread</option>}
              {!payType && <option value="">Pick a pay type</option>}
              {(payTypes ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {payTypes && !payTypes.length && payType && payTypeKnown && <option value={payType}>{payType}</option>}
            </Select>
            {payTypes === null && <p className="mt-1 text-xs text-neutral-500">Loading pay types…</p>}
            {!payTypeKnown && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                JobTread does not have this pay type for {row.employee || "this employee"}. Pick one of theirs.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ts-start">Start</Label>
              <Input id="ts-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ts-end">Stop</Label>
              <Input id="ts-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="ts-note">Note</Label>
            <Textarea id="ts-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        {err && (
          <Banner tone="warning" className="mt-4">
            {err}
          </Banner>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? "Posting…" : "Save and post"}
          </Button>
        </div>
      </div>
    </div>
  );
}
