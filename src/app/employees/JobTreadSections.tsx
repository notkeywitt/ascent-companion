"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, Input, Label, Select } from "@/components/ui";

export type PayType = { name: string; hourlyRate?: number };

const NEW = "__new";

/**
 * A linked employee's JobTread pay types — the same write as /labor-rates
 * (POST /api/labor-rates/apply), one type at a time: `applyRate` adds a type or
 * replaces its rate by name, `removeRate` drops it. Both read the member's
 * current set fresh on the server, so this can never clobber the other types.
 * Each change saves to JobTread at once; the form's Save button is not involved.
 */
export function PayTypes({
  membershipId,
  types,
  orgTypes,
  onChange,
}: {
  membershipId: string;
  types: PayType[];
  orgTypes: string[];
  onChange: (types: PayType[]) => void;
}) {
  const [pick, setPick] = useState("");
  const [newName, setNewName] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const have = useMemo(() => new Set(types.map((t) => t.name)), [types]);
  const choices = useMemo(() => orgTypes.filter((n) => !have.has(n)).sort(), [orgTypes, have]);
  const name = pick === NEW ? newName.trim() : pick;

  async function apply(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setErr("");
    try {
      const res = await fetch("/api/labor-rates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, membershipIds: [membershipId] }),
      });
      const json = await res.json();
      if (json.previewed) throw new Error(json.message);
      const r = json.results?.[0];
      if (!res.ok || !r?.ok) throw new Error(r?.error || json.error || "JobTread did not save it.");
      onChange(r.types ?? []);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function add() {
    const hourlyRate = Number(rate.replace(/[$,\s]/g, ""));
    if (!name) return setErr("Pick a pay type or name a new one.");
    if (!rate.trim() || !Number.isFinite(hourlyRate) || hourlyRate < 0) return setErr("Enter an hourly rate.");
    if (await apply({ mode: "applyRate", rate: { name, hourlyRate } }, "add")) {
      setPick("");
      setNewName("");
      setRate("");
    }
  }

  async function remove(n: string) {
    if (!confirm(`Remove the pay type "${n}" from this employee in JobTread?`)) return;
    await apply({ mode: "removeRate", name: n }, n);
  }

  return (
    <div className="mb-4 rounded-lg border border-line p-3">
      <Label>Pay types (JobTread)</Label>
      {types.length ? (
        <ul className="divide-y divide-line-soft">
          {types.map((t) => (
            <li key={t.name} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="text-neutral-700 dark:text-neutral-300">{t.name}</span>
              <span className="ml-auto whitespace-nowrap font-semibold tabular-nums">
                {t.hourlyRate != null ? `$${t.hourlyRate}/hr` : "—"}
              </span>
              <button
                type="button"
                onClick={() => remove(t.name)}
                disabled={!!busy}
                title={`Remove ${t.name}`}
                className="px-1 text-neutral-400 hover:text-red-600 disabled:opacity-40"
              >
                {busy === t.name ? "…" : "✕"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">No pay types yet.</p>
      )}

      <div className="mt-3 grid grid-cols-[1fr_6rem_auto] items-end gap-2">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Pay type">
          <option value="">Add a pay type…</option>
          {choices.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={NEW}>+ New pay type</option>
        </Select>
        <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="$/hr" inputMode="decimal" aria-label="Hourly rate" />
        <Button size="sm" onClick={add} disabled={!!busy || !pick}>
          {busy === "add" ? "Adding…" : "Add"}
        </Button>
        {pick === NEW && (
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New pay type name"
            className="col-span-3"
            autoFocus
          />
        )}
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">Saves to JobTread right away. Same pay types as Pay Rates.</p>
      {err && (
        <Banner tone="error" className="mt-2">
          {err}
        </Banner>
      )}
    </div>
  );
}

interface JobRow {
  id: string;
  name: string;
  number: string;
  customer: string;
  hasAccess: boolean;
}

/**
 * The open JobTread jobs this employee is on. JobTread will not let someone
 * clock in to a job they are not on. Adds only — taking someone off a job stays
 * in JobTread. Writes through /api/employees/job-access.
 */
export function JobAccess({ membershipId }: { membershipId: string }) {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "warning"; text: string } | null>(null);

  useEffect(() => {
    setJobs(null);
    setLoadErr("");
    setMsg(null);
    fetch(`/api/employees/job-access?membershipId=${encodeURIComponent(membershipId)}`)
      .then((r) => r.json())
      .then((j) => (j.error ? setLoadErr(j.error) : setJobs(j.jobs ?? [])))
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Could not load jobs."));
  }, [membershipId]);

  const missing = useMemo(() => (jobs ?? []).filter((j) => !j.hasAccess), [jobs]);
  const onCount = (jobs?.length ?? 0) - missing.length;

  async function grant(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/employees/job-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId, jobIds: ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not add job access.");
      setJobs(json.jobs ?? jobs);
      setPicked(new Set());
      setChoosing(false);
      const failed = (json.failed ?? []) as { name: string; error: string }[];
      setMsg(
        failed.length
          ? { tone: "warning", text: `Added to ${json.granted}. Failed: ${failed.map((f) => `${f.name} (${f.error})`).join("; ")}` }
          : { tone: "success", text: `Added to ${json.granted} job${json.granted === 1 ? "" : "s"}.` },
      );
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Could not add job access." });
    } finally {
      setBusy(false);
    }
  }

  function addAll() {
    if (confirm(`Add this employee to all ${missing.length} open jobs they are not on yet?`)) {
      grant(missing.map((j) => j.id));
    }
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="mb-4 rounded-lg border border-line p-3">
      <Label>JobTread jobs</Label>
      {loadErr ? (
        <p className="text-sm text-neutral-500">Unavailable ({loadErr}).</p>
      ) : !jobs ? (
        <p className="text-sm text-neutral-500">Loading jobs…</p>
      ) : (
        <>
          <p className="text-sm">
            On {onCount} of {jobs.length} open jobs.
            <span className="text-neutral-500"> They can only clock in to jobs they are on.</span>
          </p>
          {missing.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={addAll} disabled={busy}>
                {busy && !choosing ? "Adding…" : `Add to all open jobs (${missing.length})`}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setChoosing((c) => !c)} disabled={busy}>
                {choosing ? "Hide jobs" : "Choose jobs…"}
              </Button>
            </div>
          )}
          {choosing && (
            <>
              <div className="mt-2 max-h-56 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line">
                {jobs.map((j) => (
                  <label
                    key={j.id}
                    className={
                      "flex items-center gap-2 px-2 py-1.5 text-sm " +
                      (j.hasAccess ? "opacity-60" : "cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/5")
                    }
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={j.hasAccess || picked.has(j.id)}
                      disabled={j.hasAccess || busy}
                      onChange={() => toggle(j.id)}
                    />
                    <span className="font-medium">{j.name}</span>
                    <span className="ml-auto truncate text-xs text-neutral-500">
                      {[j.customer, j.number && `#${j.number}`].filter(Boolean).join(" · ")}
                    </span>
                  </label>
                ))}
              </div>
              <Button size="sm" className="mt-2" onClick={() => grant([...picked])} disabled={busy || !picked.size}>
                {busy ? "Adding…" : `Add to ${picked.size} job${picked.size === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </>
      )}
      {msg && (
        <Banner tone={msg.tone} className="mt-2">
          {msg.text}
        </Banner>
      )}
    </div>
  );
}
