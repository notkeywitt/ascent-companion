"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JtLink } from "@/components/JtLink";

interface Line {
  id: string;
  name?: string;
  cost?: number;
  quantity?: number;
  unitCost?: number;
  costCode?: { number?: string; name?: string } | null;
  jobCostItem?: { id?: string } | null;
}
interface Header {
  id: string;
  name?: string;
  subject?: string;
  fromName?: string;
  number?: string;
  externalId?: string;
  status?: string;
  cost?: number;
  issueDate?: string;
  qboIsIgnored?: boolean;
}
interface FileNode {
  id: string;
  name?: string;
  type?: string;
  url?: string;
}

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const isImage = (f: FileNode) =>
  /^image\//i.test(f.type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");

// Billing-month options (current + prior 14 months). Value = last day of the
// month (the issueDate convention); ym is the year-month key for matching.
function billingMonthOptions() {
  const opts: { value: string; ym: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const last = new Date(y, m, 0).getDate();
    opts.push({
      value: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
      ym: `${y}-${String(m).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return opts;
}

// In the side panel, ask the extension to open a bill in the docked JobTread
// window (no-op on mobile / standalone).
function driveMainWindowToDoc(jobId: string, docId: string) {
  try {
    if (typeof window !== "undefined" && window.top !== window.self && jobId) {
      window.parent.postMessage(
        { type: "ascentOpenJtDoc", href: `https://app.jobtread.com/jobs/${jobId}/documents/${docId}` },
        "*",
      );
    }
  } catch {
    /* unframed — ignore */
  }
}

