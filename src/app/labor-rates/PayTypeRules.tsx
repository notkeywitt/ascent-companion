"use client";

import { useEffect, useMemo, useState } from "react";

import { JobPicker, jobLabel, type JobRef } from "@/components/JobPicker";
import { Banner, Button, Card, Select } from "@/components/ui";
import type { CostCodeDefault, PayTypeRule } from "@/lib/payTypeMatch";

/**
 * DEFAULTS BY EMPLOYEE AND JOB, two tables on one form:
 *
 *   default cost code — employee + job → the code the time page selects when
 *   the employee picks that job. One per employee and job.
 *
 * DEFAULT PAY TYPES — employee + job + cost code → pay type. The time page
 * reads this table: when an employee picks a job and cost code, the pay type
 * follows it, on the clock, Log a range and Split View alike. "Any cost code"
 * covers the whole job; a rule for one code beats it.
 *
 * DB only (/api/labor-rates/rules). Nothing here writes to JobTread — the pay
 * type itself must already be on the employee (Employees & their rates, below).
 */

interface Member {
  userId: string;
  name: string;
  types: { name: string }[];
}

interface CostItem {
  id: string;
  number: string;
  name: string;
}

const ANY = "";

export function PayTypeRules({ members }: { members: Member[] }) {
  const [rules, setRules] = useState<PayTypeRule[]>([]);
  const [codeDefaults, setCodeDefaults] = useState<CostCodeDefault[]>([]);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");

  // The add form.
  const [userId, setUserId] = useState("");
  const [job, setJob] = useState<JobRef | null>(null);
  const [costs, setCosts] = useState<CostItem[] | null>(null);
  const [costCode, setCostCode] = useState(ANY);
  const [payType, setPayType] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/labor-rates/rules")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setErr(j.error);
        setRules(j.rules ?? []);
        setCodeDefaults(j.codeDefaults ?? []);
      })
      .catch(() => setErr("Could not load the defaults."));
  }, []);

  // The picked job's labor cost codes — one option per code number.
  useEffect(() => {
    setCosts(null);
    setCostCode(ANY);
    if (!job) return;
    fetch(`/api/employee-time?jobId=${encodeURIComponent(job.id)}`)
      .then((r) => r.json())
      .then((j) => {
        const seen = new Set<string>();
        setCosts(((j.costItems ?? []) as CostItem[]).filter((c) => c.number && !seen.has(c.number) && seen.add(c.number)));
      })
      .catch(() => setCosts([]));
  }, [job]);

  const byId = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);
  const typesOf = (id: string) => byId.get(id)?.types.map((t) => t.name) ?? [];
  const shown = rules
    .filter((r) => !filter || r.jtUserId === filter)
    .sort(
      (a, b) =>
        (byId.get(a.jtUserId)?.name ?? "").localeCompare(byId.get(b.jtUserId)?.name ?? "") ||
        a.jobName.localeCompare(b.jobName) ||
        a.costCode.localeCompare(b.costCode),
    );

  async function save(rule: Omit<PayTypeRule, "id">) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/labor-rates/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error || "Save failed.");
        return false;
      }
      setRules((rs) => [...rs.filter((r) => r.id !== j.rule.id), j.rule]);
      return true;
    } catch {
      setErr("Couldn't reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!userId || !job || !payType) return;
    const ok = await save({ jtUserId: userId, jobId: job.id, jobName: jobLabel(job), costCode, payType });
    if (ok) setPayType("");
  }

  async function setDefaultCode() {
    if (!userId || !job || !costCode) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/labor-rates/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "code", jtUserId: userId, jobId: job.id, jobName: jobLabel(job), costCode }),
      });
      const j = await res.json();
      if (!res.ok) return setErr(j.error || "Save failed.");
      setCodeDefaults((ds) => [...ds.filter((d) => d.id !== j.codeDefault.id), j.codeDefault]);
    } catch {
      setErr("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCode(d: CostCodeDefault) {
    const res = await fetch(`/api/labor-rates/rules?id=${d.id}&kind=code`, { method: "DELETE" });
    if (res.ok) setCodeDefaults((ds) => ds.filter((x) => x.id !== d.id));
    else setErr("Delete failed.");
  }

  const nameOf = (id: string) => byId.get(id)?.name ?? "Unknown employee";
  const shownCodes = codeDefaults
    .filter((d) => !filter || d.jtUserId === filter)
    .sort((a, b) => nameOf(a.jtUserId).localeCompare(nameOf(b.jtUserId)) || a.jobName.localeCompare(b.jobName));

  async function remove(r: PayTypeRule) {
    const res = await fetch(`/api/labor-rates/rules?id=${r.id}`, { method: "DELETE" });
    if (res.ok) setRules((rs) => rs.filter((x) => x.id !== r.id));
    else setErr("Delete failed.");
  }

  const codeLabel = (code: string) => code || "Any cost code";

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-neutral-500">Time page defaults</h2>
      <p className="mb-3 text-sm text-neutral-500">
        Set the cost code an employee starts on for a job, and the pay type they get on a job and cost code. The time
        page selects both for them. They can still change either.
      </p>
      {err && (
        <Banner tone="error" className="mb-3">
          {err}
        </Banner>
      )}

      <Card className="mb-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            aria-label="Employee"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setPayType("");
            }}
          >
            <option value="">Employee…</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
          <JobPicker
            value={job?.id ?? ""}
            onChange={() => {}}
            onSelect={setJob}
            includeAll={false}
            placeholder="Job…"
          />
          <Select aria-label="Cost code" value={costCode} onChange={(e) => setCostCode(e.target.value)} disabled={!job}>
            <option value={ANY}>{job && !costs ? "Loading cost codes…" : "Any cost code"}</option>
            {costs?.map((c) => (
              <option key={c.number} value={c.number}>
                {c.number} — {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Pay type" value={payType} onChange={(e) => setPayType(e.target.value)} disabled={!userId}>
            <option value="">{userId && !typesOf(userId).length ? "No pay types on this employee" : "Pay type…"}</option>
            {typesOf(userId).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={setDefaultCode} disabled={busy || !userId || !job || !costCode}>
            Set default cost code
          </Button>
          <Button onClick={add} disabled={busy || !userId || !job || !payType}>
            Add pay type
          </Button>
        </div>
      </Card>

      {(rules.length > 0 || codeDefaults.length > 0) && (
        <Select aria-label="Show employee" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-2 w-auto">
          <option value="">All employees</option>
          {members
            .filter((m) => [...rules, ...codeDefaults].some((r) => r.jtUserId === m.userId))
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
        </Select>
      )}

      <h3 className="mb-1 mt-3 text-xs font-semibold text-neutral-500">Default cost codes</h3>
      <Card pad={false} className="mb-3 divide-y divide-line-soft">
        {shownCodes.length === 0 && <p className="px-3 py-4 text-sm text-neutral-500">No default cost codes yet.</p>}
        {shownCodes.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{nameOf(d.jtUserId)}</span>
              <span className="block text-xs text-neutral-500">{d.jobName}</span>
            </span>
            <span className="tabular-nums">{d.costCode}</span>
            <button
              type="button"
              onClick={() => removeCode(d)}
              title="Delete default cost code"
              className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              ✕
            </button>
          </div>
        ))}
      </Card>

      <h3 className="mb-1 text-xs font-semibold text-neutral-500">Default pay types</h3>
      <Card pad={false} className="divide-y divide-line-soft">
        {shown.length === 0 && <p className="px-3 py-4 text-sm text-neutral-500">No default pay types yet.</p>}
        {shown.map((r) => {
          const types = typesOf(r.jtUserId);
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{byId.get(r.jtUserId)?.name ?? "Unknown employee"}</span>
                <span className="block text-xs text-neutral-500">
                  {r.jobName} · {codeLabel(r.costCode)}
                </span>
              </span>
              <Select
                aria-label="Pay type"
                value={r.payType}
                onChange={(e) => save({ ...r, payType: e.target.value })}
                className="w-auto max-w-[18rem]"
              >
                {/* Kept even when the employee no longer has it, so the row says what it holds. */}
                {!types.includes(r.payType) && <option value={r.payType}>{r.payType} (not on employee)</option>}
                {types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => remove(r)}
                title="Delete default"
                className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                ✕
              </button>
            </div>
          );
        })}
      </Card>
    </section>
  );
}
