import { round2, type LineEdit } from "@/lib/billLineMath";

/**
 * DURABLE CODING DRAFTS — staged coding work that survives leaving the page.
 *
 * THE PROBLEM. Tracking Sheets is deliberately "staged, not saved": a recode
 * moves the on-screen budget math and nothing else, and JobTread is written only
 * when you press Sync. That is what makes "try moving this and see what it does"
 * cheap — but it also meant the staged work lived in React state and nowhere
 * else, so anything that unmounted the page threw it away. A confirm dialog was
 * the only guard, and a dialog can't help you when a phone evicts the tab, the
 * browser is force-quit, the battery dies, or the OK button is the one you meant
 * to press.
 *
 * WHY NOT AUTO-SYNC TO JOBTREAD. Because half-finished coding is a real write to
 * the live org, and one the hourly appscript mirror would then carry into the
 * Sheet and the Drive tree. The staged model is the safety, not the bug. So the
 * autosave is here — the DECISION is saved continuously; pressing Sync stays the
 * only thing that writes to JobTread.
 *
 * TWO LAYERS, on purpose:
 *
 *   1. localStorage, written on every change. Synchronous, offline, and still
 *      there after a crash or a force-quit. This is the one that actually
 *      catches the accident, so nothing about a restore waits on the network.
 *   2. The companion DB (`/api/coding-draft`), pushed best-effort a couple of
 *      seconds behind. This is what makes the work follow you to another device
 *      — code a bill on the phone, finish it at the desk — and what survives a
 *      cleared browser. It is a BACKUP: local always wins a restore, because
 *      local is never behind.
 *
 * A draft is scoped to what the screen is editing — one job-month on the board,
 * one bill in the needs-coding queue (see `jobDraftKey` / `billDraftKey`) — so
 * switching bills keeps every bill's work instead of discarding it.
 *
 * RESTORING IS RECONCILED, NEVER BLIND. JobTread moves while a draft sits: a
 * line gets combined away, a colleague codes the bill, a budget leaf is deleted.
 * `reconcileDraft` re-tests every staged change against the data that just
 * loaded and keeps only what still means something — see its own note.
 */

/** How long an untouched draft is kept before it's treated as abandoned. */
export const DRAFT_TTL_DAYS = 21;

const LS_PREFIX = "ascent.codingDraft.v1.";
/** How long to sit on changes before mirroring them to the companion DB. */
const SERVER_DEBOUNCE_MS = 2000;

/** The staged work for one scope — exactly the three pieces the board holds. */
export interface CodingDraft {
  /** The scope this belongs to: see jobDraftKey / billDraftKey. */
  key: string;
  /** ISO timestamp of the last change, for the "restored from…" line. */
  savedAt: string;
  /** costItemId → the budget leaf it's been staged onto. */
  staged: Record<string, string>;
  /** costItemId → in-flight description / qty / unit-cost text. */
  edits: Record<string, LineEdit>;
  /** docId → in-flight sales-tax text. */
  taxEdits: Record<string, string>;
}

/** The editable half of a draft — what a caller hands in to be saved. */
export type DraftParts = Pick<CodingDraft, "staged" | "edits" | "taxEdits">;

/** The job workbench: one job, one billing month. */
export const jobDraftKey = (jobId: string, ym: string) => `job:${jobId}:${ym}`;
/** The needs-coding queue / all-bills panel: one bill, wherever it was reached from. */
export const billDraftKey = (docId: string) => `bill:${docId}`;

/** True when there is nothing staged — an empty draft is deleted, not stored. */
export function isEmptyDraft(parts: DraftParts): boolean {
  return (
    Object.keys(parts.staged).length === 0 &&
    Object.keys(parts.edits).length === 0 &&
    Object.keys(parts.taxEdits).length === 0
  );
}

/** How many distinct staged changes a draft carries, for the restore banner. */
export function draftSize(parts: DraftParts): number {
  return (
    Object.keys(parts.staged).length +
    Object.keys(parts.edits).length +
    Object.keys(parts.taxEdits).length
  );
}

/** True when this edit has any typed content — an all-empty one is not a change. */
function editHasContent(e: LineEdit | undefined): e is LineEdit {
  if (!e) return false;
  return [e.name, e.quantity, e.unitCost].some((v) => v !== undefined && v !== "");
}

