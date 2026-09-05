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
  /**
   * How to NAME this work on the "unfinished" list — "Harper Residence · August",
   * "Ferguson Plumbing · 44821". Written by whichever screen staged it, because
   * only that screen knows: the list is read from storage alone and has no job or
   * bill to look the name up from. Optional, and the list falls back to the key,
   * so a draft written by an older build still shows up rather than vanishing.
   */
  label?: string;
  /** costItemId → the budget leaf it's been staged onto. */
  staged: Record<string, string>;
  /** costItemId → in-flight description / qty / unit-cost text. */
  edits: Record<string, LineEdit>;
  /** docId → in-flight sales-tax text. */
  taxEdits: Record<string, string>;
  /**
   * timeEntryId → the budget leaf it's been staged onto — the labor half of the
   * board's staged work, which rides the same Sync as the bill lines and so
   * must survive the same accidents. Optional: the bill-scoped surfaces stage no
   * labor, and a draft written before this existed simply has none.
   */
  timeStaged?: Record<string, string>;
}

/** The editable half of a draft — what a caller hands in to be saved. */
export type DraftParts = Pick<CodingDraft, "staged" | "edits" | "taxEdits" | "timeStaged">;

/** The job workbench: one job, one billing month. */
export const jobDraftKey = (jobId: string, ym: string) => `job:${jobId}:${ym}`;
/** The needs-coding queue / all-bills panel: one bill, wherever it was reached from. */
export const billDraftKey = (docId: string) => `bill:${docId}`;

/** True when there is nothing staged — an empty draft is deleted, not stored. */
export function isEmptyDraft(parts: DraftParts): boolean {
  return draftSize(parts) === 0;
}

