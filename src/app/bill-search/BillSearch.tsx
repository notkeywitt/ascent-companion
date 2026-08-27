"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PageHeader,
  Input,
  Card,
  Chip,
  Banner,
  Button,
  EmptyState,
  Loading,
  SectionLabel,
} from "@/components/ui";

/**
 * The Bill Search screen.
 *
 * Search is instant: every keystroke (debounced) hits /api/bill-search, which
 * answers from the local FTS index — never JobTread live. Two background chores
 * keep that index honest without ever blocking a search:
 *  - FIRST RUN. When the index is empty, an admin taps "Build the index": the
 *    browser drives the one-time pre-JobTread seed page-by-page, then a live
 *    JobTread sweep. (Driving it from the browser is what lets each server
 *    request stay short enough for Vercel.)
 *  - STALE. When a search reports the live half is older than the freshness
 *    window, we kick a single background refresh and quietly re-run the query
 *    once it lands. Results shown meanwhile are simply a little old, never slow.
 */

interface Line {
  lineId: string;
  description: string;
  csi: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

interface Result {
  id: number;
  source: "jobtread" | "sheet";
  jtDocId: string;
  expId: string;
  vendor: string;
  invoiceId: string;
  billNumber: string;
  amount: number;
  status: string;
  issueDate: string;
  jobId: string;
  jobName: string;
  customer: string;
  pdfFileId: string;
  isSunset: boolean;
  lines: Line[];
  matchedLines: Line[];
}

interface IndexStatus {
  billCount: number;
  lastRefreshAt: string | null;
  stale: boolean;
  refreshing: boolean;
  seedDone: boolean;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A JobTread bill opens in the in-app bill view; the jobId lets it load fast. */
const billHref = (r: Result) =>
  `/bill/${encodeURIComponent(r.jtDocId)}${r.jobId ? `?jobId=${encodeURIComponent(r.jobId)}` : ""}`;

/** A pre-JobTread bill has no JobTread doc — open its archived PDF in Drive. */
const driveHref = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;

/** "How long ago" in plain words, for the footer's last-updated line. */
function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "never";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Bold the searched terms inside a line of text. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        terms.some((t) => t.toLowerCase() === p.toLowerCase()) ? (
          <mark key={i} className="rounded bg-accent/20 px-0.5 text-inherit">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function BillSearch({ initialQuery = "" }: { initialQuery?: string }) {
  // Seeded from ?q= so arriving from the header's global search opens this page
  // already showing the same search, in full.
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Result[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<IndexStatus | null>(null);

  // First-run seed/refresh progress (the "Build the index" flow).
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState("");

  const refreshingRef = useRef(false); // guards the stale-triggered background refresh
  const lastQueryRef = useRef("");

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/bill-search");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to read index status");
      setStatus(j.status as IndexStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read index status");
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  /** Rebuild the live half in the background, then re-run the current query. */
  const backgroundRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setStatus((s) => (s ? { ...s, refreshing: true } : s));
    try {
      await fetch("/api/bill-search/refresh", { method: "POST" });
      await loadStatus();
      // Re-run whatever the box currently holds so fresh bills appear.
      if (lastQueryRef.current.trim()) await runSearch(lastQueryRef.current);
    } catch {
      /* leave the stale results up; the next search will try again */
    } finally {
      refreshingRef.current = false;
      setStatus((s) => (s ? { ...s, refreshing: false } : s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStatus]);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      lastQueryRef.current = q;
      if (!trimmed) {
        setResults(null);
        setSearching(false);
        return;
      }
      setSearching(true);
      setError(null);
      try {
        const r = await fetch(`/api/bill-search?q=${encodeURIComponent(trimmed)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Search failed");
        setResults(j.results as Result[]);
        setStatus(j.status as IndexStatus);
        // If the live half has gone stale, refresh it once in the background.
        if (j.status?.stale && !j.status?.refreshing) void backgroundRefresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [backgroundRefresh],
  );

  // Debounce the box so we search on a pause, not on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 250);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  /** One-time (or on-demand) full build: seed the history, then sweep JobTread. */
  const buildIndex = useCallback(async () => {
    setBuilding(true);
    setError(null);
    try {
      // Seed the pre-JobTread history, page by page, until done.
      let offset = 0;
      let guard = 0;
      for (;;) {
        setBuildNote(`Importing history… ${offset.toLocaleString()} rows scanned`);
        const r = await fetch("/api/bill-search/seed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ offset }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "History import failed");
        if (j.done || ++guard > 100) break;
        offset = j.nextOffset;
      }
      // Then pull everything currently in JobTread.
      setBuildNote("Loading current JobTread bills…");
      const rr = await fetch("/api/bill-search/refresh", { method: "POST" });
      const jj = await rr.json();
      if (!rr.ok) throw new Error(jj.error || "JobTread sweep failed");
      setBuildNote("");
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setBuilding(false);
    }
  }, [loadStatus]);

  const empty = status !== null && status.billCount === 0;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Bill Search"
        description="Search every bill and line item — a material like “2x4”, a vendor, or an invoice number."
      />

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {/* First-run / empty-index setup. */}
      {empty && !building && (
        <Card className="mb-4">
          <SectionLabel>Search index is empty</SectionLabel>
          <p className="mt-1 text-sm text-neutral-500">
            Build it once to import the pre-JobTread history and load every current JobTread bill.
            This can take a few minutes; you can leave the page open while it runs.
          </p>
          <Button className="mt-3" onClick={buildIndex}>
            Build the index
          </Button>
        </Card>
      )}

      {building && (
        <Card className="mb-4">
          <Loading label={buildNote || "Building the search index…"} />
        </Card>
      )}

      {!empty && (
        <div className="mb-3">
          <Input
            type="search"
            inputMode="search"
            autoFocus
            placeholder="Search bills & line items…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search bills and line items"
          />
        </div>
      )}

      {status?.refreshing && (
        <p className="mb-3 text-[11px] text-neutral-400">Updating with the latest JobTread bills…</p>
      )}

      {searching && !results && <Loading label="Searching…" />}

      {results && results.length === 0 && query.trim() && !searching && (
        <EmptyState>No bills or line items match “{query.trim()}”.</EmptyState>
      )}

      {results && results.length > 0 && (
        <>
          <p className="mb-2 text-[11px] text-neutral-400">
            {results.length}
            {results.length === 200 ? "+" : ""} match{results.length === 1 ? "" : "es"}
          </p>
          <div className="flex flex-col gap-3">
            {results.map((r) => (
              <ResultCard key={r.id} r={r} terms={terms} />
            ))}
          </div>
        </>
      )}

      {/* Footer: index freshness + manual controls. */}
      {status && !empty && (
        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[11px] text-neutral-400">
          <span>
            {status.billCount.toLocaleString()} bills indexed · updated {ago(status.lastRefreshAt)}
          </span>
          <button
            type="button"
            className="font-semibold text-accent hover:underline disabled:opacity-50"
            onClick={() => void backgroundRefresh()}
            disabled={status.refreshing}
          >
            Refresh now
          </button>
          {!status.seedDone && (
            <button
              type="button"
              className="font-semibold text-accent hover:underline disabled:opacity-50"
              onClick={buildIndex}
              disabled={building}
            >
              Import history
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function ResultCard({ r, terms }: { r: Result; terms: string[] }) {
  const href = r.source === "jobtread" && r.jtDocId ? billHref(r) : r.pdfFileId ? driveHref(r.pdfFileId) : null;
  const external = r.source !== "jobtread";
  const shown = (r.matchedLines.length ? r.matchedLines : r.lines).slice(0, 4);
  const moreLines = (r.matchedLines.length ? r.matchedLines : r.lines).length - shown.length;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">
            <Highlight text={r.vendor} terms={terms} />
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-neutral-500">
            {[r.jobName || r.customer, r.issueDate].filter(Boolean).join(" · ") || "No job / date"}
            {r.invoiceId ? (
              <>
                {" · #"}
                <Highlight text={r.invoiceId} terms={terms} />
              </>
            ) : null}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">{money(r.amount)}</p>
          <div className="mt-0.5 flex items-center justify-end gap-1">
            {r.source === "sheet" ? (
              <Chip tone="neutral" title="Pre-JobTread record from the sheet archive">
                Historical
              </Chip>
            ) : r.status ? (
              <Chip tone={r.status === "approved" ? "success" : "info"}>{r.status}</Chip>
            ) : null}
            {r.isSunset && <Chip tone="warning">Sunset</Chip>}
          </div>
        </div>
      </div>

      {shown.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-line-soft pt-2">
          {shown.map((l) => (
            <li key={l.lineId} className="flex items-baseline gap-2 text-[11.5px] text-neutral-500">
              {l.csi && <span className="shrink-0 tabular-nums text-neutral-400">{l.csi}</span>}
              <span className="min-w-0 flex-1 truncate">
                <Highlight text={l.description || "(no description)"} terms={terms} />
              </span>
              {!!l.amount && <span className="shrink-0 tabular-nums">{money(l.amount)}</span>}
            </li>
          ))}
          {moreLines > 0 && (
            <li className="text-[11px] text-neutral-400">+{moreLines} more line{moreLines === 1 ? "" : "s"}</li>
          )}
        </ul>
      )}

      {r.isSunset && (
        <a
          href="/payments"
          className="mt-2 inline-block text-[11px] font-semibold text-accent hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Sunset statements →
        </a>
      )}
    </>
  );

  if (!href) return <Card>{body}</Card>;

  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="group block rounded-xl border border-line bg-white p-4 transition hover:border-accent/40 hover:shadow-sm dark:bg-ink-raised"
    >
      {body}
    </a>
  );
}
