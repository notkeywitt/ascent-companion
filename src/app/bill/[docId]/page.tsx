"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JtLink } from "@/components/JtLink";
import { JobPicker } from "@/components/JobPicker";
import { PageTitle } from "@/components/PageTitle";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import {
  Banner,
  Button,
  Card,
  IconButton,
  Label,
  Loading,
  SectionLabel,
  Select,
  Spinner,
  btn,
} from "@/components/ui";
import { TrackingSheetSyncFor } from "@/components/TrackingSheetSync";
import { billLineMath, recodeLog } from "@/lib/billLineMath";
import { markBillTouched } from "@/lib/billTouch";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

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
  nonRecoverableTax?: number; // recorded sales tax (document-level, "Tax")
  nonRecoverableTaxName?: string;
}
interface FileNode {
  id: string;
  name?: string;
  type?: string;
  url?: string;
}

/** Everything /api/bill returns — the whole bill view in one payload. */
interface BillPayload {
  header?: Header | null;
  lines?: Line[];
  budget?: Option[];
  costToComplete?: Record<string, { budget: number; actual: number; remaining: number }>;
  files?: FileNode[];
  writesEnabled?: boolean;
  reviewed?: boolean;
  saved?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// BILL PAYLOAD CACHE
// Coding is a queue: the bill you open next is almost always the one ‹ prev /
// next › points at. So keep recent payloads here and fetch the neighbours in the
// background while you read the current bill — stepping through the queue then
// costs a state update instead of a round trip. Entries are short-lived, and a
// cache hit still revalidates behind the scenes, so a stale read (someone edited
// the bill in JobTread meanwhile) corrects itself a few hundred ms after landing.
// Module scope, so it survives navigation between bills but not a page reload.
// ---------------------------------------------------------------------------
const BILL_CACHE_TTL_MS = 30_000;
const billCache = new Map<string, { at: number; payload: BillPayload }>();
const billCacheKey = (docId: string, jobId: string) => `${docId}|${jobId}`;

async function fetchBillPayload(docId: string, jobId: string): Promise<BillPayload> {
  const res = await fetch(
    `/api/bill?docId=${encodeURIComponent(docId)}&jobId=${encodeURIComponent(jobId)}`,
  );
  const json = (await res.json()) as BillPayload;
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  billCache.set(billCacheKey(docId, jobId), { at: Date.now(), payload: json });
  return json;
}

function cachedBillPayload(docId: string, jobId: string): BillPayload | null {
  const key = billCacheKey(docId, jobId);
  const hit = billCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > BILL_CACHE_TTL_MS) {
    billCache.delete(key);
    return null;
  }
  return hit.payload;
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
// what the assistant just wrote (its SPA doesn't live-update from API writes).
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
  // Where Back returns to. Pages that deep-link here say so with ?from=… — the
  // three Client Invoicing surfaces (`recode` the workbench, `invoicing` the
  // all-jobs month roster, `drafts` the needs-coding queue) and the Sunset
  // Statements page (`payments`). `stage` is the retired Invoicing page, still
  // reachable by URL; anything unrecognised falls back to the workbench.
  const from = search.get("from");
  // Client Invoicing carries its billing month through so Back lands on the same
  // month; the `#bill-<id>` anchor is the bill you tapped, so you return to your
  // exact spot in that list.
  const ym = search.get("ym") ?? "";
  const ymQs = ym ? `&ym=${encodeURIComponent(ym)}` : "";
  const backHref =
    from === "stage"
      ? `/stage?jobId=${encodeURIComponent(jobId)}`
      : from === "invoicing"
        ? // The roster re-opens the card you left from (?open=), the month-list
          // equivalent of the workbench's #bill-<id> anchor.
          `/recode?open=${encodeURIComponent(jobId)}${ymQs}`
        : from === "drafts"
          ? "/recode?tab=drafts"
          : from === "payments"
            ? "/payments"
            : `/recode?jobId=${encodeURIComponent(jobId)}${ymQs}#bill-${docId}`;
  const backLabel =
    from === "stage"
      ? "‹ Invoicing"
      : from === "drafts"
        ? "‹ Needs coding"
        : from === "payments"
          ? "‹ Sunset statements"
          : "‹ Client Invoicing";
  // Stepping ‹ prev / next › between bills must keep the SAME Back destination —
  // otherwise the neighbour loses ?from/?ym and Back falls back to the coding
  // queue. Carry both through every bill link.
  const navContext =
    `${from ? `&from=${encodeURIComponent(from)}` : ""}` +
    `${ym ? `&ym=${encodeURIComponent(ym)}` : ""}`;

  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [budget, setBudget] = useState<Option[]>([]);
  const [ctc, setCtc] = useState<Record<string, { budget: number; actual: number; remaining: number }>>({});
  const [files, setFiles] = useState<FileNode[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<
    Record<string, { name?: string; quantity?: string; unitCost?: string }>
  >({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [writes, setWrites] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [reassignMsg, setReassignMsg] = useState("");
  const [bulkCode, setBulkCode] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [saved, setSaved] = useState(false); // Save has been clicked on this bill (assistant-local)
  const [reviewLoading, setReviewLoading] = useState(false);
  const [addingLine, setAddingLine] = useState(false);
  const [newLine, setNewLine] = useState({ name: "", quantity: "1", unitCost: "0", code: "" });
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [addLineMsg, setAddLineMsg] = useState("");
  const [selected, setSelected] = useState<string[]>([]); // line ids checked to combine
  const [combining, setCombining] = useState(false);
  const [combineMsg, setCombineMsg] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [buybackId, setBuybackId] = useState("");
  const [taxEdit, setTaxEdit] = useState<string | null>(null); // null = not editing (shows JT's value)
  // Bottom drawer holding the bill's secondary actions (open in JobTread, mark
  // reviewed, tracking-sheet sync). Collapsed by default so the save row and
  // the bill itself keep the screen; the panel is hidden, not unmounted.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bumped whenever the cache is dropped, so the prefetch effect re-warms the
  // neighbours after a write instead of leaving them cold until you navigate.
  const [cacheEpoch, setCacheEpoch] = useState(0);
  // Whether the user has started editing THIS bill. A background revalidation
  // must never overwrite line edits in progress, and this is the same signal the
  // sticky Save bar counts (assigned below, once `changeCount` exists).
  const dirtyRef = useRef(false);

  /** Drop every cached payload — any write can move the job's budget/CTC numbers. */
  function invalidateBills() {
    billCache.clear();
    setCacheEpoch((n) => n + 1);
    // Every write path here funnels through this, so it is also where the pages
    // that cache a LIST of bills (e.g. /payments) learn their snapshot is stale.
    markBillTouched(docId);
  }

  function applyBill(json: BillPayload) {
    setHeader(json.header ?? null);
    setLines(json.lines ?? []);
    setBudget(json.budget ?? []);
    setCtc(json.costToComplete ?? {});
    setFiles(json.files ?? []);
    setWrites(Boolean(json.writesEnabled));
    setReviewed(Boolean(json.reviewed));
    setSaved(Boolean(json.saved));
  }

  useEffect(() => {
    let alive = true;
    // A prefetched neighbour renders immediately; anything else shows the spinner.
    const cached = cachedBillPayload(docId, jobId);
    setError("");
    setSelected([]);
    setTaxEdit(null);
    // Edits belong to the bill they were typed on — arriving at a different one
    // starts clean (and keeps `dirtyRef` honest for the revalidation below).
    setPicked({});
    setEdits({});
    if (cached) applyBill(cached);
    setLoading(!cached);
    (async () => {
      try {
        const json = await fetchBillPayload(docId, jobId);
        if (!alive) return;
        // Revalidating what's already on screen: leave it alone once the user has
        // started editing, rather than resetting their work under them.
        if (cached && dirtyRef.current) return;
        applyBill(json);
      } catch (e) {
        // A failed revalidation keeps the (still usable) cached view; only a load
        // with nothing to show is an error.
        if (alive && !cached) setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Warm ‹ prev / next › in the background once this bill is on screen, so the
  // arrows render from cache instead of waiting on JobTread. Held until the
  // current load finishes so the prefetches never compete with it.
  useEffect(() => {
    if (loading || !jobId) return;
    for (const id of [nextId, prevId]) {
      if (!id || cachedBillPayload(id, jobId)) continue;
      fetchBillPayload(id, jobId).catch(() => {
        /* best-effort warm-up; navigating there will retry and surface any error */
      });
    }
  }, [prevId, nextId, jobId, loading, cacheEpoch]);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  // JobTread stores each line's cost tax-INCLUSIVE, and a bill's TOTAL is ALWAYS the sum of
  // the line costs; the fixed sales tax (`nonRecoverableTax`, a dollar) is carved OUT of that
  // total for the subtotal — no field adds tax on top of a vendor bill. Confirmed live
  // 2026-07-30 by capturing JobTread's own save (stored $59.54 → screen shows $54.95). So we
  // MIRROR JobTread: read each line DE-TAXED (what JobTread shows), let the office edit
  // pre-tax, and on Save gross EVERY line back up (see allLineChanges) so the stored costs
  // stay mutually consistent — editing one line, or the tax, shifts the shared subtotal/total
  // factor, so all lines must move together or the untouched ones appear to drift.
  const storedTax = header?.nonRecoverableTax ?? 0;
  const taxName = header?.nonRecoverableTaxName || "Tax";
  // While the office edits the Tax field, preview with the typed value.
  const taxView = taxEdit !== null && taxEdit !== "" ? Number(taxEdit) || 0 : storedTax;
  const taxChanged = taxEdit !== null && round2(taxView) !== round2(storedTax);
  const invId = header?.externalId || header?.number || "";
  const vendor = header?.fromName || header?.subject || header?.name || "Vendor bill";
  // Sunset keeps "Vendor \u00b7 Invoice ID"; every other vendor shows just its name.
  const isSunsetBill = /sunset/i.test(vendor);
  const title = isSunsetBill && invId ? `${vendor} \u00b7 ${invId}` : vendor;

  // The de-tax / pre-tax-edit / gross-up model lives in src/lib/billLineMath.ts,
  // shared with Client Invoicing (/recode) so the two pages can never disagree
  // about what a save writes. Read that file for the model itself.
  const {
    deTax,
    subtotal,
    total,
    reTax,
    pendingCount,
    wholeBillChanges: allLineChanges,
  } = billLineMath({
    lines: (lines ?? []).map((l) => ({ ...l, jobCostItemId: l.jobCostItem?.id ?? null })),
    storedTax,
    taxView,
    status: header?.status,
    edits,
    picked,
    budget,
  });

  // Edits made here but not yet pushed. Save stays enabled at zero (it re-sends the bill
  // regardless); this only drives the bar's label and the Discard button.
  const changeCount = pendingCount + (taxChanged ? 1 : 0);

  // Warn before leaving with unsaved edits (the same changes the sticky Save bar counts)
  // — covers refresh/close, in-app links, and Back/Forward.
  useUnsavedChanges(changeCount > 0);

  // Same signal, readable from the load effect's async callback (see dirtyRef).
  dirtyRef.current = changeCount > 0;

  // Re-read the bill's header from JobTread (authoritative) without disturbing
  // in-progress line edits. Used after any header write so the toggles/status
  // reflect JT's true state — including fields JT changes on its own (e.g.
  // qboIsIgnored can flip when a bill is approved).
  async function reloadHeader() {
    invalidateBills(); // the write that prompted this may have moved the job's numbers
    try {
      const json = await fetchBillPayload(docId, jobId);
      setHeader(json.header ?? null);
      setWrites(Boolean(json.writesEnabled));
      setReviewed(Boolean(json.reviewed));
      setSaved(Boolean(json.saved));
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
    invalidateBills(); // never serve a pre-write payload to this bill or its neighbours
    try {
      applyBill(await fetchBillPayload(docId, jobId));
    } catch {
      /* keep current state */
    }
  }

  // (A page-local Refresh button used to live here. It's gone — the app
  // header's reload remounts this page, and the load effect always revalidates
  // against JobTread, so the two did the same job.)

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
        const codingLog = recodeLog(
          (lines ?? []).map((l) => ({ id: l.id, name: l.name, jobCostItemId: l.jobCostItem?.id ?? null })),
          picked,
          budget,
        );
        await fetch("/api/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes, docId, codingLog }),
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
      // New docId on the new job — this page's docId is stale; open Client
      // Invoicing on the job the bill just moved to.
      window.location.href = `/recode?jobId=${encodeURIComponent(targetJobId)}`;
    } catch (e) {
      setReassignMsg(e instanceof Error ? e.message : "Network error");
    }
  }

  // Toggle the assistant-local "reviewed" flag. Not a JobTread write — just
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
      else invalidateBills(); // cached payload still carries the old flag
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
      // Unit $ is entered PRE-TAX (matching the line editor). On a taxed bill, gross it
      // up so JobTread displays the entered pre-tax; the tax rides on the new, larger
      // pre-tax base. On a tax-free bill this is a no-op (reTaxAdd === 1).
      const qty = Number(newLine.quantity) || 0;
      const preTaxUnit = Number(newLine.unitCost) || 0;
      const newSumPreTax = subtotal + preTaxUnit * qty;
      const reTaxAdd = newSumPreTax > 0 ? (newSumPreTax + taxView) / newSumPreTax : 1;
      const res = await fetch("/api/add-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          name,
          quantity: qty,
          unitCost: round2(preTaxUnit * reTaxAdd),
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
    // Save is always live, so it can land here with nothing edited — that still re-pushes
    // every line. Only a bill with no lines and no tax change has literally nothing to send.
    if (allLineChanges.length === 0 && !taxChanged) {
      setSaveMsg("Nothing to save.");
      return;
    }
    setSaving(true);
    setSaveMsg("");
    try {
      let failed = 0;
      // 1) Push every line (the whole bill) so the tax-inclusive line costs stay mutually
      //    consistent and JobTread's de-taxed display doesn't drift.
      if (allLineChanges.length) {
        const codingLog = recodeLog(
          (lines ?? []).map((l) => ({ id: l.id, name: l.name, jobCostItemId: l.jobCostItem?.id ?? null })),
          picked,
          budget,
        );
        const res = await fetch("/api/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes: allLineChanges, docId, codingLog }),
        });
        const json = await res.json();
        if (!res.ok) {
          setSaveMsg(json.error ?? "Save failed");
          return;
        }
        if (json.previewed) {
          setSaveMsg("Preview only — writes are OFF. The bill would be re-sent to JobTread.");
          return;
        }
        const results = (json.results ?? []) as { costItemId: string; ok: boolean }[];
        failed = results.filter((r) => !r.ok).length;
      }
      // 2) Push the document-level sales tax (nonRecoverableTax) in the same Save.
      if (taxChanged) {
        const res = await fetch("/api/bill-tax", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, taxAmount: round2(taxView) }),
        });
        const json = await res.json();
        if (!res.ok) {
          setSaveMsg(json.error ?? "Tax save failed");
          return;
        }
        if (json.previewed) {
          setSaveMsg("Preview only — writes are OFF. Nothing saved to JobTread.");
          return;
        }
      }
      // 3) Clear edits and re-read JobTread's truth (its stored tax-inclusive costs), which
      //    the display de-taxes back to exactly the pre-tax amounts the office typed.
      setPicked({});
      setEdits({});
      setTaxEdit(null);
      setSaveMsg(failed ? `Saved, ${failed} line(s) failed.` : "Saved.");
      // The stored flag only records a LINE write (same rule the coding queue uses),
      // so flip the marker optimistically on that condition; loadBill re-reads it.
      if (allLineChanges.length && failed < allLineChanges.length) setSaved(true);
      await loadBill();
      reloadJtWindow();
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

  // --- Combine rows: group lines by their EFFECTIVE cost code (an unsaved pick
  // wins over the saved code), so a code shared by 2+ lines is combinable. ---
  const effCode = (l: Line) => picked[l.id] ?? l.jobCostItem?.id ?? "";
  const byId = new Map((lines ?? []).map((l) => [l.id, l] as const));
  const codeCounts = new Map<string, number>();
  for (const l of lines ?? []) {
    const c = effCode(l);
    if (c) codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1);
  }
  const isCombinable = (l: Line) => (codeCounts.get(effCode(l)) ?? 0) >= 2;
  const anyCombinable = [...codeCounts.values()].some((n) => n >= 2);
  const selCodeSet = new Set(
    selected.map((id) => byId.get(id)).filter(Boolean).map((l) => effCode(l as Line)).filter(Boolean),
  );
  // Combining reads each line's STORED name + cost, so an unsaved description/
  // qty/unit edit would be silently dropped — block until it's saved or discarded.
  const selHasEdit = selected.some((id) => {
    const e = edits[id];
    return Boolean(
      e && (e.name !== undefined || e.quantity !== undefined || e.unitCost !== undefined),
    );
  });
  const canCombine = selected.length >= 2 && selCodeSet.size === 1 && !selHasEdit;

  const toggleSel = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function combineRows() {
    const sel = selected.map((id) => byId.get(id)).filter(Boolean) as Line[];
    if (sel.length < 2) return;
    const codeId = effCode(sel[0]);
    if (!codeId || !sel.every((l) => effCode(l) === codeId)) return; // mixed codes
    const keep = sel[0];
    const deleteIds = sel.slice(1).map((l) => l.id);
    // Sum the lines' stored costs so the bill total (and subtotal) is unchanged.
    const extendedCost = round2(sel.reduce((s, l) => s + (l.cost ?? 0), 0));
    const name = sel
      .map((l) => (l.name || "").trim())
      .filter(Boolean)
      .join(" + ")
      .substring(0, 250) || "Line item";
    const opt = budget.find((o) => o.id === codeId);
    const description = opt ? (opt.name ? `${opt.number} - ${opt.name}` : opt.number) : undefined;

    setCombining(true);
    setCombineMsg("");
    try {
      const res = await fetch("/api/combine-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          keepId: keep.id,
          deleteIds,
          name,
          extendedCost,
          jobCostItemId: codeId || undefined,
          description,
        }),
      });
      const json = await res.json();
      if (!res.ok) setCombineMsg(json.error ?? "Combine failed");
      else if (json.previewed)
        setCombineMsg("Preview only — writes are OFF. Nothing was combined in JobTread.");
      else {
        setSelected([]);
        setPicked((p) => {
          const n = { ...p };
          [keep.id, ...deleteIds].forEach((id) => delete n[id]);
          return n;
        });
        await loadBill(); // pull the combined line from JobTread
        reloadJtWindow();
      }
    } catch (e) {
      setCombineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setCombining(false);
    }
  }

  // Delete a single line from the bill (draft only; writes-gated on the server).
  async function deleteLineById(id: string, label: string) {
    if (!window.confirm(`Delete this line?\n\n${label}\n\nThis removes it from the bill in JobTread.`))
      return;
    setDeletingId(id);
    setSaveMsg("");
    try {
      const res = await fetch("/api/delete-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, costItemId: id }),
      });
      const json = await res.json();
      if (!res.ok) setSaveMsg(json.error ?? "Delete failed");
      else if (json.previewed)
        setSaveMsg("Preview only — writes are OFF. Nothing was deleted in JobTread.");
      else {
        setSelected((s) => s.filter((x) => x !== id));
        setPicked((p) => {
          const n = { ...p };
          delete n[id];
          return n;
        });
        setEdits((e) => {
          const n = { ...e };
          delete n[id];
          return n;
        });
        await loadBill();
        reloadJtWindow();
      }
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setDeletingId("");
    }
  }

  // Buyback: move a line off this client bill onto a draft bill on Ascent - Shop
  // instead of billing it to the job. Repeat clicks on other lines of THIS bill
  // land on the same Shop bill (see buybackLine's externalId idempotency) — no
  // client-side tracking of "which Shop bill" is needed. Draft-only + writes-
  // gated, like Delete/Add/Combine line. `extended` is the line's current
  // pre-tax dollar amount (handles both a stored line and one mid-edit).
  async function buybackLineById(l: Line, name: string, extended: number) {
    if (
      !window.confirm(
        `Buy back this line to Ascent - Shop?\n\n${name} — ${money(extended)}\n\n` +
          `This moves it onto a draft bill on the Shop job (creating one if needed) and ` +
          `removes it from this bill.`,
      )
    )
      return;
    setBuybackId(l.id);
    setSaveMsg("");
    try {
      const opt = budget.find((o) => o.id === (picked[l.id] ?? l.jobCostItem?.id ?? ""));
      const description = opt ? (opt.name ? `${opt.number} - ${opt.name}` : opt.number) : undefined;
      const res = await fetch("/api/buyback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDocId: docId,
          costItemId: l.id,
          name,
          unitCost: round2(extended),
          description,
        }),
      });
      const json = await res.json();
      if (!res.ok) setSaveMsg(json.error ?? "Buyback failed");
      else if (json.previewed)
        setSaveMsg("Preview only — writes are OFF. Nothing was moved in JobTread.");
      else {
        setSaveMsg(
          json.created ? "Moved to a new Shop bill." : "Added to the existing Shop bill.",
        );
        setSelected((s) => s.filter((x) => x !== l.id));
        setPicked((p) => {
          const n = { ...p };
          delete n[l.id];
          return n;
        });
        setEdits((e) => {
          const n = { ...e };
          delete n[l.id];
          return n;
        });
        await loadBill();
        reloadJtWindow();
      }
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setBuybackId("");
    }
  }

  return (
    // The bottom action drawer is `fixed` to the bottom edge, so the page's own
    // bottom padding has to clear BOTH the drawer and the home-indicator inset
    // (the layout sets viewportFit: "cover", so `env()` is live here).
    <main className="mx-auto max-w-xl px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-5">
      {/* Back owns the top row at a 44px hit height (Apple HIG / WCAG 2.5.5
          target size). There is no Refresh here any more — the app header's
          reload button (in the job-picker bar) remounts this page, which
          re-runs the load effect and re-reads the bill from JobTread, so a
          second one on the page was the same action twice. */}
      <div className="flex items-center gap-2">
        <Link
          href={backHref}
          className="-ml-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-accent transition hover:bg-accent/10 dark:text-accent-soft"
        >
          {backLabel}
        </Link>
      </div>

      {/* Queue pager: a three-up bar, so the arrows are thumb-sized targets and
          the position reads between them. */}
      {qIdx >= 0 && queue.length > 1 && (
        <nav
          aria-label="Coding queue"
          className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2"
        >
          {prevId ? (
            <Link
              href={`/bill/${prevId}?jobId=${encodeURIComponent(jobId)}${navContext}`}
              onClick={() => driveMainWindowToDoc(jobId, prevId)}
              aria-label="Previous bill"
              className={btn("outline", "md", "min-h-11 w-full")}
            >
              ‹ Prev
            </Link>
          ) : (
            <span className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line text-sm font-semibold text-neutral-300 dark:border-neutral-800 dark:text-neutral-700">
              ‹ Prev
            </span>
          )}
          <span className="px-1 text-xs font-semibold tabular-nums text-neutral-500 dark:text-neutral-400">
            {qIdx + 1} / {queue.length}
          </span>
          {nextId ? (
            <Link
              href={`/bill/${nextId}?jobId=${encodeURIComponent(jobId)}${navContext}`}
              onClick={() => driveMainWindowToDoc(jobId, nextId)}
              aria-label="Next bill"
              className={btn("outline", "md", "min-h-11 w-full")}
            >
              Next ›
            </Link>
          ) : (
            <span className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line text-sm font-semibold text-neutral-300 dark:border-neutral-800 dark:text-neutral-700">
              Next ›
            </span>
          )}
        </nav>
      )}

      <header className="mb-5 mt-4">
        <PageTitle>{title}</PageTitle>
        {/* Status, the saved marker and the document's own identifiers are all
            metadata about the same thing, so they share one wrapping strip
            under the title rather than stacking as separate rows. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {header?.status && <BillStatusBadge status={header.status} />}
          {/* Same "✓ Saved" marker the coding queue shows. Reviewed outranks it there,
              and here the Reviewed state already has its own button below. */}
          {saved && !reviewed && (
            <span
              title="Save has been clicked on this bill"
              className="inline-block shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              ✓ Saved
            </span>
          )}
          <span className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
            {header?.issueDate ? header.issueDate + " · " : ""}
            {docId}
          </span>
        </div>

        {/* The total is the number checked on every single bill, so it leads at
            display size in tabular figures. The tax that makes it up is NOT
            here — it sits in the totals block under the line items, where a
            paper invoice puts it. */}
        {lines && (
          <Card className="mt-4 !p-4">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <SectionLabel>Bill total</SectionLabel>
                <p className="mt-1 text-3xl font-bold leading-none tabular-nums">{money(total)}</p>
              </div>
              <p className="shrink-0 text-sm text-neutral-500 dark:text-neutral-400">
                {lines.length} {lines.length === 1 ? "line" : "lines"}
              </p>
            </div>
          </Card>
        )}

        {saveMsg && (
          <Banner tone="neutral" className="mt-3 !px-3 !py-2.5 !text-xs">
            {saveMsg}
          </Banner>
        )}

        {/* Type (Bill/Expense) and Push-to-QB toggles hidden 2026-07-18 per request.
            Kept commented (with their patchBill/isExpense/pushToQb handlers) for easy restore. */}
        {/*
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-neutral-400">Type</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-line-strong">
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
                        ? "bg-accent font-semibold text-accent-fg"
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
            <div className="inline-flex overflow-hidden rounded-lg border border-line-strong">
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
                        ? "bg-accent font-semibold text-accent-fg"
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
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
            >
              {approving ? "Saving…" : isExpense ? "Record payment" : "Approve for payment"}
            </button>
          )}
        </div>
        */}
      </header>

      {loading && <Loading label="Loading bill from JobTread…" />}
      {error && <Banner tone="error">{error}</Banner>}

      {lines && (
        <>
          {/* Everything that qualifies the whole list — the two lock/preview
              warnings — sits above the section heading, so the heading is the
              last thing before the lines themselves. */}
          {!linesEditable && (
            <Banner tone="warning" className="mb-3 !px-3 !py-2.5 !text-xs">
              Qty &amp; unit cost are locked once a bill is payable/paid — you can still re-code it.
              To edit amounts, set the bill back to Draft in JobTread.
            </Banner>
          )}

          {!writes && (
            <Banner tone="warning" className="mb-3 !px-3 !py-2.5 !text-xs">
              Writes are OFF (COMPANION_WRITES_ENABLED not <span className="font-mono">true</span> on
              this deploy). Save shows a preview and sends nothing to JobTread. Set it in Vercel and{" "}
              <b>redeploy</b>.
            </Banner>
          )}

          <SectionLabel className="mb-2">Lines</SectionLabel>

          {budget.length > 0 && lines.length > 1 && (
            <div className="mb-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-ink-raised/60">
              <Label>Apply one code to all {lines.length} lines</Label>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <CostCodeSelect options={budget} value={bulkCode} onChange={setBulkCode} />
                </div>
                <Button
                  className="min-h-11 shrink-0"
                  onClick={() => applyCodeToAll(bulkCode)}
                  disabled={!bulkCode}
                >
                  Apply
                </Button>
              </div>
            </div>
          )}

          {/* Combine rows: appears once 2+ lines share a cost code. Check the ones
              to merge, then Combine — they collapse into one line (summed amount,
              concatenated description). Draft-only + writes-gated, like Add line.
              The hint and the button stack rather than share a row: side by side
              on a phone the hint wrapped to three lines beside a squashed
              button. */}
          {linesEditable && writes && anyCombinable && (
            <div className="mb-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-ink-raised/60">
              <Label>Combine lines sharing a cost code</Label>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {selected.length < 2
                  ? "Check 2+ lines with the same cost code."
                  : selCodeSet.size > 1
                    ? "Selected lines have different codes — pick lines that share one code."
                    : selHasEdit
                      ? "Save or discard your line edits first."
                      : `Merging ${selected.length} lines into one.`}
              </p>
              <Button
                className="mt-2.5 min-h-11 w-full"
                onClick={combineRows}
                disabled={!canCombine || combining}
              >
                {combining
                  ? "Combining…"
                  : `Combine rows${selected.length >= 2 ? ` (${selected.length})` : ""}`}
              </Button>
              {combineMsg && (
                <Banner tone="neutral" className="mt-2 !px-3 !py-2.5 !text-xs">
                  {combineMsg}
                </Banner>
              )}
            </div>
          )}

          <ul className="space-y-3">
            {lines.map((l) => {
              const current = picked[l.id] ?? l.jobCostItem?.id ?? "";
              const nameVal = edits[l.id]?.name ?? (l.name ?? "");
              const qtyVal = edits[l.id]?.quantity ?? (l.quantity != null ? String(l.quantity) : "");
              // Unit $ is shown and edited PRE-TAX (what JobTread shows): the stored cost
              // de-taxed. When a line isn't being edited, take its pre-tax extended amount
              // straight from the stored cost (matches JobTread to the penny); only
              // recompute qty × unit while the office is editing it.
              const edited =
                edits[l.id]?.unitCost !== undefined || edits[l.id]?.quantity !== undefined;
              const unitVal =
                edits[l.id]?.unitCost ??
                (l.unitCost != null ? String(round2(deTax(l.unitCost))) : "");
              const extended =
                edited && qtyVal !== "" && unitVal !== ""
                  ? Number(qtyVal) * Number(unitVal)
                  : deTax(l.cost ?? 0);
              // 44px tall, so every field on a line clears the touch-target
              // minimum. Tabular figures are added per-input — the money and
              // quantity fields want them, the description does not.
              const lineInputCls =
                "h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50 disabled:cursor-not-allowed dark:border-neutral-600 dark:bg-ink";
              return (
                <li
                  key={l.id}
                  className="rounded-xl border border-line bg-white p-3.5  dark:bg-ink-raised"
                >
                  {/* The description owns a full-width row. It used to share one
                      with the amount and two icon buttons, which on a phone left
                      the field around 120px wide — too narrow to read, let alone
                      edit, a real line description. */}
                  <div className="flex items-start gap-2.5">
                    {linesEditable && writes && isCombinable(l) && (
                      <input
                        type="checkbox"
                        checked={selected.includes(l.id)}
                        onChange={() => toggleSel(l.id)}
                        aria-label="Select line to combine"
                        title="Combine with other lines that share this cost code"
                        className="mt-3 h-5 w-5 shrink-0 cursor-pointer accent-accent"
                      />
                    )}
                    {linesEditable ? (
                      <input
                        type="text"
                        value={nameVal}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [l.id]: { ...p[l.id], name: e.target.value } }))
                        }
                        placeholder="Description"
                        aria-label="Line description"
                        className={`${lineInputCls} min-w-0 flex-1 font-medium`}
                      />
                    ) : (
                      <div className="min-w-0 flex-1 py-1 font-medium">{l.name || "Line item"}</div>
                    )}
                  </div>

                  {/* Qty × unit → amount on one baseline. The amount is the row's
                      anchor: right-aligned, a step larger than the inputs, in
                      tabular figures so it sits in the same money column as the
                      bill total above. */}
                  <div className="mt-3 flex items-end gap-2">
                    <div className="shrink-0">
                      <Label htmlFor={`qty-${l.id}`}>Qty</Label>
                      <input
                        id={`qty-${l.id}`}
                        type="number"
                        inputMode="decimal"
                        value={qtyVal}
                        disabled={!linesEditable}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [l.id]: { ...p[l.id], quantity: e.target.value } }))
                        }
                        className={`${lineInputCls} w-20 text-right tabular-nums`}
                      />
                    </div>
                    <span aria-hidden className="pb-3 text-neutral-500 dark:text-neutral-400">
                      ×
                    </span>
                    <div className="shrink-0">
                      <Label htmlFor={`unit-${l.id}`}>Unit $</Label>
                      <input
                        id={`unit-${l.id}`}
                        type="number"
                        inputMode="decimal"
                        value={unitVal}
                        disabled={!linesEditable}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [l.id]: { ...p[l.id], unitCost: e.target.value } }))
                        }
                        className={`${lineInputCls} w-28 text-right tabular-nums`}
                      />
                    </div>
                    <p className="min-w-0 flex-1 pb-2.5 text-right text-base font-semibold tabular-nums">
                      {money(extended)}
                    </p>
                  </div>

                  <div className="mt-3">
                    <Label>Cost code</Label>
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
                        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
                          <span className="text-neutral-500 dark:text-neutral-400">
                            Budget remaining
                          </span>
                          <span
                            className={
                              "font-semibold tabular-nums " +
                              (c.remaining < 0 ? "text-red-600 dark:text-red-400" : "")
                            }
                          >
                            {money(c.remaining)}
                          </span>
                          <span className="text-neutral-500 dark:text-neutral-400">
                            (budget {money(c.budget)} − actual {money(c.actual)})
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Destructive / structural actions live at the FOOT of the
                      card, right-aligned and away from the fields — both are
                      one-tap-and-confirm, and keeping them out of the editing
                      path is what stops a mis-tap while typing an amount. Each
                      is a 44px target now (they were 28px). */}
                  {linesEditable && writes && (
                    <div className="mt-3 flex justify-end gap-1 border-t border-line-soft pt-1 dark:border-neutral-800">
                      <IconButton
                        onClick={() => buybackLineById(l, nameVal || l.name || "Line item", extended)}
                        disabled={buybackId === l.id || deletingId === l.id}
                        label="Buy back to Ascent - Shop"
                        title="Move this line to a draft bill on Ascent - Shop"
                      >
                        {buybackId === l.id ? (
                          <Spinner />
                        ) : (
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            className="h-[18px] w-[18px]"
                          >
                            <path d="M4 12h13" />
                            <path d="M12 6l7 6-7 6" />
                          </svg>
                        )}
                      </IconButton>
                      <IconButton
                        tone="danger"
                        onClick={() => deleteLineById(l.id, l.name || "Line item")}
                        disabled={deletingId === l.id}
                        label="Delete line"
                        title="Delete this line"
                      >
                        {deletingId === l.id ? (
                          <Spinner />
                        ) : (
                          <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                            className="h-[18px] w-[18px]"
                          >
                            <path
                              fillRule="evenodd"
                              clipRule="evenodd"
                              d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z"
                            />
                          </svg>
                        )}
                      </IconButton>
                    </div>
                  )}
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
                  className="min-h-11 w-full rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm font-semibold text-accent transition hover:border-accent hover:bg-accent/5 dark:border-neutral-700 dark:text-accent-soft"
                >
                  + Add line
                </button>
              ) : (
                // Same field layout as an existing line, so adding one and
                // editing one look and behave identically.
                <div className="rounded-xl border border-line bg-white p-3.5  dark:bg-ink-raised">
                  <input
                    type="text"
                    value={newLine.name}
                    onChange={(e) => setNewLine((n) => ({ ...n, name: e.target.value }))}
                    placeholder="Line description"
                    aria-label="Line description"
                    className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 dark:border-neutral-600 dark:bg-ink"
                  />
                  <div className="mt-3 flex items-end gap-2">
                    <div className="shrink-0">
                      <Label htmlFor="new-line-qty">Qty</Label>
                      <input
                        id="new-line-qty"
                        type="number"
                        inputMode="decimal"
                        value={newLine.quantity}
                        onChange={(e) => setNewLine((n) => ({ ...n, quantity: e.target.value }))}
                        className="h-11 w-20 rounded-lg border border-neutral-300 bg-white px-3 text-right text-sm tabular-nums transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 dark:border-neutral-600 dark:bg-ink"
                      />
                    </div>
                    <span aria-hidden className="pb-3 text-neutral-500 dark:text-neutral-400">
                      ×
                    </span>
                    <div className="shrink-0">
                      <Label htmlFor="new-line-unit">Unit $</Label>
                      <input
                        id="new-line-unit"
                        type="number"
                        inputMode="decimal"
                        value={newLine.unitCost}
                        onChange={(e) => setNewLine((n) => ({ ...n, unitCost: e.target.value }))}
                        className="h-11 w-28 rounded-lg border border-neutral-300 bg-white px-3 text-right text-sm tabular-nums transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 dark:border-neutral-600 dark:bg-ink"
                      />
                    </div>
                    <p className="min-w-0 flex-1 pb-2.5 text-right text-base font-semibold tabular-nums">
                      {money((Number(newLine.quantity) || 0) * (Number(newLine.unitCost) || 0))}
                    </p>
                  </div>
                  <div className="mt-3">
                    <Label>Cost code</Label>
                    <CostCodeSelect
                      options={budget}
                      value={newLine.code}
                      onChange={(id) => setNewLine((n) => ({ ...n, code: id }))}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      className="min-h-11 w-full"
                      onClick={addLine}
                      disabled={addLineSaving || !newLine.name.trim()}
                    >
                      {addLineSaving ? "Adding…" : "Add line"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="min-h-11 w-full"
                      onClick={() => {
                        setAddingLine(false);
                        setAddLineMsg("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {addLineMsg && (
                <Banner tone="neutral" className="mt-2 !px-3 !py-2.5 !text-xs">
                  {addLineMsg}
                </Banner>
              )}
            </div>
          )}

          {/* Totals, where a paper invoice puts them: under the line items,
              right-aligned, subtotal → tax → total. The document-level sales
              tax is JobTread's "Tax" (nonRecoverableTax), a fixed dollar —
              editable on draft bills (writes on), where it holds each line's
              pre-tax amount steady and moves the total. Nothing writes until
              the drawer's Save (see saveCoding). */}
          <div className="mt-4 rounded-xl border border-line bg-white p-4  dark:bg-ink-raised">
            <dl className="ml-auto max-w-xs space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-neutral-500 dark:text-neutral-400">Subtotal</dt>
                <dd className="tabular-nums">{money(subtotal)}</dd>
              </div>

              {linesEditable && writes ? (
                <div className="flex items-center justify-between gap-4">
                  {/* A plain <label>, not the uppercase-caption `Label`
                      primitive: in a totals column this reads as a row title
                      beside its amount, the same weight as Subtotal above it. */}
                  <dt>
                    <label
                      htmlFor="bill-tax"
                      className="text-neutral-500 dark:text-neutral-400"
                    >
                      {taxName}
                    </label>
                  </dt>
                  <dd className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500 dark:text-neutral-400">
                      $
                    </span>
                    <input
                      id="bill-tax"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={taxEdit ?? String(storedTax)}
                      onChange={(e) => setTaxEdit(e.target.value)}
                      aria-label={`${taxName} amount`}
                      className="h-11 w-32 rounded-lg border border-neutral-300 bg-white pl-7 pr-3 text-right text-sm tabular-nums transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 dark:border-neutral-600 dark:bg-ink"
                    />
                  </dd>
                </div>
              ) : (
                taxView > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-neutral-500 dark:text-neutral-400">{taxName}</dt>
                    <dd className="tabular-nums">{money(taxView)}</dd>
                  </div>
                )
              )}

              <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2 ">
                <dt className="font-semibold">Total</dt>
                <dd className="text-lg font-bold tabular-nums">{money(total)}</dd>
              </div>
            </dl>
          </div>
        </>
      )}

      {/* Attached invoice image / PDF — at the bottom. Labelled like every
          other section, and sized in `dvh` so a phone's collapsing browser
          chrome can't crop the scan mid-scroll. */}
      {files.length > 0 && (
        <section className="mt-8">
          <SectionLabel className="mb-2">Invoice</SectionLabel>
          <div className="space-y-3">
            {files.map((f) =>
              f.url && isImage(f) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={f.id} href={f.url} target="_blank" rel="noreferrer" title="Open full size">
                  <img
                    src={f.url}
                    alt={f.name ?? "invoice"}
                    className="max-h-[70dvh] w-full rounded-xl border border-line object-contain dark:border-neutral-800"
                  />
                </a>
              ) : f.url ? (
                <div key={f.id}>
                  <iframe
                    src={f.url}
                    title={f.name ?? "invoice"}
                    className="h-[70dvh] w-full rounded-xl border border-line dark:border-neutral-800"
                  />
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex min-h-11 items-center text-xs font-semibold text-accent dark:text-accent-soft"
                  >
                    Open {f.name || "attachment"} ↗
                  </a>
                </div>
              ) : (
                <span key={f.id} className="text-sm text-neutral-500 dark:text-neutral-400">
                  {f.name}
                </span>
              ),
            )}
          </div>
        </section>
      )}

      {/* Filing details — which month the bill belongs to, and which job it
          belongs to — sit AFTER the scan, because both are answered by looking
          at the document: you read the date off the invoice, and you work out
          the right job from what's on it. */}
      {header && (
        <Card className="mt-8 !p-4">
          <SectionLabel className="mb-3">Filing</SectionLabel>
          {/* Vendor Bill Number — the invoice/bill number carried on the document
              (JobTread's externalId, set from the invoice at ingestion). Read-only
              here; correct it in JobTread if it's wrong. Falls back to JobTread's
              own document number for bills logged before the number was captured. */}
          <div>
            <Label>Bill number</Label>
            <p className="font-mono text-sm text-neutral-700 dark:text-neutral-300">
              {header.externalId || (header.number ? `#${header.number}` : "—")}
            </p>
          </div>

          <div className="mt-4">
            <Label htmlFor="billing-month">Billing month</Label>
            <Select
              id="billing-month"
              className="!h-11"
              value={
                billingMonthOptions().find((o) => o.ym === (header?.issueDate ?? "").slice(0, 7))
                  ?.value ?? ""
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
                invalidateBills(); // cached payload still carries the old issueDate
              }}
            >
              <option value="">— set billing month —</option>
              {billingMonthOptions().map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Move this bill to a different job (draft only). JT can't move bills, so
              this delete+recreates it on the chosen job. Writes-off deploys hide it,
              matching the rest of the page. */}
          {writes && (header?.status ?? "draft") === "draft" && (
            <div className="mt-4">
              <Label>Move to job</Label>
              <JobPicker value={jobId} onChange={reassignJob} />
              {reassignMsg && (
                <Banner tone="neutral" className="mt-2 !px-3 !py-2.5 !text-xs">
                  {reassignMsg}
                </Banner>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Sticky bottom drawer — always shown once the bill loads, so Save can re-push the
          bill to JobTread even with nothing edited here (JT's stored costs can drift on
          their own). Save re-sends the WHOLE bill (every line + the tax). The page's
          bottom padding keeps content clear of it. */}
      {header && (
        // Docked ABOVE the tab bar via --tabbar-h (globals.css) — both are
        // `fixed` to the bottom edge, so without the offset the tab bar would
        // sit on top of Save. The variable already carries the safe-area inset,
        // which is why this bar no longer adds its own.
        <div
          style={{ bottom: "var(--tabbar-h, 0px)" }}
          className="fixed inset-x-0 z-30 border-t border-line bg-cream/95 backdrop-blur dark:border-white/10 dark:bg-ink/95 print:hidden"
        >
          <div className="mx-auto max-w-xl px-4">
            {/* Drawer handle. The bill's secondary actions — open in JobTread,
                mark reviewed, push to the tracking sheet — live behind it, so
                they're one tap away from the thumb wherever you are in a long
                bill, instead of scrolled off the top of the page. */}
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              aria-expanded={drawerOpen}
              aria-controls="bill-actions"
              className="flex min-h-9 w-full items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 transition hover:text-accent dark:text-neutral-400"
            >
              <span
                aria-hidden
                className={`inline-block text-[9px] transition-transform ${
                  drawerOpen ? "rotate-180" : ""
                }`}
              >
                ▲
              </span>
              {drawerOpen ? "Hide actions" : "Actions"}
            </button>

            {/* `hidden` rather than a conditional render: TrackingSheetSyncFor
                owns its own sync state, and unmounting it on collapse would
                throw away the result of a sync the office kicked off and
                scrolled away from. */}
            <div
              id="bill-actions"
              hidden={!drawerOpen}
              className="max-h-[45dvh] overflow-y-auto border-t border-line py-3 dark:border-white/10"
            >
              <div className="grid grid-cols-2 gap-2">
                {jobId && (
                  <JtLink
                    href={`https://app.jobtread.com/jobs/${jobId}/documents/${docId}`}
                    className={btn("outline", "md", "min-h-11 w-full")}
                  >
                    Open in JobTread ↗
                  </JtLink>
                )}
                <button
                  type="button"
                  onClick={toggleReviewed}
                  disabled={reviewLoading}
                  title={reviewed ? "Marked reviewed — click to unmark" : "Mark this bill reviewed"}
                  className={
                    reviewed
                      ? btn("primary", "md", "min-h-11 w-full !bg-emerald-600 hover:!bg-emerald-700")
                      : btn("outline", "md", "min-h-11 w-full")
                  }
                >
                  {reviewed ? "✓ Reviewed" : "Mark reviewed"}
                </button>
              </div>

              {/* Push this bill's billing month into the job's tracking sheet.
                  The sheet reads costCode off each bill line, so it belongs
                  with the actions you reach for once the coding is settled.
                  The month comes from the bill's own Invoice Date, which IS
                  its billing month. Renders nothing if the job has no
                  tracking sheet. */}
              {jobId && header?.issueDate && (
                <TrackingSheetSyncFor
                  jtJobId={jobId}
                  ym={header.issueDate.slice(0, 7)}
                  monthLabel={
                    billingMonthOptions().find((o) => o.ym === header.issueDate!.slice(0, 7))
                      ?.label ?? header.issueDate.slice(0, 7)
                  }
                  className="mt-2"
                />
              )}
            </div>

            <div
              className={`flex items-center justify-between gap-3 py-2.5 ${
                drawerOpen ? "" : "border-t border-line dark:border-white/10"
              }`}
            >
              {/* Unsaved work is stated in amber — the same "something is
                  pending" colour the rest of the app uses — so the bar reads
                  differently at a glance depending on whether it matters. */}
              <span className="min-w-0 text-sm">
                {changeCount === 0 ? (
                  <span className="text-neutral-500 dark:text-neutral-400">No unsaved changes</span>
                ) : (
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {changeCount} unsaved change{changeCount === 1 ? "" : "s"}
                  </span>
                )}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => {
                    setPicked({});
                    setEdits({});
                    setTaxEdit(null);
                  }}
                  disabled={saving || changeCount === 0}
                >
                  Discard
                </Button>
                <Button className="min-h-11" onClick={saveCoding} disabled={saving}>
                  {saving ? "Saving…" : changeCount === 0 ? "Save" : `Save (${changeCount})`}
                </Button>
              </div>
            </div>
          </div>
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
