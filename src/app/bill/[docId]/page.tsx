"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JtLink } from "@/components/JtLink";
import { JobPicker } from "@/components/JobPicker";
import { PageTitle } from "@/components/PageTitle";
import { BillStatusBadge } from "@/components/BillStatusBadge";

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

// Ask the extension to reload the docked JobTread tab so JobTread's page shows
// what the companion just wrote (its SPA doesn't live-update from API writes).
function reloadJtWindow() {
  try {
    if (typeof window !== "undefined" && window.top !== window.self) {
      window.parent.postMessage({ type: "ascentReloadJt" }, "*");
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
  const [ctc, setCtc] = useState<Record<string, { budget: number; actual: number; remaining: number }>>({});
  const [files, setFiles] = useState<FileNode[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, { quantity?: string; unitCost?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [writes, setWrites] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [reassignMsg, setReassignMsg] = useState("");
  const [bulkCode, setBulkCode] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [addingLine, setAddingLine] = useState(false);
  const [newLine, setNewLine] = useState({ name: "", quantity: "1", unitCost: "0", code: "" });
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [addLineMsg, setAddLineMsg] = useState("");

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
          setCtc(json.costToComplete ?? {});
          setFiles(json.files ?? []);
          setWrites(Boolean(json.writesEnabled));
          setReviewed(Boolean(json.reviewed));
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
  // Re-fetch on each bill (docId) so the queue only ever holds CURRENT draft
  // bills — ones you've already processed (payable/paid) drop out, so the nav
  // arrows skip them. The current bill is kept as an anchor even once it leaves
  // draft, so Next still works right after you approve it.
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    fetch(`/api/coding-queue?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const drafts: string[] = (j.bills ?? []).map((b: { id: string }) => b.id);
        setQueue(drafts.includes(docId) ? drafts : [docId, ...drafts]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [jobId, docId]);

  const qIdx = queue.indexOf(docId);
  const prevId = qIdx > 0 ? queue[qIdx - 1] : null;
  const nextId = qIdx >= 0 && qIdx < queue.length - 1 ? queue[qIdx + 1] : null;

  const total = lines?.reduce((s, l) => s + (l.cost ?? 0), 0) ?? 0;
  const invId = header?.externalId || header?.number || "";
  const vendor = header?.fromName || header?.subject || header?.name || "Vendor bill";
  // Sunset keeps "Vendor · Invoice ID"; every other vendor shows just its name.
  const isSunsetBill = /sunset/i.test(vendor);
  const title = isSunsetBill && invId ? `${vendor} · ${invId}` : vendor;

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
      // JobTread locks a cost item's description field once the bill is payable
      // (pending) or paid (approved) — updating it errors. So only mirror the
      // code into the description on DRAFT bills; on payable/paid we still
      // re-code, just without touching the description.
      if (header?.status === "draft") {
        const opt = budget.find((o) => o.id === sel);
        change.description = opt ? (opt.name ? `${opt.number} - ${opt.name}` : opt.number) : "";
      }
      changed = true;
    }
    // quantity and unitCost are locked by JobTread once the bill is payable/paid
    // (same as description) — only send them on DRAFT bills.
    if (header?.status === "draft") {
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
    }
    return changed ? [change] : [];
  });

  // Re-read the bill's header from JobTread (authoritative) without disturbing
  // in-progress line edits. Used after any header write so the toggles/status
  // reflect JT's true state — including fields JT changes on its own (e.g.
  // qboIsIgnored can flip when a bill is approved).
  async function reloadHeader() {
    try {
      const res = await fetch(
        `/api/bill?docId=${encodeURIComponent(docId)}&jobId=${encodeURIComponent(jobId)}`,
      );
      const json = await res.json();
      if (res.ok) {
        setHeader(json.header ?? null);
        setWrites(Boolean(json.writesEnabled));
        setReviewed(Boolean(json.reviewed));
      }
    } catch {
      /* keep optimistic state */
    }
  }

  // Optimistically patch a bill header flag (name = Bill/Expense, qboIsIgnored =
  // Push-to-QB), persist via /api/bill-fields, then re-read JT's truth.
  async function patchBill(fields: {
    name?: string;
    qboIsIgnored?: boolean;
    qboDocumentType?: string;
  }) {
    setHeader((h) => (h ? { ...h, ...fields } : h)); // optimistic
    try {
      await fetch("/api/bill-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, ...fields }),
      });
    } catch {
      /* optimistic; the reload below reflects the true state */
    }
    await reloadHeader();
    reloadJtWindow(); // refresh JobTread's view of the change
  }

  const isExpense = (header?.name ?? "Bill") === "Expense";
  const pushToQb = header?.qboIsIgnored === false;
  // JobTread locks quantity/unitCost/description once a bill leaves draft.
  const linesEditable = (header?.status ?? "draft") === "draft";
  const [approving, setApproving] = useState(false);

  // Full re-read of the bill (header + lines + budget/CTC) from JobTread.
  async function loadBill() {
    try {
      const res = await fetch(
        `/api/bill?docId=${encodeURIComponent(docId)}&jobId=${encodeURIComponent(jobId)}`,
      );
      const json = await res.json();
      if (res.ok) {
        setHeader(json.header ?? null);
        setLines(json.lines ?? []);
        setBudget(json.budget ?? []);
        setCtc(json.costToComplete ?? {});
        setFiles(json.files ?? []);
        setWrites(Boolean(json.writesEnabled));
        setReviewed(Boolean(json.reviewed));
      }
    } catch {
      /* keep current state */
    }
  }

  // Manual refresh — re-pull the bill from JobTread (its SPA doesn't push API
  // writes back to us, and the mirror runs on its own clock).
  async function refresh() {
    setRefreshing(true);
    setSaveMsg("");
    await loadBill();
    setRefreshing(false);
  }

  // A Bill is "approved for payment" (payable) = JobTread status `pending`.
  // An Expense is already paid, so "record payment" = status `approved` (paid).
  async function approveBill() {
    const target = isExpense ? "approved" : "pending";
    setApproving(true);
    setSaveMsg("");
    const prev = header?.status;
    setHeader((h) => (h ? { ...h, status: target } : h)); // optimistic
    try {
      // 1. While still draft (description editable — JT locks it once payable),
      //    persist coding and set each coded line's description to its code.
      const changes = (lines ?? []).flatMap((l) => {
        const current = picked[l.id] ?? l.jobCostItem?.id ?? "";
        if (!current) return [];
        const opt = budget.find((o) => o.id === current);
        const change: {
          costItemId: string;
          jobCostItemId?: string;
          quantity?: number;
          unitCost?: number;
          description?: string;
        } = { costItemId: l.id, jobCostItemId: current };
        if (opt) change.description = opt.name ? `${opt.number} - ${opt.name}` : opt.number;
        const q = edits[l.id]?.quantity;
        if (q !== undefined && q !== "") change.quantity = Number(q);
        const u = edits[l.id]?.unitCost;
        if (u !== undefined && u !== "") change.unitCost = Number(u);
        return [change];
      });
      if (changes.length) {
        await fetch("/api/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
        });
      }
      // 2. Approve (moves out of draft; description is now locked).
      const res = await fetch("/api/bill-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, status: target }),
      });
      const j = await res.json();
      if (!res.ok) {
        setHeader((h) => (h ? { ...h, status: prev } : h)); // revert on failure
        setSaveMsg(j.error ?? "Approve failed");
      } else {
        setPicked({});
        setEdits({});
      }
    } catch {
      setHeader((h) => (h ? { ...h, status: prev } : h));
      setSaveMsg("Network error");
    } finally {
      setApproving(false);
    }
    await loadBill(); // reflect saved codes/descriptions + new status
    reloadJtWindow(); // refresh JobTread's view
  }

  // Move this bill to a different JobTread job. JT can't move bills, so Apps
  // Script delete+recreates it on the new job (draft only) via its reassignment
  // guard, keeping the sheet + Drive in sync. The recreate yields a NEW docId, so
  // on success we leave for the new job's coding queue (this bill's URL is stale).
  async function reassignJob(targetJobId: string) {
    if (!targetJobId || targetJobId === jobId) return;
    if ((header?.status ?? "draft") !== "draft") {
      setReassignMsg("Only draft bills can be moved. Set it back to Draft in JobTread first.");
      return;
    }
    if (
      !window.confirm(
        "Move this bill to a different job?\n\nJobTread can't move bills, so it will be deleted and recreated on the new job. It stays a draft, keeps its PDF, and re-files in Drive.",
      )
    )
      return;
    setReassignMsg("Moving…");
    try {
      const res = await fetch("/api/reassign-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, jobId: targetJobId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setReassignMsg(json.error ?? "Reassign failed");
        return;
      }
      reloadJtWindow(); // refresh JobTread's view (old doc gone, new one created)
      // New docId on the new job — this page's docId is stale; go to the new queue.
      window.location.href = `/?jobId=${encodeURIComponent(targetJobId)}`;
    } catch (e) {
      setReassignMsg(e instanceof Error ? e.message : "Network error");
    }
  }

  // Toggle the companion-local "reviewed" flag. Not a JobTread write — just
  // records that the office marked this bill done — so it works with writes OFF.
  async function toggleReviewed() {
    const next = !reviewed;
    setReviewed(next); // optimistic
    setReviewLoading(true);
    try {
      const res = await fetch("/api/bill-reviewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, reviewed: next }),
      });
      if (!res.ok) setReviewed(!next); // revert on failure
    } catch {
      setReviewed(!next); // revert on error
    } finally {
      setReviewLoading(false);
    }
  }

  // Add a new line to this bill (createCostItem on the document). On success we
  // reload the bill so the new line appears exactly as JobTread stored it.
  async function addLine() {
    const name = newLine.name.trim();
    if (!name) return;
    setAddLineSaving(true);
    setAddLineMsg("");
    try {
      const opt = budget.find((o) => o.id === newLine.code);
      const description = opt ? (opt.name ? `${opt.number} - ${opt.name}` : opt.number) : "";
      const res = await fetch("/api/add-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          name,
          quantity: Number(newLine.quantity) || 0,
          unitCost: Number(newLine.unitCost) || 0,
          jobCostItemId: newLine.code || undefined,
          description,
        }),
      });
      const json = await res.json();
      if (!res.ok) setAddLineMsg(json.error ?? "Add failed");
      else if (json.previewed)
        setAddLineMsg("Preview only — writes are OFF. Nothing was added to JobTread.");
      else {
        setAddingLine(false);
        setNewLine({ name: "", quantity: "1", unitCost: "0", code: "" });
        await loadBill(); // pull the new line from JobTread
        reloadJtWindow();
      }
    } catch (e) {
      setAddLineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setAddLineSaving(false);
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
        body: JSON.stringify({ changes: pending, docId }),
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
        if (ok) reloadJtWindow(); // refresh JobTread's view of the codes
      }
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  // Stage one cost code onto every line (into `picked`, so it flows through the
  // same pending/Save-changes path as per-line edits). Re-coding is allowed in
  // any status — only qty/unit/description are locked once a bill leaves draft —
  // so this works on payable/paid bills too. Nothing is written until Save.
  function applyCodeToAll(id: string) {
    if (!id || !lines) return;
    setPicked((p) => {
      const n = { ...p };
      for (const l of lines) n[l.id] = id;
      return n;
    });
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/?jobId=${encodeURIComponent(jobId)}`} className="text-sm font-semibold text-accent">
          ‹ Coding queue
        </Link>
        <div className="flex items-center gap-2 text-sm">
          {qIdx >= 0 && queue.length > 1 && (
            <>
            {prevId ? (
              <Link
                href={`/bill/${prevId}?jobId=${encodeURIComponent(jobId)}`}
                onClick={() => driveMainWindowToDoc(jobId, prevId)}
                aria-label="Previous bill"
                className="inline-flex items-center gap-1 rounded-lg border border-accent px-3 py-1.5 font-semibold text-accent hover:bg-accent/10"
              >
                ‹ Prev
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 font-semibold text-neutral-300 dark:border-neutral-800 dark:text-neutral-700">
                ‹ Prev
              </span>
            )}
            <span className="tabular-nums text-xs font-semibold text-neutral-500">
              {qIdx + 1} / {queue.length}
            </span>
            {nextId ? (
              <Link
                href={`/bill/${nextId}?jobId=${encodeURIComponent(jobId)}`}
                onClick={() => driveMainWindowToDoc(jobId, nextId)}
                aria-label="Next bill"
                className="inline-flex items-center gap-1 rounded-lg border border-accent px-3 py-1.5 font-semibold text-accent hover:bg-accent/10"
              >
                Next ›
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 font-semibold text-neutral-300 dark:border-neutral-800 dark:text-neutral-700">
                Next ›
              </span>
            )}
            </>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            title="Refresh from JobTread"
            aria-label="Refresh"
            className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-1.5 font-semibold text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {refreshing ? "Refreshing…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      <header className="mb-4 mt-2">
        <PageTitle>{title}</PageTitle>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {header?.status && <BillStatusBadge status={header.status} />}
          <p className="font-mono text-xs text-neutral-500">
            {header?.issueDate ? header.issueDate + " · " : ""}
            {docId}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {jobId && (
            <JtLink
              href={`https://app.jobtread.com/jobs/${jobId}/documents/${docId}`}
              className="inline-flex items-center gap-1 rounded-xl border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/10"
            >
              Open in JobTread ↗
            </JtLink>
          )}
          {header && (
            <button
              type="button"
              onClick={saveCoding}
              disabled={saving || pending.length === 0}
              className="inline-flex items-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {saving
                ? "Saving…"
                : pending.length
                  ? `Save changes (${pending.length})`
                  : "No changes to save"}
            </button>
          )}
          {header && (
            <button
              type="button"
              onClick={toggleReviewed}
              disabled={reviewLoading}
              title={reviewed ? "Marked reviewed — click to unmark" : "Mark this bill reviewed"}
              className={
                "inline-flex items-center gap-1 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50 " +
                (reviewed
                  ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                  : "border-accent text-accent hover:bg-accent/10")
              }
            >
              {reviewed ? "✓ Reviewed" : "Mark reviewed"}
            </button>
          )}
        </div>
        {saveMsg && (
          <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
            {saveMsg}
          </p>
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

        {/* Move this bill to a different job (draft only). JT can't move bills, so
            this delete+recreates it on the chosen job. Writes-off deploys hide it,
            matching the rest of the page. */}
        {writes && (header?.status ?? "draft") === "draft" && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">
                Move to job
              </span>
              <JobPicker value={jobId} onChange={reassignJob} />
            </div>
            {reassignMsg && (
              <p className="mt-1 rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
                {reassignMsg}
              </p>
            )}
          </div>
        )}

        {/* Type (Bill/Expense) and Push-to-QB toggles hidden 2026-07-18 per request.
            Kept commented (with their patchBill/isExpense/pushToQb handlers) for easy restore. */}
        {/*
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
        */}

        {/* Approve-for-payment / Record-payment action hidden 2026-07-18 per request.
            Status is still shown via the BillStatusBadge above. approveBill kept for restore. */}
        {/*
        <div className="mt-4">
          {header?.status === "approved" ? (
            <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✓ Payment recorded
            </div>
          ) : header?.status === "pending" ? (
            <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✓ Approved for payment
            </div>
          ) : header?.status === "denied" ? (
            <div className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
              ✕ Denied
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
        */}
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

          {!linesEditable && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Qty &amp; unit cost are locked once a bill is payable/paid — you can still re-code it.
              To edit amounts, set the bill back to Draft in JobTread.
            </p>
          )}

          {budget.length > 0 && lines.length > 1 && (
            <div className="mb-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900/50">
              <span className="mb-1.5 block text-[10px] uppercase tracking-wide text-neutral-400">
                Apply one code to all {lines.length} lines
              </span>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <CostCodeSelect options={budget} value={bulkCode} onChange={setBulkCode} />
                </div>
                <button
                  type="button"
                  onClick={() => applyCodeToAll(bulkCode)}
                  disabled={!bulkCode}
                  className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  Apply to all
                </button>
              </div>
            </div>
          )}

          {!writes && (
            <div className="mb-3">
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                Writes are OFF (COMPANION_WRITES_ENABLED not <span className="font-mono">true</span> on
                this deploy). Save shows a preview and sends nothing to JobTread. Set it in Vercel and{" "}
                <b>redeploy</b>.
              </p>
            </div>
          )}

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
                "rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm tabular-nums disabled:opacity-50 disabled:cursor-not-allowed dark:border-neutral-700";
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
                        disabled={!linesEditable}
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
                        disabled={!linesEditable}
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
                    {(() => {
                      const codeNum = budget.find((o) => o.id === current)?.number;
                      const c = codeNum ? ctc[codeNum] : undefined;
                      if (!c) return null;
                      return (
                        <div className="mt-1 text-[11px]">
                          <span className="text-neutral-500">Cost to complete: </span>
                          <span
                            className={
                              "font-mono font-semibold " +
                              (c.remaining < 0 ? "text-red-600 dark:text-red-400" : "")
                            }
                          >
                            {money(c.remaining)}
                          </span>
                          <span className="text-neutral-400">
                            {" "}
                            (budget {money(c.budget)} − actual {money(c.actual)})
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Add a new line (createCostItem). Draft-only — JobTread locks a
              bill's amounts once it's payable/paid. */}
          {linesEditable && (
            <div className="mt-3">
              {!addingLine ? (
                <button
                  type="button"
                  onClick={() => {
                    setAddLineMsg("");
                    setAddingLine(true);
                  }}
                  className="w-full rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm font-semibold text-accent hover:border-accent hover:bg-accent/5 dark:border-neutral-700"
                >
                  + Add line
                </button>
              ) : (
                <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                  <input
                    type="text"
                    value={newLine.name}
                    onChange={(e) => setNewLine((n) => ({ ...n, name: e.target.value }))}
                    placeholder="Line description"
                    className="w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <label className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-neutral-400">Qty</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={newLine.quantity}
                        onChange={(e) => setNewLine((n) => ({ ...n, quantity: e.target.value }))}
                        className="w-20 rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-neutral-700"
                      />
                    </label>
                    <span className="text-neutral-400">×</span>
                    <label className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-neutral-400">Unit $</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={newLine.unitCost}
                        onChange={(e) => setNewLine((n) => ({ ...n, unitCost: e.target.value }))}
                        className="w-24 rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-neutral-700"
                      />
                    </label>
                  </div>
                  <div className="mt-2">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                      Cost code
                    </span>
                    <CostCodeSelect
                      options={budget}
                      value={newLine.code}
                      onChange={(id) => setNewLine((n) => ({ ...n, code: id }))}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={addLine}
                      disabled={addLineSaving || !newLine.name.trim()}
                      className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
                    >
                      {addLineSaving ? "Adding…" : "Add line"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingLine(false);
                        setAddLineMsg("");
                      }}
                      className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {addLineMsg && (
                <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
                  {addLineMsg}
                </p>
              )}
            </div>
          )}
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