function BillDetail() {
  const params = useParams<{ docId: string }>();
  const search = useSearchParams();
  const docId = params.docId;
  const jobId = search.get("jobId") ?? "";

  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [budget, setBudget] = useState<Option[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, { quantity?: string; unitCost?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [writes, setWrites] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/bill?docId=${encodeURIComponent(docId)}&jobId=${encodeURIComponent(jobId)}`,
        );
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) setError(json.error ?? "Request failed");
        else {
          setHeader(json.header ?? null);
          setLines(json.lines ?? []);
          setBudget(json.budget ?? []);
          setFiles(json.files ?? []);
          setWrites(Boolean(json.writesEnabled));
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [docId, jobId]);

  // Coding-queue order for this job, so we can step ‹ prev / next › between bills.
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    fetch(`/api/coding-queue?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (alive) setQueue((j.bills ?? []).map((b: { id: string }) => b.id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [jobId]);

  const qIdx = queue.indexOf(docId);
  const prevId = qIdx > 0 ? queue[qIdx - 1] : null;
  const nextId = qIdx >= 0 && qIdx < queue.length - 1 ? queue[qIdx + 1] : null;

  const total = lines?.reduce((s, l) => s + (l.cost ?? 0), 0) ?? 0;
  const invId = header?.externalId || header?.number || "";
  const vendor = header?.fromName || header?.subject || header?.name || "Vendor bill";
  const title = invId ? `${vendor} · ${invId}` : vendor;
  const subtitle = header?.subject && header.subject !== vendor ? header.subject : "";

  // Lines with a changed cost code, quantity, or unit cost vs what's in JobTread.
  const pending = (lines ?? []).flatMap((l) => {
    const change: {
      costItemId: string;
      jobCostItemId?: string;
      quantity?: number;
      unitCost?: number;
      description?: string;
    } = { costItemId: l.id };
    let changed = false;

    const sel = picked[l.id];
    if (sel !== undefined && sel !== (l.jobCostItem?.id ?? "")) {
      change.jobCostItemId = sel;
      // Mirror the coding into the line's description = "number - name" of the
      // cost code. Empty when uncoding.
      const opt = budget.find((o) => o.id === sel);
      change.description = opt ? (opt.name ? `${opt.number} - ${opt.name}` : opt.number) : "";
      changed = true;
    }
    const qStr = edits[l.id]?.quantity;
    if (qStr !== undefined && qStr !== "" && Number(qStr) !== (l.quantity ?? 0)) {
      change.quantity = Number(qStr);
      changed = true;
    }
    const uStr = edits[l.id]?.unitCost;
    if (uStr !== undefined && uStr !== "" && Number(uStr) !== (l.unitCost ?? 0)) {
      change.unitCost = Number(uStr);
      changed = true;
    }
    return changed ? [change] : [];
  });

  // Optimistically patch a bill header flag (name = Bill/Expense, qboIsIgnored =
  // Push-to-QB) and persist via /api/bill-fields.
  async function patchBill(fields: { name?: string; qboIsIgnored?: boolean }) {
    setHeader((h) => (h ? { ...h, ...fields } : h)); // optimistic
    try {
      const res = await fetch("/api/bill-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, ...fields }),
      });
      const j = await res.json().catch(() => ({}));
      // Reconcile with what actually persisted so the toggle can't drift.
      const applied: { name?: string; qboIsIgnored?: boolean } = {};
      if (typeof j.name === "string") applied.name = j.name;
      if (typeof j.qboIsIgnored === "boolean") applied.qboIsIgnored = j.qboIsIgnored;
      if (Object.keys(applied).length) setHeader((h) => (h ? { ...h, ...applied } : h));
    } catch {
      /* optimistic; a reload reflects the true state */
    }
  }

  const isExpense = (header?.name ?? "Bill") === "Expense";
  const pushToQb = header?.qboIsIgnored === false;
  const [approving, setApproving] = useState(false);

  // A Bill is "approved for payment" (payable) = JobTread status `pending`.
  // An Expense is already paid, so "record payment" = status `approved` (paid).
  async function approveBill() {
    const target = isExpense ? "approved" : "pending";
    setApproving(true);
    const prev = header?.status;
    setHeader((h) => (h ? { ...h, status: target } : h));
    try {
      const res = await fetch("/api/bill-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, status: target }),
      });
      const j = await res.json();
      if (!res.ok) {
        setHeader((h) => (h ? { ...h, status: prev } : h)); // revert on failure
        setSaveMsg(j.error ?? "Failed");
      }
    } catch {
      setHeader((h) => (h ? { ...h, status: prev } : h));
      setSaveMsg("Network error");
    } finally {
      setApproving(false);
    }
  }

  async function saveCoding() {
    if (pending.length === 0) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: pending }),
      });
      const json = await res.json();
      if (!res.ok) setSaveMsg(json.error ?? "Save failed");
      else if (json.previewed)
        setSaveMsg(
          `Preview only — writes are OFF. ${pending.length} line(s) would be updated in JobTread.`,
        );
      else {
        const results = (json.results ?? []) as { costItemId: string; ok: boolean }[];
        const okIds = new Set(results.filter((r) => r.ok).map((r) => r.costItemId));
        const ok = okIds.size;
        const bad = results.length - ok;
        // Reflect the saved coding so it stops showing as an unsaved change.
        const applied = new Map(pending.map((c) => [c.costItemId, c]));
        setLines((prev) =>
          prev?.map((l) => {
            const c = applied.get(l.id);
            if (!c || !okIds.has(l.id)) return l;
            const quantity = c.quantity ?? l.quantity;
            const unitCost = c.unitCost ?? l.unitCost;
            return {
              ...l,
              jobCostItem: c.jobCostItemId !== undefined ? { id: c.jobCostItemId } : l.jobCostItem,
              quantity,
              unitCost,
              cost: quantity != null && unitCost != null ? quantity * unitCost : l.cost,
            };
          }) ?? prev,
        );
        setPicked((p) => {
          const n = { ...p };
          okIds.forEach((id) => delete n[id]);
          return n;
        });
        setEdits((e) => {
          const n = { ...e };
          okIds.forEach((id) => delete n[id]);
          return n;
        });
        setSaveMsg(`Saved ${ok} line(s)${bad ? `, ${bad} failed` : ""}.`);
      }
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <div className="flex items-center justify-between">
        <Link href={`/?jobId=${encodeURIComponent(jobId)}`} className="text-sm font-semibold text-accent">
          ‹ Coding queue
        </Link>
        {qIdx >= 0 && queue.length > 1 && (
          <div className="flex items-center gap-1 text-sm">
            {prevId ? (
              <Link
                href={`/bill/${prevId}?jobId=${encodeURIComponent(jobId)}`}
                onClick={() => driveMainWindowToDoc(jobId, prevId)}
                aria-label="Previous bill"
                className="rounded-md px-2 py-1 font-semibold text-accent hover:bg-accent/10"
              >
                ‹
              </Link>
            ) : (
              <span className="px-2 py-1 text-neutral-300 dark:text-neutral-700">‹</span>
            )}
            <span className="tabular-nums text-xs text-neutral-500">
              {qIdx + 1} / {queue.length}
            </span>
            {nextId ? (
              <Link
                href={`/bill/${nextId}?jobId=${encodeURIComponent(jobId)}`}
                onClick={() => driveMainWindowToDoc(jobId, nextId)}
                aria-label="Next bill"
                className="rounded-md px-2 py-1 font-semibold text-accent hover:bg-accent/10"
              >
                ›
              </Link>
            ) : (
              <span className="px-2 py-1 text-neutral-300 dark:text-neutral-700">›</span>
            )}
          </div>
        )}
      </div>

      <header className="mb-4 mt-2">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
        <p className="mt-1 font-mono text-xs text-neutral-500">
          {header?.issueDate ? header.issueDate + " · " : ""}
          {docId}
        </p>
        {jobId && (
          <JtLink
            href={`https://app.jobtread.com/jobs/${jobId}/documents/${docId}`}
            className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent"
          >
            Open in JobTread ↗
          </JtLink>
        )}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-neutral-400">Billing month</span>
          <select
            value={
              billingMonthOptions().find((o) => o.ym === (header?.issueDate ?? "").slice(0, 7))?.value ??
              ""
            }
            onChange={async (e) => {
              const issueDate = e.target.value;
              if (!issueDate) return;
              setHeader((h) => (h ? { ...h, issueDate } : h));
              await fetch("/api/bill-issuedate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ docId, issueDate }),
              });
            }}
            className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
          >
            <option value="">— set billing month —</option>
            {billingMonthOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-neutral-400">Type</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
              {(["Bill", "Expense"] as const).map((t) => {
                const on = (isExpense ? "Expense" : "Bill") === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => patchBill({ name: t })}
                    className={
                      "px-3 py-1 text-sm " +
                      (on
                        ? "bg-accent font-semibold text-white"
                        : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")
                    }
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-neutral-400">Push to QB</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
              {([["Yes", false], ["No", true]] as const).map(([lbl, ignored]) => {
                const on = pushToQb === (lbl === "Yes");
                return (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => patchBill({ qboIsIgnored: ignored })}
                    className={
                      "px-3 py-1 text-sm " +
                      (on
                        ? "bg-accent font-semibold text-white"
                        : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")
                    }
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4">
          {header?.status === "approved" ? (
            <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✓ Payment recorded
            </div>
          ) : header?.status === "pending" ? (
            <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✓ Approved for payment
            </div>
          ) : (
            <button
              onClick={approveBill}
              disabled={approving || !header}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {approving ? "Saving…" : isExpense ? "Record payment" : "Approve for payment"}
            </button>
          )}
        </div>
      </header>

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {lines && (
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium">
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </span>
            <span className="font-mono text-sm font-semibold">{money(total)}</span>
          </div>

          <ul className="space-y-2">
            {lines.map((l) => {
              const current = picked[l.id] ?? l.jobCostItem?.id ?? "";
              const qtyVal = edits[l.id]?.quantity ?? (l.quantity != null ? String(l.quantity) : "");
              const unitVal =
                edits[l.id]?.unitCost ?? (l.unitCost != null ? String(l.unitCost) : "");
              const extended =
                qtyVal !== "" && unitVal !== ""
                  ? Number(qtyVal) * Number(unitVal)
                  : (l.cost ?? 0);
              const inputCls =
                "rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-neutral-700";
              return (
                <li
                  key={l.id}
                  className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 font-medium">{l.name || "Line item"}</div>
                    <div className="font-mono text-sm font-semibold">{money(extended)}</div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <label className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-neutral-400">Qty</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={qtyVal}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [l.id]: { ...p[l.id], quantity: e.target.value } }))
                        }
                        className={inputCls + " w-20"}
                      />
                    </label>
                    <span className="text-neutral-400">×</span>
                    <label className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-neutral-400">Unit $</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={unitVal}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [l.id]: { ...p[l.id], unitCost: e.target.value } }))
                        }
                        className={inputCls + " w-24"}
                      />
                    </label>
                  </div>

                  <div className="mt-2">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                      Cost code
                    </span>
                    <CostCodeSelect
                      options={budget}
                      value={current}
                      onChange={(id) => setPicked((p) => ({ ...p, [l.id]: id }))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 space-y-2">
            <button
              type="button"
              onClick={saveCoding}
              disabled={saving || pending.length === 0}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {saving
                ? "Saving…"
                : pending.length
                  ? `Save changes (${pending.length})`
                  : "No changes to save"}
            </button>
            {saveMsg && (
              <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
                {saveMsg}
              </p>
            )}
            {!writes ? (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                Writes are OFF (COMPANION_WRITES_ENABLED not <span className="font-mono">true</span> on
                this deploy). Save/approve show a preview and send nothing to JobTread. Set it in
                Vercel and <b>redeploy</b>.
              </p>
            ) : (
              <p className="rounded-lg bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                Writes are ON — Save/approve go straight to JobTread.
              </p>
            )}
          </div>
        </>
      )}

      {/* Attached invoice image / PDF — at the bottom */}
      {files.length > 0 && (
        <div className="mt-6 space-y-2">
          {files.map((f) =>
            f.url && isImage(f) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
                <img
                  src={f.url}
                  alt={f.name ?? "invoice"}
                  className="max-h-[28rem] w-full rounded-lg border border-neutral-200 object-contain dark:border-neutral-800"
                />
              </a>
            ) : f.url ? (
              <div key={f.id}>
                <iframe
                  src={f.url}
                  title={f.name ?? "invoice"}
                  className="h-[28rem] w-full rounded-lg border border-neutral-200 dark:border-neutral-800"
                />
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs font-semibold text-accent"
                >
                  Open {f.name || "attachment"} ↗
                </a>
              </div>
            ) : (
              <span key={f.id} className="text-sm text-neutral-500">
                {f.name}
              </span>
            ),
          )}
        </div>
      )}
    </main>
  );
}

export default function BillPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <BillDetail />
    </Suspense>
  );
}
