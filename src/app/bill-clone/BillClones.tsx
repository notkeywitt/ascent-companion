"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, Button, Card, Chip, Input, Loading, Select, tableCls, type ChipTone } from "@/components/ui";
import { canReclone, type ClonePair, type CloneDoc, type StatementLine, type StatementVerdict } from "@/lib/billClone";
import { money } from "@/lib/money";

// BILL CLONES — re-file one vendor's month of Expenses as Bills. Four steps,
// one button each, run in order. Server rules: src/app/api/bill-clone/route.ts.

interface Vendor {
  id: string;
  name: string;
}
interface Data {
  pairs: ClonePair[];
  extraClones: CloneDoc[];
  skipped: CloneDoc[];
  statement: {
    ok: boolean;
    error?: string;
    lineCount?: number;
    byCloneId?: Record<string, { verdict: StatementVerdict; statementAmount?: number }>;
    unmatched?: StatementLine[];
  } | null;
}

const STEPS = [
  { action: "clone", stage: "no clone", label: "1. Clone", busy: "Cloning", batch: 5 },
  { action: "toBill", stage: "cloned", label: "2. Make clones Bills", busy: "Switching", batch: 5 },
  { action: "approve", stage: "bill", label: "3. Approve clones", busy: "Approving", batch: 5 },
  { action: "void", stage: "approved", label: "4. Void old Expenses", busy: "Voiding", batch: 1 },
] as const;

const STAGE_TONE: Record<ClonePair["stage"], ChipTone> = {
  "no clone": "neutral",
  cloned: "info",
  bill: "info",
  approved: "warning",
  done: "success",
};
const VERDICT_TONE: Record<StatementVerdict, ChipTone> = {
  match: "success",
  "amount differs": "danger",
  "not on statement": "warning",
};

const jtUrl = (d: CloneDoc) =>
  `https://app.jobtread.com/jobs/${encodeURIComponent(d.jobId)}/documents/${encodeURIComponent(d.id)}`;
const STATUS: Record<string, string> = { draft: "Draft", pending: "Approved", approved: "Approved", denied: "Voided" };

function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function DocCell({ d }: { d: CloneDoc }) {
  return (
    <div className="min-w-0">
      <a href={jtUrl(d)} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
        {d.externalId || d.id}
      </a>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">
        {d.name} · {STATUS[d.status] ?? d.status}
        {d.qboId ? " · in QBO" : ""} · #{d.number}
      </div>
    </div>
  );
}