/** How many distinct staged changes a draft carries, for the restore banner. */
export function draftSize(parts: DraftParts): number {
  return (
    Object.keys(parts.staged).length +
    Object.keys(parts.edits).length +
    Object.keys(parts.taxEdits).length +
    Object.keys(parts.timeStaged ?? {}).length
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
  /**
   * Every bill on screen with the sales tax it currently carries — the 88 80 00
   * line plus any legacy `nonRecoverableTax`, already resolved by the caller.
   */
  bills: readonly { id: string; salesTax?: number }[];
  /** The budget leaves a line — or a time entry — may legally be coded to. */
  budgetIds: readonly string[];
  /** The month's time entries, for a draft that staged labor recodes. */
  timeEntries?: readonly { id: string; costItemId?: string | null }[];
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

  const timeById = new Map((world.timeEntries ?? []).map((t) => [t.id, t]));
  const timeStaged: Record<string, string> = {};
  for (const [entryId, leafId] of Object.entries(draft.timeStaged ?? {})) {
    const entry = timeById.get(entryId);
    if (!entry || !leaves.has(leafId) || (entry.costItemId ?? "") === leafId) {
      dropped++;
      continue;
    }
    timeStaged[entryId] = leafId;
  }

  for (const [docId, value] of Object.entries(draft.taxEdits)) {
    const bill = billById.get(docId);
    if (!bill || value === "" || round2(Number(value) || 0) === round2(bill.salesTax ?? 0)) {
      dropped++;
      continue;
    }
    taxEdits[docId] = value;
  }

  const kept = draftSize({ staged, edits, taxEdits, timeStaged });
  return { staged, edits, taxEdits, timeStaged, kept, dropped };
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
      label: typeof d.label === "string" ? d.label : undefined,
      staged: (d.staged ?? {}) as Record<string, string>,
      edits: (d.edits ?? {}) as Record<string, LineEdit>,
      taxEdits: (d.taxEdits ?? {}) as Record<string, string>,
      timeStaged: (d.timeStaged ?? {}) as Record<string, string>,
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

export function writeLocalDraft(
  key: string,
  parts: DraftParts,
  label?: string,
): CodingDraft | null {
  const store = ls();
  if (isEmptyDraft(parts)) {
    store?.removeItem(LS_PREFIX + key);
    return null;
  }
  const draft: CodingDraft = { key, savedAt: new Date().toISOString(), label, ...parts };
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
export function saveDraft(key: string, parts: DraftParts, label?: string) {
  const draft = writeLocalDraft(key, parts, label);
  queueServerPush(key, draft);
}

/** Forget a scope's draft everywhere. Called after a successful Sync, and on Revert. */
export function discardDraft(key: string) {
  clearLocalDraft(key);
  queueServerPush(key, null);
  flushDrafts(false); // a discard shouldn't sit in the debounce
}

// ---------------------------------------------------------------------------
// THE UNFINISHED LIST — every scope still holding work, across both layers
// ---------------------------------------------------------------------------

/** One row of the "you left work unfinished" list. */
export interface DraftSummary {
  key: string;
  /** "job" — a job-month on the board · "bill" — one bill's coding. */
  kind: "job" | "bill";
  /** What the screen that staged it called it, or the key when it predates labels. */
  label: string;
  savedAt: string;
  /** How many staged changes it holds. */
  count: number;
  /** Where to go to finish it. */
  href: string;
  /** True when only the SERVER had it — work left on another device. */
  elsewhere: boolean;
}

/**
 * Read a scope key back into somewhere to go.
 *
 * Job ids never contain a colon, but this parses from the ENDS anyway (kind
 * before the first, month after the last) rather than splitting into three: a
 * key that ever grew a colon in the middle would otherwise send somebody to the
 * wrong job, and quietly.
 */
export function describeDraft(draft: CodingDraft, fromServerOnly = false): DraftSummary | null {
  const key = draft.key ?? "";
  const count = draftSize(draft);
  if (count === 0) return null; // an empty draft is not unfinished work
  const base = {
    key,
    label: draft.label?.trim() || key,
    savedAt: draft.savedAt,
    count,
    elsewhere: fromServerOnly,
  };
  if (key.startsWith("bill:")) {
    const docId = key.slice("bill:".length);
    if (!docId) return null;
    return { ...base, kind: "bill", href: `/bill/${encodeURIComponent(docId)}` };
  }
  if (key.startsWith("job:")) {
    const rest = key.slice("job:".length);
    const cut = rest.lastIndexOf(":");
    if (cut <= 0) return null;
    const jobId = rest.slice(0, cut);
    const ym = rest.slice(cut + 1);
    return {
      ...base,
      kind: "job",
      href: `/trackingsheet?jobId=${encodeURIComponent(jobId)}&ym=${encodeURIComponent(ym)}`,
    };
  }
  return null; // an unknown scope — nowhere to send anyone, so don't offer it
}

/**
 * Every scope still holding unfinished work, newest first — this device's
 * drafts merged with the ones the companion DB is keeping.
 *
 * The merge is the whole point: a draft that exists ONLY on the server is work
 * left on ANOTHER device, which is exactly what the office can't otherwise see.
 * Local wins a tie because it is written on every change and the mirror trails
 * it, and the survivors are marked `elsewhere` so the list can say where the
 * work is waiting.
 */
export async function listDrafts(): Promise<DraftSummary[]> {
  const local = listLocalDrafts();
  const byKey = new Map<string, DraftSummary>();
  for (const d of local) {
    const row = describeDraft(d);
    if (row) byKey.set(row.key, row);
  }
  try {
    const res = await fetch("/api/coding-draft?all=1", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { drafts?: CodingDraft[] };
      for (const d of json.drafts ?? []) {
        if (!d?.key || byKey.has(d.key)) continue; // this device already has it, and newer
        if (draftAgeDays(d) > DRAFT_TTL_DAYS) continue;
        const row = describeDraft(d, true);
        if (row) byKey.set(row.key, row);
      }
    }
  } catch {
    /* offline — the local half still answers, which is the half that matters here */
  }
  return [...byKey.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
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