/**
 * When a draft was last touched, in the words the office would use: a time for
 * today, "yesterday", a date beyond that. Device-local on purpose — this is
 * "when did I do this", not a billing date, so the org timezone would be the
 * wrong answer for anyone travelling.
 */
export function draftSavedAtLabel(iso: string, now = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "earlier";
  const then = new Date(t);
  const time = then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (t >= midnight.getTime()) return time;
  if (t >= midnight.getTime() - 86_400_000) return `yesterday, ${time}`;
  return `${then.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** Age in days, or Infinity for a draft with an unreadable timestamp. */
export function draftAgeDays(draft: Pick<CodingDraft, "savedAt">, now = Date.now()): number {
  const t = Date.parse(draft.savedAt);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now - t) / 86_400_000;
}

// ---------------------------------------------------------------------------
// RECONCILE — the only part with real judgement in it, and so the tested part
// ---------------------------------------------------------------------------

/** What the page knows RIGHT NOW, from the fetch that just landed. */
export interface DraftWorld {
  /** Every line currently on screen, with the leaf JobTread has it coded to. */
  lines: readonly { id: string; jobCostItemId?: string | null }[];
  /** Every bill on screen, with the sales tax JobTread currently stores. */
  bills: readonly { id: string; nonRecoverableTax?: number }[];
  /** The budget leaves a line may legally be coded to. */
  budgetIds: readonly string[];
}

export interface Reconciled extends DraftParts {
  /** Staged changes kept — what the restore is worth. */
  kept: number;
  /** Staged changes dropped because JobTread has moved on. */
  dropped: number;
}

/**
 * Re-test a stored draft against the data that just loaded, keeping only what
 * still says something. Four ways a staged change stops meaning anything:
 *
 *   - its line is gone (combined away, deleted, the bill re-filed elsewhere);
 *   - its target budget leaf is gone (the budget was restructured);
 *   - JobTread ALREADY has the line on that leaf — somebody else, or an earlier
 *     partly-failed Sync, has since done it. Restoring it would leave the page
 *     looking dirty with nothing to write;
 *   - a tax edit that now matches the stored tax, for the same reason.
 *
 * Dropping is deliberately quiet in the math and loud in the count: the banner
 * reports how many were dropped, so a restore that lost half its work says so
 * instead of pretending it was whole.
 */
export function reconcileDraft(draft: DraftParts, world: DraftWorld): Reconciled {
  const lineById = new Map(world.lines.map((l) => [l.id, l]));
  const billById = new Map(world.bills.map((b) => [b.id, b]));
  const leaves = new Set(world.budgetIds);

  const staged: Record<string, string> = {};
  const edits: Record<string, LineEdit> = {};
  const taxEdits: Record<string, string> = {};
  let dropped = 0;

  for (const [lineId, leafId] of Object.entries(draft.staged)) {
    const line = lineById.get(lineId);
    if (!line || !leaves.has(leafId) || (line.jobCostItemId ?? "") === leafId) {
      dropped++;
      continue;
    }
    staged[lineId] = leafId;
  }

  for (const [lineId, edit] of Object.entries(draft.edits)) {
    if (!lineById.has(lineId) || !editHasContent(edit)) {
      dropped++;
      continue;
    }
    edits[lineId] = edit;
  }

  for (const [docId, value] of Object.entries(draft.taxEdits)) {
    const bill = billById.get(docId);
    if (!bill || value === "" || round2(Number(value) || 0) === round2(bill.nonRecoverableTax ?? 0)) {
      dropped++;
      continue;
    }
    taxEdits[docId] = value;
  }

  return { staged, edits, taxEdits, kept: draftSize({ staged, edits, taxEdits }), dropped };
}

// ---------------------------------------------------------------------------
// LOCAL STORAGE — layer 1. Synchronous, so it is never mid-flight in a crash.
// ---------------------------------------------------------------------------

/** Every access is wrapped: private mode and a full quota both throw. */
function ls(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseDraft(raw: string | null): CodingDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<CodingDraft>;
    if (!d || typeof d !== "object") return null;
    return {
      key: typeof d.key === "string" ? d.key : "",
      savedAt: typeof d.savedAt === "string" ? d.savedAt : "",
      staged: (d.staged ?? {}) as Record<string, string>,
      edits: (d.edits ?? {}) as Record<string, LineEdit>,
      taxEdits: (d.taxEdits ?? {}) as Record<string, string>,
    };
  } catch {
    return null; // a truncated write from a killed tab — treat as no draft
  }
}

export function readLocalDraft(key: string): CodingDraft | null {
  const store = ls();
  if (!store) return null;
  const draft = parseDraft(store.getItem(LS_PREFIX + key));
  if (!draft) return null;
  if (draftAgeDays(draft) > DRAFT_TTL_DAYS) {
    store.removeItem(LS_PREFIX + key);
    return null;
  }
  return draft;
}

export function writeLocalDraft(key: string, parts: DraftParts): CodingDraft | null {
  const store = ls();
  if (isEmptyDraft(parts)) {
    store?.removeItem(LS_PREFIX + key);
    return null;
  }
  const draft: CodingDraft = { key, savedAt: new Date().toISOString(), ...parts };
  try {
    store?.setItem(LS_PREFIX + key, JSON.stringify(draft));
  } catch {
    /* quota — the server mirror below is the remaining safety net */
  }
  return draft;
}

export function clearLocalDraft(key: string) {
  ls()?.removeItem(LS_PREFIX + key);
}

/** Every draft this device is holding, newest first, expired ones swept. */
export function listLocalDrafts(): CodingDraft[] {
  const store = ls();
  if (!store) return [];
  const out: CodingDraft[] = [];
  const stale: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k || !k.startsWith(LS_PREFIX)) continue;
    const draft = parseDraft(store.getItem(k));
    if (!draft || draftAgeDays(draft) > DRAFT_TTL_DAYS) stale.push(k);
    else out.push(draft);
  }
  for (const k of stale) store.removeItem(k);
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

// ---------------------------------------------------------------------------
// SERVER MIRROR — layer 2. Best-effort throughout: it can only ADD safety.
// ---------------------------------------------------------------------------

/** key → the draft still waiting to be pushed, and its timer. */
const pending = new Map<string, CodingDraft | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function pushOne(key: string, draft: CodingDraft | null, keepalive = false) {
  try {
    if (draft) {
      await fetch("/api/coding-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, draft }),
        keepalive,
      });
    } else {
      await fetch(`/api/coding-draft?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
        keepalive,
      });
    }
  } catch {
    /* offline or signed out — localStorage still holds the work */
  }
}

