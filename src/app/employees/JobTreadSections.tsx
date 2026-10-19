"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, Input, Label, Select } from "@/components/ui";

export type PayType = { name: string; hourlyRate?: number };

const NEW = "__new";

/**
 * The employee's JobTread pay types as ONE ORDERED LIST — the same rule as Pay
 * Rates' editor (owner, 2026-10-18, option B): edit rates, add, remove and
 * reorder here, then Save writes exactly this list, in this order, to JobTread
 * (/api/labor-rates/apply, mode "set"). The first rate is the Time page's
 * default. Nothing is written until Save.
 */
const PROTECTED = new Set(["paid time off", "sick pay"]);

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
  const [draft, setDraft] = useState<{ name: string; hourlyRate: string }[]>(() =>
    types.map((t) => ({ name: t.name, hourlyRate: t.hourlyRate != null ? String(t.hourlyRate) : "" })),
  );
  const [pick, setPick] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");

  const have = useMemo(() => new Set(draft.map((t) => t.name)), [draft]);
  const choices = useMemo(() => orgTypes.filter((n) => !have.has(n)).sort(), [orgTypes, have]);
  const dirty =
    draft.length !== types.length ||
    draft.some((d, i) => d.name !== types[i]?.name || Number(d.hourlyRate) !== Number(types[i]?.hourlyRate ?? NaN));

  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const n = [...d];
      const j = i + dir;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  function add() {
    const name = pick === NEW ? newName.trim() : pick;
    if (!name) return setErr("Pick a pay type or name a new one.");
    setErr("");
    setDraft((d) => [...d, { name, hourlyRate: "" }]);
    setPick("");
    setNewName("");
  }

  async function save() {
    const out: PayType[] = [];
    for (const d of draft) {
      const r = Number(d.hourlyRate.replace(/[$,\s]/g, ""));
      if (!d.name.trim()) return setErr("Every pay type needs a name.");
      if (!d.hourlyRate.trim() || !Number.isFinite(r) || r < 0) return setErr(`Enter an hourly rate for "${d.name}".`);
      out.push({ name: d.name.trim(), hourlyRate: r });
    }
    if (out.length > 20) return setErr("JobTread allows at most 20 pay types per employee.");
    setBusy(true);
    setErr("");
    setSaved("");
    try {
      const res = await fetch("/api/labor-rates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "set", membershipId, types: out }),
      });
      const json = await res.json();
      if (json.previewed) throw new Error(json.message);
      const r = json.results?.[0];
      if (!res.ok || !r?.ok) throw new Error(r?.error || json.error || "JobTread did not save it.");
      const fresh: PayType[] = r.types ?? out;
      onChange(fresh);
      setDraft(fresh.map((t) => ({ name: t.name, hourlyRate: t.hourlyRate != null ? String(t.hourlyRate) : "" })));
      setSaved("Saved to JobTread.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Label>Pay types (JobTread)</Label>
      {draft.length ? (
        <ul className="divide-y divide-line-soft">
          {draft.map((t, i) => (
            <li key={`${t.name}-${i}`} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up" className="px-1 text-xs text-neutral-500 hover:text-accent disabled:opacity-30">▲</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} title="Move down" className="px-1 text-xs text-neutral-500 hover:text-accent disabled:opacity-30">▼</button>
              </span>
              <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">
                {t.name}
                {i === 0 && <span className="ml-1.5 text-[11px] text-neutral-500">default</span>}
              </span>
              <Input
                value={t.hourlyRate}
                onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, hourlyRate: e.target.value } : x)))}
                placeholder="$/hr"
                inputMode="decimal"
                aria-label={`${t.name} hourly rate`}
                className="!w-20"
              />
              <button
                type="button"
                onClick={() => {
                  if (PROTECTED.has(t.name.trim().toLowerCase()) && !confirm(`"${t.name}" is used to post time off. Remove it anyway?`)) return;
                  setDraft((d) => d.filter((_, j) => j !== i));
                }}
                title={`Remove ${t.name}`}
                className="px-1 text-neutral-400 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">No pay types yet.</p>
      )}

      <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Pay type">
          <option value="">Add a pay type…</option>
          {choices.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={NEW}>+ New pay type</option>
        </Select>
        <Button size="sm" variant="secondary" onClick={add} disabled={!pick}>
          Add
        </Button>
        {pick === NEW && (
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New pay type name"
            className="col-span-2"
            autoFocus
          />
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save pay types to JobTread"}
        </Button>
        {saved && !dirty && <span className="text-xs text-neutral-500">{saved}</span>}
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        Saves this exact list, in this order. The first is the default on the Time page. Same rule as Pay Rates.
      </p>
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
