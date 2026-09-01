"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import {
  Banner,
  Button,
  Card,
  Input,
  Label,
  Loading,
  Select,
  Textarea,
} from "@/components/ui";
import { clockOfMinutes, minutesOfClock, orgParts, prettyClock, spanHours } from "@/lib/orgTime";

/**
 * ADD TIME — the "log an entry that never got logged" half of Tracking Sheets'
 * Time & labor block.
 *
 * TimeCodingCard fixes an entry the crew already logged. This one creates the
 * entry that is MISSING: a day somebody worked and never clocked, a hand-written
 * timecard the office is entering, hours a subcontracted lead phoned in. Same
 * column, same fields, one extra — WHO — because the office is logging for
 * somebody else. /employee-time can only log for the signed-in person, which is
 * exactly why this exists here.
 *
 * The job is the board's job and is not offered as a choice: the dialog opens
 * from inside a job's month, and a wrong-job entry is what the edit panel's job
 * move is for. Cost codes are that job's LABOR leaves, the same set the edit
 * panel offers (laborOptions in TimeCodingCard.tsx).
 *
 * A PAY TYPE IS REQUIRED — JobTread derives the entry's cost from it (minutes ×
 * that type's rate) and rejects a create without one. The list is the chosen
 * employee's OWN pay types when the grant can read them, falling back to the
 * org-wide names.
 *
 * WRITES IMMEDIATELY, like the edit panel and unlike the bill board's staged
 * recoding: there is nothing to try against the budget — the hours were either
 * worked or they weren't.
 */

interface UserRef {
  id: string;
  name: string;
  isInternal?: boolean;
  types?: { name: string; hourlyRate?: number }[];
}

