"use client";

import { useEffect, useState } from "react";

import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JobPicker, jobLabel } from "@/components/JobPicker";
import { Banner, Button, Dialog, Input, Label, Select, Textarea } from "@/components/ui";

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
 * When the pay type is one the employee does not hold, the editor offers to ADD
 * it to their JobTread membership (at the rate others usually carry for it),
 * so the record can post with the pay type the employee meant.
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
  // False = the list is the org's every name, because the grant cannot read theirs.
  const [ownTypes, setOwnTypes] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [newRate, setNewRate] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState("");
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
      .then((j) => {
        setPayTypes(j.ok === false ? [] : (j.payTypes ?? []));
        setOwnTypes(!!j.ownTypes);
        setRates(j.rates ?? {});
      })
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
  // Offer the add when the employee plainly lacks the type: it is off their own
  // list, or JobTread just refused it by name.
  const offerAdd =
    !!payType && !!row.jtUserId && (!payTypeKnown || /unknown time entry type/i.test(err)) && added !== payType;

  // Prefill the rate others usually carry for this pay type.
  useEffect(() => {
    setNewRate(rates[payType] ? String(rates[payType]) : "");
  }, [payType, rates]);

  async function addPayType() {
    setAdding(true);
    setErr("");
    try {
      const res = await fetch("/api/time-sync/pay-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.jtUserId, name: payType, hourlyRate: newRate }),
      });
      const j = await res.json();
      if (!j.ok) {
        setErr(j.error || "Could not add the pay type.");
        return;
      }
      setPayTypes(j.names ?? [...(payTypes ?? []), payType]);
      setOwnTypes(true);
      setAdded(payType);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the pay type.");
    } finally {
      setAdding(false);
    }
  }
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
    <Dialog
      onClose={onClose}
      busy={saving}
      title="Edit and post to JobTread"
      description={`${row.employee || "—"} · ${row.date}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? "Posting…" : "Save and post"}
          </Button>
        </>
      }
    >
        {row.detail && (
          <p className="mt-2 text-xs text-warn">JobTread said: {row.detail}</p>
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
              {!payTypeKnown && <option value={payType}>{payType} — not on their list</option>}
              {!payType && <option value="">Pick a pay type</option>}
              {(payTypes ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {payTypes && !payTypes.length && payType && payTypeKnown && <option value={payType}>{payType}</option>}
            </Select>
            {payTypes === null && <p className="mt-1 text-xs text-neutral-500">Loading pay types…</p>}
            {!payTypeKnown && !offerAdd && (
              <p className="mt-1 text-xs text-warn">
                JobTread does not have this pay type for {row.employee || "this employee"}. Pick one of theirs.
              </p>
            )}
            {payTypes && !ownTypes && !offerAdd && (
              <p className="mt-1 text-xs text-neutral-500">
                Every pay type in JobTread is listed — the app cannot read {row.employee || "this employee"}&apos;s own.
              </p>
            )}
            {added && added === payType && (
              <p className="mt-1 text-xs text-neutral-500">
                Added to {row.employee || "this employee"}&apos;s pay types in JobTread. Save and post to send the record.
              </p>
            )}
            {offerAdd && (
              <div className="mt-2 rounded-lg bg-neutral-100 p-3 dark:bg-white/10">
                <p className="text-xs">
                  {row.employee || "This employee"} does not hold <span className="font-semibold">{payType}</span> in
                  JobTread. Add it to their pay types?
                </p>
                <div className="mt-2 flex items-end gap-2">
                  <div className="w-28">
                    <Label htmlFor="ts-rate">Hourly rate</Label>
                    <Input
                      id="ts-rate"
                      inputMode="decimal"
                      placeholder="$0.00"
                      value={newRate}
                      onChange={(e) => setNewRate(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={adding || !(Number(newRate.replace(/[$,\s]/g, "")) > 0)}
                    onClick={addPayType}
                  >
                    {adding ? "Adding…" : "Add pay type"}
                  </Button>
                </div>
                {rates[payType] ? (
                  <p className="mt-1 text-xs text-neutral-500">Prefilled with the rate others carry for it.</p>
                ) : null}
              </div>
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
    </Dialog>
  );
}