export function BillClones() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [ym, setYm] = useState(lastMonth);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => {
        const list: Vendor[] = (j.vendors ?? []).map((v: Vendor) => ({ id: v.id, name: v.name }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setVendors(list);
        const sunset = list.find((v) => /sunset builders/i.test(v.name));
        if (sunset) setVendorId((cur) => cur || sunset.id);
      })
      .catch(() => setError("Could not load vendors."));
  }, []);

  const load = useCallback(async () => {
    if (!vendorId || !ym) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/bill-clone?vendorId=${encodeURIComponent(vendorId)}&ym=${encodeURIComponent(ym)}`);
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [vendorId, ym]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of data?.pairs ?? []) c[p.stage] = (c[p.stage] ?? 0) + 1;
    return c;
  }, [data]);

  async function run(step: (typeof STEPS)[number]) {
    if (!data) return;
    const ids = data.pairs.filter((p) => p.stage === step.stage).map((p) => p.original.id);
    if (ids.length === 0) return;
    const warn =
      step.action === "approve"
        ? `Approve ${ids.length} clone(s)? Each one pushes to QuickBooks as a Bill.`
        : step.action === "void"
          ? `Void ${ids.length} old Expense(s) in JobTread? Delete or void them in QuickBooks yourself.`
          : `${step.label.slice(3)}: ${ids.length} document(s)?`;
    if (!window.confirm(warn)) return;
    setBusy(step.action);
    const lines: string[] = [];
    try {
      for (let i = 0; i < ids.length; i += step.batch) {
        setLog([...lines, `${step.busy} ${Math.min(i + step.batch, ids.length)} of ${ids.length}…`]);
        const r = await fetch("/api/bill-clone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendorId, ym, action: step.action, docIds: ids.slice(i, i + step.batch) }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (j.previewed) throw new Error("Writes are off on this deploy. Nothing changed.");
        for (const o of j.results ?? []) {
          if (!o.ok) {
            const p = data.pairs.find((x) => x.original.id === o.docId);
            lines.push(`${p?.original.externalId || o.docId}: ${o.reason}`);
          }
        }
      }
      setLog(lines.length ? lines : [`${step.label.slice(3)}: done.`]);
    } catch (e) {
      setLog([...lines, e instanceof Error ? e.message : "Failed"]);
    } finally {
      setBusy("");
      load();
    }
  }

  // A draft copy on the wrong job: void it and copy the original again, on the
  // original's job with its coding.
  async function reclone(p: ClonePair) {
    if (!p.clone) return;
    const ok = window.confirm(
      `Move the copy of ${p.original.externalId} from ${p.clone.jobName} to ${p.original.jobName}?\n\n` +
        "The wrong copy is voided, and a new copy is made from the Expense on its own job.",
    );
    if (!ok) return;
    setBusy("reclone");
    setLog([`Moving ${p.original.externalId} to ${p.original.jobName}…`]);
    try {
      const r = await fetch("/api/bill-clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId, ym, action: "reclone", docIds: [p.original.id] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (j.previewed) throw new Error("Writes are off on this deploy. Nothing changed.");
      const o = j.results?.[0];
      setLog([o?.ok ? `${p.original.externalId}: moved to ${p.original.jobName}.` : `${p.original.externalId}: ${o?.reason ?? "failed"}`]);
    } catch (e) {
      setLog([e instanceof Error ? e.message : "Failed"]);
    } finally {
      setBusy("");
      load();
    }
  }

  const st = data?.statement;
  const totalOrig = (data?.pairs ?? []).reduce((s, p) => s + p.original.cost, 0);
  const totalClone = (data?.pairs ?? []).reduce((s, p) => s + (p.clone?.cost ?? 0), 0);
  const missing = (data?.pairs ?? []).filter((p) => !p.clone).length;
  const diffs = (data?.pairs ?? []).filter((p) => p.differences.length).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Bill Clones</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Re-file a vendor&apos;s month of Expenses as Bills. Run the four steps in order.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3">
        <label className="min-w-[14rem] flex-1 text-sm">
          <span className="mb-1 block text-xs text-neutral-500">Vendor</span>
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Choose a vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-44 text-sm">
          <span className="mb-1 block text-xs text-neutral-500">Month</span>
          <Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
        </label>
        <Button variant="secondary" onClick={load} disabled={loading || !!busy}>
          Refresh
        </Button>
      </Card>

      {data && (
        <div className="flex flex-wrap gap-2">
          {STEPS.map((s) => (
            <Button key={s.action} onClick={() => run(s)} disabled={!!busy || loading || !counts[s.stage]}>
              {busy === s.action ? `${s.busy}…` : `${s.label} (${counts[s.stage] ?? 0})`}
            </Button>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <Banner tone={log.some((l) => l.includes(":") && !l.endsWith("done.")) ? "warning" : "info"}>
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {loading && !data && <Loading />}

      {data && (
        <>
          <Card className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-neutral-500">Expenses</div>
              <div className="font-semibold tabular-nums">
                {data.pairs.length} · {money(totalOrig)}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Clones</div>
              <div className="font-semibold tabular-nums">
                {data.pairs.length - missing} · {money(totalClone)}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Extra clones</div>
              <div className={`font-semibold tabular-nums ${data.extraClones.length ? "text-danger" : ""}`}>
                {data.extraClones.length}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Differences</div>
              <div className={`font-semibold tabular-nums ${diffs ? "text-danger" : ""}`}>{diffs}</div>
            </div>
          </Card>

          {st && !st.ok && <Banner tone="warning">Statement check unavailable: {st.error}</Banner>}
          {st?.ok && (
            <Banner tone={st.unmatched?.length ? "warning" : "info"}>
              Checked against {st.lineCount} statement line(s) for this month.
              {st.unmatched?.length ? (
                <div className="mt-1">
                  On a statement but no clone:{" "}
                  {st.unmatched.map((l) => `${l.number} (${money(l.amount)})`).join(", ")}
                </div>
              ) : null}
            </Banner>
          )}

          <Card pad={false} className="overflow-x-auto">
            <table className={tableCls.root}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Date</th>
                  <th className={tableCls.th}>Job</th>
                  <th className={tableCls.th}>Expense</th>
                  <th className={tableCls.thNum}>Amount</th>
                  <th className={tableCls.th}>Clone</th>
                  <th className={tableCls.thNum}>Amount</th>
                  <th className={tableCls.th}>Check</th>
                </tr>
              </thead>
              <tbody>
                {data.pairs.map((p) => {
                  const v = p.clone ? st?.byCloneId?.[p.clone.id] : undefined;
                  return (
                    <tr key={p.original.id} className={tableCls.tr}>
                      <td className={`${tableCls.td} whitespace-nowrap`}>{p.original.issueDate}</td>
                      <td className={tableCls.td}>{p.original.jobName}</td>
                      <td className={tableCls.td}>
                        <DocCell d={p.original} />
                      </td>
                      <td className={tableCls.tdNum}>{money(p.original.cost)}</td>
                      <td className={tableCls.td}>{p.clone ? <DocCell d={p.clone} /> : <span className="text-neutral-400">—</span>}</td>
                      <td className={tableCls.tdNum}>{p.clone ? money(p.clone.cost) : ""}</td>
                      <td className={`${tableCls.td} space-y-1`}>
                        <Chip tone={STAGE_TONE[p.stage]}>{p.stage}</Chip>
                        {p.differences.length > 0 && (
                          <div className="text-xs text-danger">Differs: {p.differences.join(", ")}</div>
                        )}
                        {canReclone(p) && (
                          <Button size="xs" variant="secondary" disabled={!!busy} onClick={() => reclone(p)}>
                            Move to {p.original.jobName}
                          </Button>
                        )}
                        {v && (
                          <div>
                            <Chip
                              tone={VERDICT_TONE[v.verdict]}
                              title={v.statementAmount != null ? `Statement: ${money(v.statementAmount)}` : undefined}
                            >
                              {v.verdict}
                            </Chip>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {data.pairs.length === 0 && (
                  <tr>
                    <td className={tableCls.td} colSpan={7}>
                      No Expenses for this vendor in this month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          {data.extraClones.length > 0 && (
            <Card>
              <div className="mb-2 text-sm font-semibold text-danger">Clones with no matching Expense</div>
              {data.extraClones.map((d) => (
                <div key={d.id} className="flex justify-between gap-3 py-1 text-sm">
                  <DocCell d={d} />
                  <span className="tabular-nums">{money(d.cost)}</span>
                </div>
              ))}
            </Card>
          )}

          {data.skipped.length > 0 && (
            <Card>
              <div className="mb-2 text-sm font-semibold">Left alone (credits, statement bills, Bills)</div>
              {data.skipped.map((d) => (
                <div key={d.id} className="flex justify-between gap-3 py-1 text-sm">
                  <DocCell d={d} />
                  <span className="tabular-nums">{money(d.cost)}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