export function AddTimeCard({
  jobId,
  jobLabel,
  codeOptions,
  writes,
  onSaved,
  onClose,
}: {
  jobId: string;
  jobLabel: string;
  /** The job's labor leaves — the same options the edit panel codes against. */
  codeOptions: Option[];
  writes: boolean;
  /** Reload the board — a new entry's hours and cost just landed on a code. */
  onSaved: () => void;
  onClose: () => void;
}) {
  // Today, in the org's timezone — the office is usually entering a day that
  // just happened, and a date-picker opened on the right month beats one opened
  // on the browser's idea of today.
  const today = useMemo(() => orgParts(new Date().toISOString()).date, []);

  const [users, setUsers] = useState<UserRef[]>([]);
  const [orgTypes, setOrgTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [userId, setUserId] = useState("");
  const [leafId, setLeafId] = useState("");
  const [payType, setPayType] = useState("");
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("15:30");
  const [hoursText, setHoursText] = useState(() => (spanHours("07:00", "15:30") ?? 0).toFixed(2));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  // The roster + pay types. Loaded once when the dialog opens rather than with
  // the board: nobody pays for this list on a page view that never adds time.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/time-entry/create", { cache: "no-store" });
        const b = await r.json();
        if (!alive) return;
        if (b.error) setLoadError(b.error);
        else {
          setUsers(((b.users ?? []) as UserRef[]).filter((u) => u.isInternal !== false));
          setOrgTypes((b.orgTypes ?? []) as string[]);
        }
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : "Failed to load the roster");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const picked = users.find((u) => u.id === userId);
  // That person's own pay types, or the org-wide names when the grant can't
  // read per-member sets (they 403 as a group — see getOrgUsers).
  const payTypes = useMemo(
    () => (picked?.types?.length ? picked.types.map((t) => t.name) : orgTypes),
    [picked, orgTypes],
  );

  // A pay type carried over from the previous employee may not exist on this
  // one, and JobTread would reject it. Keep it only when it's still offered.
  useEffect(() => {
    setPayType((prev) => (prev && payTypes.includes(prev) ? prev : (payTypes[0] ?? "")));
  }, [payTypes]);

  /* ---- hours ↔ end time ----
     The same three-sided triangle as the edit panel, and for the same reason:
     "he worked eight hours" and "he left at 3:30" are both how the day arrives.
     Moving the START keeps the duration; typing an END sets it; typing HOURS
     sets the end. */
  const spanned = spanHours(start, end);

  const changeStart = useCallback(
    (v: string) => {
      const s = minutesOfClock(v);
      const keep = spanHours(start, end);
      setStart(v);
      if (s != null && keep != null && end) setEnd(clockOfMinutes(s + keep * 60));
    },
    [start, end],
  );
  const changeEnd = useCallback(
    (v: string) => {
      setEnd(v);
      const h = spanHours(start, v);
      if (h != null) setHoursText(h.toFixed(2));
    },
    [start],
  );
  const changeHours = useCallback(
    (v: string) => {
      setHoursText(v);
      const h = Number(v);
      const s = minutesOfClock(start);
      if (s != null && Number.isFinite(h) && h > 0 && h <= 24) setEnd(clockOfMinutes(s + h * 60));
    },
    [start],
  );

  const canSave =
    writes &&
    !saving &&
    !loading &&
    Boolean(userId && leafId && payType && date && start && end) &&
    spanned != null &&
    spanned > 0;

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/time-entry/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          jobId,
          costItemId: leafId,
          payType,
          date,
          startTime: start,
          endTime: end,
          notes,
        }),
      });
      const b = await r.json();
      if (b.error) {
        setMsg({ tone: "error", text: b.error });
      } else if (b.previewed) {
        setMsg({ tone: "info", text: b.message });
      } else {
        setMsg({ tone: "success", text: "Added to JobTread." });
        onSaved();
      }
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-h-[85dvh] overflow-y-auto">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold">Add time</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-xs font-semibold text-neutral-400 transition hover:text-accent"
        >
          Close
        </button>
      </div>
      <p className="mb-3 min-w-0 truncate text-xs text-neutral-500">{jobLabel}</p>

      {!writes && (
        <Banner tone="warning" className="mb-3 !py-1.5 !text-[11px]">
          Writes are off, so nothing will be sent to JobTread.
        </Banner>
      )}
      {loadError && (
        <Banner tone="error" className="mb-3 !py-1.5 !text-[11px]">
          {loadError}
        </Banner>
      )}

      {loading ? (
        <Loading label="Loading the roster…" />
      ) : (
        <div className="space-y-3">
          {/* ---- who ---- the one field the edit panel doesn't need. */}
          <div>
            <Label htmlFor="at-user">Employee</Label>
            <Select id="at-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Pick an employee…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>

          {/* ---- coding ---- */}
          <div>
            <Label>Cost code</Label>
            {codeOptions.length === 0 ? (
              <p className="text-xs text-neutral-500">
                This job has no labor budget lines to code time to.
              </p>
            ) : (
              <CostCodeSelect options={codeOptions} value={leafId} onChange={setLeafId} />
            )}
          </div>

          {/* ---- pay type ---- JobTread's cost comes from this, so it isn't
              optional and it isn't cosmetic. */}
          <div>
            <Label htmlFor="at-paytype">Pay type</Label>
            <Select
              id="at-paytype"
              value={payType}
              onChange={(e) => setPayType(e.target.value)}
              disabled={payTypes.length === 0}
            >
              {payTypes.length === 0 && <option value="">No pay types on this person</option>}
              {payTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            {picked?.types?.length ? (
              <p className="mt-1 text-[11px] text-neutral-400">
                The cost is these hours × this pay type&apos;s rate.
              </p>
            ) : null}
          </div>

          {/* ---- the day ---- */}
          <div>
            <Label htmlFor="at-date">Date</Label>
            <Input
              id="at-date"
              type="date"
              value={date}
              disabled={!writes}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* ---- the window worked ---- */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="at-start">Start</Label>
              <Input
                id="at-start"
                type="time"
                value={start}
                disabled={!writes}
                onChange={(e) => changeStart(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="at-end">End</Label>
              <Input
                id="at-end"
                type="time"
                value={end}
                disabled={!writes}
                onChange={(e) => changeEnd(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="at-hours">Hours</Label>
              <Input
                id="at-hours"
                type="number"
                inputMode="decimal"
                min="0"
                max="24"
                step="0.25"
                value={hoursText}
                disabled={!writes}
                onChange={(e) => changeHours(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>
          {start && end && (
            <p className="text-[11px] text-neutral-400">
              {prettyClock(start)} – {prettyClock(end)}
              {spanned != null ? ` · ${spanned.toFixed(2)}h` : ""}
              {spanned != null && minutesOfClock(end)! <= minutesOfClock(start)!
                ? " (next day)"
                : ""}
            </p>
          )}

          <div>
            <Label htmlFor="at-note">Note</Label>
            <Textarea
              id="at-note"
              rows={2}
              value={notes}
              disabled={!writes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was worked on (optional)"
            />
          </div>
        </div>
      )}

      {msg && (
        <Banner tone={msg.tone} className="mt-3 !py-1.5 !text-[11px]">
          {msg.text}
        </Banner>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!canSave} className="flex-1">
          {saving ? "Adding…" : "Add to JobTread"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