/**
 * Send everything queued. Called on the debounce, and again from `pagehide` —
 * the unload path uses `keepalive` so a push started as the tab closes is still
 * delivered by the browser.
 */
export function flushDrafts(keepalive = false) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = [...pending.entries()];
  pending.clear();
  for (const [key, draft] of batch) void pushOne(key, draft, keepalive);
}

function queueServerPush(key: string, draft: CodingDraft | null) {
  pending.set(key, draft);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushDrafts(false), SERVER_DEBOUNCE_MS);
}

// One listener for the module, not one per page: a tab being hidden or closed is
// the exact moment the debounce would otherwise swallow the last few seconds of
// work. `pagehide` fires on mobile Safari's back-forward cache path too, which
// `beforeunload` does not.
if (typeof window !== "undefined") {
  const flushNow = () => flushDrafts(true);
  window.addEventListener("pagehide", flushNow);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
}

/**
 * Save the staged work for one scope. Local first and synchronously — that half
 * has landed by the time this returns — then queued for the companion DB.
 */
export function saveDraft(key: string, parts: DraftParts) {
  const draft = writeLocalDraft(key, parts);
  queueServerPush(key, draft);
}

/** Forget a scope's draft everywhere. Called after a successful Sync, and on Revert. */
export function discardDraft(key: string) {
  clearLocalDraft(key);
  queueServerPush(key, null);
  flushDrafts(false); // a discard shouldn't sit in the debounce
}

/**
 * The draft to restore for a scope. Local wins when it exists — it is written on
 * every keystroke, so it can only be newer than the mirror. The server is asked
 * only when this device has nothing, which is the cross-device case.
 */
export async function loadDraft(key: string): Promise<CodingDraft | null> {
  const local = readLocalDraft(key);
  if (local) return local;
  try {
    const res = await fetch(`/api/coding-draft?key=${encodeURIComponent(key)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { draft?: CodingDraft | null };
    const draft = json.draft ?? null;
    if (!draft || draftAgeDays(draft) > DRAFT_TTL_DAYS) return null;
    return draft;
  } catch {
    return null;
  }
}
