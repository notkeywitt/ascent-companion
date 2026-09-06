"use client";

import { Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { type Option } from "@/components/CostCodeSelect";
import { JtLink } from "@/components/JtLink";
import { JobPicker } from "@/components/JobPicker";
import { PageTitle } from "@/components/PageTitle";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import {
  Banner,
  Button,
  Card,
  Chip,
  Loading,
  MetaLine,
  SectionHeading,
  StatementBlock,
  btn,
} from "@/components/ui";
import { TrackingSheetSyncFor } from "@/components/TrackingSheetSync";
import { billLineMath, recodeLog } from "@/lib/billLineMath";
import { billingMonths, issueDateFor, monthLabel } from "@/lib/billingMonths";
import {
  BillCodingCard,
  type CodingCardCtl,
  type CodingLine,
} from "@/app/trackingsheet/BillCodingCard";
import { useCopy } from "@/components/CopyProvider";
import { markBillTouched } from "@/lib/billTouch";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import {
  billDraftKey,
  discardDraft,
  draftSavedAtLabel,
  loadDraft,
  reconcileDraft,
  saveDraft,
} from "@/lib/codingDraft";
import { isTaxRecoverable, SALES_TAX_LINE_NAME, splitSalesTax } from "@/lib/salesTax";

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
  /** Legacy document tax field — non-zero only on a bill pushed before 2026-09-05.
   *  A bill's real sales tax comes off its 88 80 00 line (splitSalesTax). */
  nonRecoverableTax?: number;
}
interface FileNode {
  id: string;
  name?: string;
  type?: string;
  url?: string;
  /** JobTread's own flat render of the file — page 1 as a JPEG. See BillFile in
   *  src/lib/jobtread.ts, and InvoiceViewer.tsx for why the scan is never
   *  iframed. */
  imageUrl?: string | null;
}

/** Everything /api/bill returns — the whole bill view in one payload. */
interface BillPayload {
  header?: Header | null;
  lines?: Line[];
  budget?: Option[];
  costToComplete?: Record<string, { budget: number; actual: number; remaining: number }>;
  files?: FileNode[];
  /** The bill's own job, resolved server-side — present even when the link that
   *  opened this page carried no ?jobId. */
  jobId?: string;
  /** That job's Phase — what decides whether this bill's sales tax is recoverable. */
  jobPhase?: string;
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
  const router = useRouter();
  const docId = params.docId;
  // The link that opened this page usually carries ?jobId, but some review /
  // digest bill links don't. When it's absent, /api/bill still returns the bill
  // (it knows its own job) plus that job's id, which we adopt below so the Back
  // link, coding-queue pager and neighbour prefetch keep working.
  const urlJobId = search.get("jobId") ?? "";
  // Office-edited wording (Admin → Page Text), for the shared coding card.
  const c = useCopy();
  const [resolvedJobId, setResolvedJobId] = useState("");
  const jobId = urlJobId || resolvedJobId;
  // Where Back returns to WHEN there's no in-app history to step back through
  // (a bill opened cold from a digest / search / shared link). Back itself is a
  // general "‹ Back" that prefers the browser's own history — see the handler on
  // the link below — and only uses this computed destination as the fallback.
  // Pages that deep-link here say so with ?from=… — the three Tracking Sheets
  // surfaces (`recode` the workbench, `invoicing` the all-jobs month roster,
  // `drafts` the needs-coding queue) and the Sunset Statements page (`payments`).
  // `stage` is the retired Invoicing page, still reachable by URL; anything
  // unrecognised falls back to the workbench.
  const from = search.get("from");
  // Tracking Sheets carries its billing month through so Back lands on the same
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
          `/trackingsheet?open=${encodeURIComponent(jobId)}${ymQs}`
        : from === "drafts"
          ? "/trackingsheet?tab=drafts"
          : from === "payments"
            ? "/payments"
            : `/trackingsheet?jobId=${encodeURIComponent(jobId)}${ymQs}#bill-${docId}`;
  // A general Back: return to the previous page via the browser's history when
  // there is one, so Back lands wherever you actually came from (search, the
  // digest, a shared link) instead of always claiming "Tracking Sheets". Falls
  // back to the computed destination above when the bill was opened cold (no
  // in-app history), which also keeps a right-click / open-in-new-tab useful.
  function goBack(e: MouseEvent<HTMLAnchorElement>) {
    if (typeof window !== "undefined" && window.history.length > 1) {
      e.preventDefault();
      router.back();
    }
  }
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
  // The bill's job Phase — the one input to whether its sales tax is recoverable.
  const [jobPhase, setJobPhase] = useState<string>("");
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
  const [reassigning, setReassigning] = useState(false);
  const [monthSaving, setMonthSaving] = useState(false);
  const [bulkCode, setBulkCode] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [saved, setSaved] = useState(false); // Save has been clicked on this bill (assistant-local)
  const [reviewLoading, setReviewLoading] = useState(false);
  // "Needs review" — a companion-local flag + note for a billing correction the
  // app can't make (a paid / invoiced / QuickBooks-pushed bill). See /api/bill-review.
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewFlaggedBy, setReviewFlaggedBy] = useState("");
  const [reviewFlaggedAt, setReviewFlaggedAt] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewMsg, setReviewMsg] = useState("");
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
  /** Set when unsynced coding for this bill was offered back on open. */
  const [restored, setRestored] = useState<{
    kept: number;
    dropped: number;
    savedAt: string;
  } | null>(null);
  // Vendor Bill Number editor (JobTread externalId). Local draft synced from the
  // header; committed on blur so we don't write on every keystroke.
  const [billNumber, setBillNumber] = useState("");
  const [billNumberSaving, setBillNumberSaving] = useState(false);
  const [billNumberMsg, setBillNumberMsg] = useState("");
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
    setJobPhase(json.jobPhase ?? "");
    // Adopt the bill's own job when the URL didn't provide one.
    if (json.jobId) setResolvedJobId(json.jobId);
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
    setRestored(null);
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

  // Keep the Bill Number draft in step with the header JobTread returns (on load,
  // navigation between bills, and after a save re-reads the doc).
  useEffect(() => {
    setBillNumber(header?.externalId ?? "");
    setBillNumberMsg("");
  }, [header?.externalId, docId]);

  // Persist the edited Vendor Bill Number (JobTread externalId). Optimistic, with
  // a revert on failure; runs on blur only when the value actually changed.
  async function saveBillNumber() {
    const next = billNumber.trim();
    const current = (header?.externalId ?? "").trim();
    if (next === current) return;
    setBillNumberSaving(true);
    setBillNumberMsg("");
    setHeader((h) => (h ? { ...h, externalId: next } : h)); // optimistic
    try {
      const res = await fetch("/api/bill-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, externalId: next }),
      });
      const json = await res.json();
      if (!res.ok) {
        setHeader((h) => (h ? { ...h, externalId: current } : h)); // revert
        setBillNumberMsg(json.error ?? "Save failed");
      } else if (json.previewed) {
        setHeader((h) => (h ? { ...h, externalId: current } : h)); // nothing written
        setBillNumberMsg("Writes are OFF — nothing saved to JobTread.");
      } else {
        setBillNumberMsg("Saved.");
        invalidateBills(); // cached payload still carries the old number
        reloadJtWindow(); // refresh JobTread's view
      }
    } catch (e) {
      setHeader((h) => (h ? { ...h, externalId: current } : h)); // revert
      setBillNumberMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setBillNumberSaving(false);
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  // Sales tax is its OWN cost item coded 88 80 00 (src/lib/salesTax.ts), so it comes
  // out of the line list here and drives the Tax row in the totals block instead. A
  // bill pushed before 2026-09-05 still carries it in `nonRecoverableTax` and has its
  // line costs stored tax-INCLUSIVE; `legacyTaxField` is what de-taxes those, and a
  // Save migrates the bill by writing the de-taxed costs and moving the tax onto a
  // line. On every current bill both are inert and what is on screen is what is stored.
  const legacyTaxField = header?.nonRecoverableTax ?? 0;
  const { lines: codeableLines, taxAmount: storedTax } = splitSalesTax(
    (lines ?? []).map((l) => ({ ...l, jobCostItemId: l.jobCostItem?.id ?? null })),
    legacyTaxField,
  );
  const taxName = SALES_TAX_LINE_NAME;
  // While the office edits the Tax field, preview with the typed value.
  const taxView = taxEdit !== null && taxEdit !== "" ? Number(taxEdit) || 0 : storedTax;
  const taxChanged = taxEdit !== null && round2(taxView) !== round2(storedTax);
  const invId = header?.externalId || header?.number || "";
  const vendor = header?.fromName || header?.subject || header?.name || "Vendor bill";
  // Sunset keeps "Vendor \u00b7 Invoice ID"; every other vendor shows just its name.
  const isSunsetBill = /sunset/i.test(vendor);
  const title = isSunsetBill && invId ? `${vendor} \u00b7 ${invId}` : vendor;

  // The de-tax / pre-tax-edit / gross-up model lives in src/lib/billLineMath.ts,
  // shared with Tracking Sheets (/trackingsheet) so the two pages can never disagree
  // about what a save writes. Read that file for the model itself.
  const {
    deTax,
    subtotal,
    total,
    targets,
    pendingCount,
    wholeBillChanges: allLineChanges,
  } = billLineMath({
    lines: codeableLines,
    storedTax,
    legacyTaxField,
    taxView,
    status: header?.status,
    edits,
    picked,
    budget,
  });

  // A bill still carrying tax in the document field is migrated by any Save: the
  // line write below sends de-taxed costs, so the tax must move to its own line
  // in the same Save or the bill total falls by the tax amount.
  const needsTaxMigration = legacyTaxField > 0;

  // Edits made here but not yet pushed. Save stays enabled at zero (it re-sends the bill
  // regardless); this only drives the bar's label and the Discard button.
  const changeCount = pendingCount + (taxChanged ? 1 : 0);

  // Warn before leaving with unsaved edits (the same changes the sticky Save bar counts)
  // — covers refresh/close, in-app links, and Back/Forward. A reminder that
  // JobTread hasn't got them yet, not a warning that they're about to go: the
  // autosave below keeps them (see src/lib/codingDraft.ts).
  useUnsavedChanges(
    changeCount > 0,
    "This bill has unsaved coding changes. They'll be saved and offered back when you return — leave now?",
  );

  // ---- durable drafts -----------------------------------------------------
  /**
   * Unsaved coding on this bill is written continuously and offered back when
   * the bill is next opened — ANYWHERE. The scope key is the bill, the same one
   * the Tracking Sheets coding panel uses, so coding started on a phone here is
   * waiting in the desktop workbench (and the other way round). It is not sent
   * to JobTread; Save still is. See src/lib/codingDraft.ts.
   *
   * TWO refs, not one: opening a bill empties the staged state and the restore
   * that follows is async, so arming the autosave when the restore STARTS would
   * fire it on that emptiness and delete the draft still being read.
   */
  const draftKey = docId ? billDraftKey(docId) : "";
  const restoreStartedRef = useRef("");
  const autosaveArmedRef = useRef("");

  useEffect(() => {
    if (!draftKey || !header || !lines) return;
    if (restoreStartedRef.current === draftKey) return;
    restoreStartedRef.current = draftKey;
    let alive = true;
    (async () => {
      try {
        const draft = await loadDraft(draftKey);
        if (!alive || !draft) return;
        const r = reconcileDraft(draft, {
          lines: lines.map((l) => ({ id: l.id, jobCostItemId: l.jobCostItem?.id ?? null })),
          bills: [{ id: docId, salesTax: storedTax }],
          budgetIds: budget.map((b) => b.id),
        });
        if (r.kept === 0) {
          if (r.dropped > 0) discardDraft(draftKey);
          return;
        }
        // Only ever ADD to an empty state — the read is async, and anything typed
        // while it was in flight outranks what was stored earlier.
        setPicked((prev) => (Object.keys(prev).length > 0 ? prev : r.staged));
        setEdits((prev) => (Object.keys(prev).length > 0 ? prev : r.edits));
        setTaxEdit((prev) => (prev !== null ? prev : (r.taxEdits[docId] ?? null)));
        setRestored({ kept: r.kept, dropped: r.dropped, savedAt: draft.savedAt });
      } finally {
        if (alive) autosaveArmedRef.current = draftKey;
      }
    })();
    return () => {
      alive = false;
    };
    // `budget` arrives with `lines` in the same payload; those two are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, header, lines]);

  useEffect(() => {
    if (!draftKey || autosaveArmedRef.current !== draftKey) return;
    saveDraft(
      draftKey,
      {
        staged: picked,
        edits,
        taxEdits: taxEdit !== null && taxEdit !== "" ? { [docId]: taxEdit } : {},
      },
      // What the "unfinished work" list on Tracking Sheets calls this row — the
      // vendor and their own invoice number, the way the bill is named here.
      [vendor, header?.externalId || header?.number].filter(Boolean).join(" · "),
    );
  }, [draftKey, docId, picked, edits, taxEdit, vendor, header?.externalId, header?.number]);

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
    setReassigning(true);
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
        setReassigning(false);
        return;
      }
      reloadJtWindow(); // refresh JobTread's view (old doc gone, new one created)
      // New docId on the new job — this page's docId is stale; open Client
      // Invoicing on the job the bill just moved to. Deliberately still
      // `reassigning` — the navigation is what ends it, and re-enabling the
      // picker first would offer a second move against a dead docId.
      window.location.href = `/trackingsheet?jobId=${encodeURIComponent(targetJobId)}`;
    } catch (e) {
      setReassignMsg(e instanceof Error ? e.message : "Network error");
      setReassigning(false);
    }
  }

  /**
   * File this bill in a different billing month. Lifted verbatim out of the
   * Select this page used to draw; the card calls it with a `ym`, and
   * `issueDateFor` turns that into the last-day issueDate `/api/bill-issuedate`
   * expects — the same helper the board uses, so the two can't disagree.
   */
  async function setBillingMonth(targetYm: string) {
    if (!targetYm) return;
    setMonthSaving(true);
    try {
      const issueDate = issueDateFor(targetYm);
      setHeader((h) => (h ? { ...h, issueDate } : h));
      await fetch("/api/bill-issuedate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, issueDate }),
      });
      invalidateBills(); // cached payload still carries the old issueDate
    } finally {
      setMonthSaving(false);
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

  // Load this bill's "Needs review" flag + note once, on open. Kept separate
  // from the main bill fetch so it doesn't ride the JobTread cache.
  useEffect(() => {
    let alive = true;
    fetch(`/api/bill-review?docId=${encodeURIComponent(docId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive || j?.error) return;
        setNeedsReview(Boolean(j.needsReview));
        setReviewNote(String(j.note ?? ""));
        setReviewFlaggedBy(String(j.flaggedBy ?? ""));
        setReviewFlaggedAt(String(j.flaggedAt ?? ""));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [docId]);

  // Set/clear the "Needs review" flag with the current note. Companion-local
  // (writes to saved_bills), never a JobTread write — works with writes OFF.
  async function saveReview(next: boolean) {
    setReviewSaving(true);
    setReviewMsg("");
    try {
      const res = await fetch("/api/bill-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, needsReview: next, note: reviewNote }),
      });
      const j = await res.json();
      if (!res.ok) {
        setReviewMsg(j?.error ?? "Couldn't save.");
        return;
      }
      setNeedsReview(next);
      if (!next) {
        setReviewNote("");
        setReviewFlaggedBy("");
        setReviewFlaggedAt("");
        setReviewMsg("Cleared.");
      } else {
        setReviewMsg("Flagged for review.");
      }
    } catch (e) {
      setReviewMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setReviewSaving(false);
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
    if (allLineChanges.length === 0 && !taxChanged && !needsTaxMigration) {
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
      // 2) Push the sales tax in the same Save. Also runs UNCHANGED on a bill
      //    still carrying the legacy document field: step 1 just wrote the
      //    de-taxed line costs, so the tax has to move onto its 88 80 00 line
      //    and the field has to be cleared, or the bill's total drops by the tax.
      if (taxChanged || needsTaxMigration) {
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
      setRestored(null);
      if (failed) {
        // Some lines didn't land, and the state on screen is about to be emptied
        // and re-read. Re-arm the restore rather than dropping the draft:
        // reconcileDraft removes everything JobTread has now taken, which leaves
        // exactly the changes that failed.
        restoreStartedRef.current = "";
        autosaveArmedRef.current = "";
      } else {
        discardDraft(billDraftKey(docId)); // it's in JobTread now
      }
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

  /**
   * The card's control object — this page's half of the shared contract.
   *
   * Every handler here already existed; none of them changed. What changed is
   * that the MARKUP they drive is now BillCodingCard's instead of a second copy
   * written out on this page. The adapters below exist only because the card
   * speaks `CodingLine` (the board's line shape) while this page's handlers were
   * written against its own `Line` — so each one looks the real line back up by
   * id rather than the two shapes being forced to converge.
   */
  const cardLines: CodingLine[] = codeableLines.map((l) => ({
    id: l.id,
    docId,
    billStatus: header?.status ?? "draft",
    name: l.name ?? "",
    cost: l.cost ?? 0,
    quantity: l.quantity,
    unitCost: l.unitCost,
    code: l.costCode?.number ?? "",
    codeName: l.costCode?.name ?? "",
    jobCostItemId: l.jobCostItem?.id ?? null,
  }));
  const lineById = (id: string) => codeableLines.find((l) => l.id === id);

  const codingCtl: CodingCardCtl = {
    bill: header
      ? {
          id: docId,
          label: title,
          cost: total,
          status: header.status,
          reviewed,
          // Left unset on purpose. `invoiced` makes the card read-only, and
          // /api/bill does not report whether this bill is on a customer
          // invoice — only the board's payload does. Editing here stays gated on
          // draft status alone (math.isDraft), exactly as this page always
          // gated it; claiming `false` would be asserting something unknown.
          jobPhase,
          number: header.number ?? null,
          issueDate: header.issueDate ?? null,
        }
      : null,
    lines: cardLines,
    math: { isDraft: linesEditable, subtotal, total, deTax, targets },
    jobId,
    c,
    writes,

    codeOptions: budget,
    leafOf: (l) => picked[l.id] ?? lineById(l.id)?.jobCostItem?.id ?? "",
    codeOf: (l) =>
      budget.find((o) => o.id === (picked[l.id] ?? lineById(l.id)?.jobCostItem?.id ?? ""))?.number ??
      "",
    // This page commits with its own Save bar, so a pick is staged in `picked`
    // exactly as it always was — the card does not know or care which.
    stageLine: (lineId, leafId) => setPicked((prev) => ({ ...prev, [lineId]: leafId })),
    staged: { has: (lineId) => picked[lineId] !== undefined },
    remainingFor: (code) => (code && ctc[code] ? ctc[code].remaining : null),
    bulkCode,
    setBulkCode,
    applyCodeToAll,

    edits,
    setLineEdit: (lineId, patch) =>
      setEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } })),

    taxEdit,
    storedTax,
    taxView,
    setTax: (v) => setTaxEdit(v),

    toggleReviewed: () => void toggleReviewed(),

    review: {
      flagged: needsReview,
      note: reviewNote,
      setNote: setReviewNote,
      save: (flagged) => void saveReview(flagged),
      saving: reviewSaving,
      msg: reviewMsg,
      by: reviewFlaggedBy,
      at: reviewFlaggedAt,
    },

    approveBill: writes ? () => void approveBill() : undefined,
    approvingBill: approving,
    approveBlocked: null,

    isCombinable: (l) => {
      const real = lineById(l.id);
      return real ? isCombinable(real) : false;
    },
    anyCombinable,
    combineSelected: selected,
    toggleCombineSel: toggleSel,
    combineCodeSet: selCodeSet,
    combineHasEdit: selHasEdit,
    canCombine,
    combining,
    combineRows: () => void combineRows(),
    combineMsg,

    buybackId,
    buybackLineById: (l, name, extended) => {
      const real = lineById(l.id);
      if (real) void buybackLineById(real, name, extended);
    },

    deletingLineId: deletingId,
    deleteLineById: (id, label) => void deleteLineById(id, label),
    // Empty on purpose: this page reports a failed delete through `saveMsg`, in
    // the banner under the header, which is where it has always appeared.
    deleteLineMsg: "",

    addingLine,
    setAddingLine,
    newLine,
    setNewLine,
    addLine: () => void addLine(),
    addLineSaving,
    addLineMsg,
    setAddLineMsg,

    files,
    filesLoading: loading,
    // This page IS the card — it scrolls, and its header already names the bill.
    standalone: true,
    // Not a sticky column here — the scan can be as tall as it wants.
    scanMaxHClass: "max-h-[70dvh]",

    billNumberDraft: billNumber,
    setBillNumberDraft: setBillNumber,
    saveBillNumber: () => void saveBillNumber(),
    billNumberSaving,
    monthOptions: billingMonths(),
    setBillingMonth,
    monthSaving,
    reassignJob: (j) => void reassignJob(j.id),
    reassigning,
    filingMsg: reassignMsg || billNumberMsg,
  };

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
          onClick={goBack}
          className="-ml-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-accent transition hover:bg-accent/10 dark:text-accent-soft"
        >
          ‹ Back
        </Link>
      </div>

      {/* Flagged for a billing correction — shown up top, and made loud on
          purpose (thick red edge, uppercase heading) so it's the first thing
          seen without scrolling to the coding panel, where the note and its
          controls live. */}
      {needsReview && (
        <Banner tone="warning" className="mt-3 !py-2.5">
          <span aria-hidden className="mr-1.5">
            ⚑
          </span>
          <b>Needs review</b> — {reviewNote ? reviewNote : "flagged for a billing correction."}
        </Banner>
      )}

      {/* Queue pager: a three-up bar, so the arrows are thumb-sized targets and
          the position reads between them. */}
      {/* Queue pager. Two 44px arrows and the position between them, rather
          than two full-width outlined buttons: the pager is a navigation aid,
          not the page's action, and drawing it as two of the biggest controls
          on screen made it compete with Save for the eye. Same targets, a
          fraction of the ink. */}
      {qIdx >= 0 && queue.length > 1 && (
        <nav aria-label="Coding queue" className="mt-2 flex items-center justify-end gap-0.5">
          <span className="mr-auto text-xs font-semibold tabular-nums text-neutral-500 dark:text-neutral-400">
            Bill {qIdx + 1} of {queue.length}
          </span>
          {prevId ? (
            <Link
              href={`/bill/${prevId}?jobId=${encodeURIComponent(jobId)}${navContext}`}
              onClick={() => driveMainWindowToDoc(jobId, prevId)}
              aria-label="Previous bill"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl leading-none text-accent transition hover:bg-accent/10 dark:text-accent-soft"
            >
              ‹
            </Link>
          ) : (
            <span
              aria-hidden
              className="inline-flex h-11 w-11 items-center justify-center text-xl leading-none text-neutral-300 dark:text-neutral-700"
            >
              ‹
            </span>
          )}
          {nextId ? (
            <Link
              href={`/bill/${nextId}?jobId=${encodeURIComponent(jobId)}${navContext}`}
              onClick={() => driveMainWindowToDoc(jobId, nextId)}
              aria-label="Next bill"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl leading-none text-accent transition hover:bg-accent/10 dark:text-accent-soft"
            >
              ›
            </Link>
          ) : (
            <span
              aria-hidden
              className="inline-flex h-11 w-11 items-center justify-center text-xl leading-none text-neutral-300 dark:text-neutral-700"
            >
              ›
            </span>
          )}
        </nav>
      )}

      <header className="mb-5 mt-4">
        <PageTitle>{title}</PageTitle>
        {/* Status, the saved marker and the document's own identifiers are all
            metadata about the same thing, so they share one wrapping strip
            under the title rather than stacking as separate rows. */}
        {/* One quiet strip of metadata, not a row of pills. Status, the saved
            marker, the date and the id are all the same KIND of fact — "what
            this document is" — so they read as one line of small text, and the
            only thing that keeps a coloured chip is the flag, which is the one
            thing here that means act on it. */}
        <MetaLine
          className="mt-2"
          items={[
            needsReview && (
              <Chip
                key="flag"
                tone="danger"
                title="Flagged for a billing correction — see the note above"
              >
                ⚑ Needs review
              </Chip>
            ),
            header?.status && <BillStatusBadge key="status" status={header.status} />,
            saved && !reviewed && (
              <span
                key="saved"
                title="Save has been clicked on this bill"
                className="font-semibold text-emerald-700 dark:text-emerald-400"
              >
                ✓ Saved
              </span>
            ),
            header?.issueDate,
            <span key="id" className="font-mono">
              {docId}
            </span>,
          ]}
        />

        {/* The total is the number checked on every single bill, so it leads at
            display size in tabular figures. The tax that makes it up is NOT
            here — it sits in the totals block under the line items, where a
            paper invoice puts it. */}
        {lines && (
          <StatementBlock
            className="mt-4"
            label="Bill total"
            value={money(total)}
            sub={`${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
          />
        )}

        {saveMsg && (
          <Banner tone="neutral" className="mt-3 !px-3 !py-2.5 !text-xs">
            {saveMsg}
          </Banner>
        )}

        {/* Unsaved coding on this bill came back. Said out loud rather than
            restored silently: the figures below now include changes JobTread
            doesn't have, and Save is what sends them. */}
        {restored && (
          <Banner tone="info" className="mt-3 !px-3 !py-2.5 !text-xs">
            <div className="flex items-center justify-between gap-2">
              <span>
                Restored {restored.kept} unsaved change{restored.kept === 1 ? "" : "s"} from{" "}
                {draftSavedAtLabel(restored.savedAt)}
                {restored.dropped > 0 && <> · {restored.dropped} no longer applied</>}. Nothing is
                in JobTread until you Save.
              </span>
              <button
                type="button"
                onClick={() => setRestored(null)}
                className="shrink-0 underline underline-offset-2 opacity-80 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
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

      {/* THE CODING PANEL — the SAME component the Tracking Sheets workbench
          shows in its right-hand column (BillCodingCard). This page used to
          hand-write its own copy of it: two implementations of one bill, ~480
          lines each, that had to be fixed twice and had already drifted three
          ways (per-line headroom, the needs-review flag, and a billing-month
          picker whose option values did not match the board's, so the same
          Select showed the month on one surface and blank on the other).

          The page keeps what is genuinely page chrome — the title, the status
          badge, the bill total, the sticky Save bar and the tracking-sheet push
          — and the card carries the bill itself: the lines, the coding, the
          scan, the Drive backup, Filing and the needs-review flag. `writes` and
          the commit stay this page's business, exactly as they are the board's:
          the card owns no write of its own. */}
      {lines && (
        <>
          {/* The preview warning qualifies the whole panel, so it sits above
              it. */}
          {!writes && (
            <Banner tone="warning" className="mb-3 !px-3 !py-2.5 !text-xs">
              Writes are OFF (COMPANION_WRITES_ENABLED not <span className="font-mono">true</span> on
              this deploy). Save shows a preview and sends nothing to JobTread. Set it in Vercel and{" "}
              <b>redeploy</b>.
            </Banner>
          )}
          <BillCodingCard ctl={codingCtl} />
        </>
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
              </div>

              {/* "Mark reviewed" and the "Needs review" flag both used to sit here
                  as well as in the coding panel. They are the panel's now — one
                  bill, one place to say something about it — and this drawer
                  keeps only what is genuinely the PAGE's: the way out to
                  JobTread, the tracking-sheet push, and Save. */}

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
                  monthLabel={monthLabel(header.issueDate.slice(0, 7))}
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
                    setRestored(null);
                    // Discard is the office saying "I don't want this work" — so
                    // the saved draft goes with it, on every device.
                    discardDraft(billDraftKey(docId));
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
