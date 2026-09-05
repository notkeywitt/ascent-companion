"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { inputCls } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { AREAS } from "@/lib/nav";

/**
 * The app's one search box — the widest item in the header row.
 *
 * It replaces TWO separate things: the launcher's "search N pages" field (which
 * only existed on the home page, and also matched vendor names and offered a
 * bill-number lookup) and the standalone Bill Search page's box. Those answered
 * the same question — "take me to the thing I'm thinking of" — from different
 * places, so you had to know which page to be on before you could ask. Here it
 * is chrome: every page can be searched from every page.
 *
 * FOUR KINDS OF ANSWER, cheapest first, each self-hiding and view-gated:
 *  - PAGES    — client-side over lib/nav's AREAS. Free, instant, always there.
 *  - VENDORS  — client-side over the cached /api/vendors name list.
 *  - BILLS    — debounced /api/bill-search: vendors, invoice numbers AND line
 *               item text ("2x4"), out of the local index. The only network
 *               call per keystroke, and only for roles with the view.
 *  - BILL #   — a digits-only query offers the org-wide number lookup as a row
 *               rather than firing it automatically.
 *
 * Results render in an overlay panel so the page underneath never reflows, and
 * the panel closes on Escape, on an outside click, and on navigating.
 */

/** Magnifier — matches the mark the launcher's field used to carry. */
function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

interface BillLine {
  lineId: string;
  description: string;
  csi: string;
  amount: number;
}

interface BillHit {
  id: number;
  source: "jobtread" | "sheet";
  jtDocId: string;
  vendor: string;
  invoiceId: string;
  amount: number;
  issueDate: string;
  jobId: string;
  jobName: string;
  pdfFileId: string;
  matchedLines: BillLine[];
  lines: BillLine[];
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** How many of each kind to show — the panel is a shortlist, not a report. */
const MAX_PAGES = 6;
const MAX_VENDORS = 4;
const MAX_BILLS = 6;

export function GlobalSearch() {
  const pathname = usePathname();
  const search = useSearchParams();
  const access = useAccess();
  const c = useCopy();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [bills, setBills] = useState<BillHit[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
  const q = query.trim().toLowerCase();

  // Close whenever the route changes — a result was tapped, or the user left.
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);

  // Outside click closes the panel (the input keeps its text until navigation).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /* ----------------------------------------------------------------- pages */
  // Same resolution the launcher does: hide what this role can't reach, and read
  // every label through the copy registry so search matches the wording on screen.
  const pageMatches = useMemo(() => {
    if (!q) return [];
    return AREAS.flatMap((a) => {
      const title = c(`home.area.${a.id}.title`) || a.title;
      return a.dests
        .filter((d) => access.can(d.view))
        .map((d) => ({
          ...d,
          label: c(`home.dest.${d.view}.label`) || d.label,
          desc: c(`home.dest.${d.view}.desc`) || d.desc,
          area: title,
        }));
    })
      .filter((d) => `${d.label} ${d.desc} ${d.area}`.toLowerCase().includes(q))
      .slice(0, MAX_PAGES);
  }, [q, access, c]);

  /* --------------------------------------------------------------- vendors */
  const canSeeVendors = access.can("vendors");
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!canSeeVendors) return;
    let alive = true;
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => alive && setVendors(Array.isArray(j.vendors) ? j.vendors : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canSeeVendors]);

  const vendorMatches = useMemo(() => {
    if (!q || !canSeeVendors) return [];
    return vendors.filter((v) => v.name.toLowerCase().includes(q)).slice(0, MAX_VENDORS);
  }, [q, vendors, canSeeVendors]);

  /* ----------------------------------------------------------------- bills */
  // The one networked kind. Debounced, gated, and abort-on-retype so a fast
  // typist can't have an older response land after a newer one.
  const canSearchBills = access.can("bill-search");
  useEffect(() => {
    if (!canSearchBills || q.length < 2) {
      setBills([]);
      setBillsLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setBillsLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/bill-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => setBills(Array.isArray(j.results) ? j.results.slice(0, MAX_BILLS) : []))
        .catch(() => {
          /* aborted or failed — leave the last good list up */
        })
        .finally(() => setBillsLoading(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, canSearchBills]);

  /* --------------------------------------------------------------- bill # */
  const billNumberQuery = canSeeVendors && /^\d+$/.test(query.trim()) ? query.trim() : null;

  const close = useCallback(() => setOpen(false), []);

  const hasAnything =
    pageMatches.length > 0 || vendorMatches.length > 0 || bills.length > 0 || !!billNumberQuery;
  const showPanel = open && q.length > 0;

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <span
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
      >
        <SearchIcon className="h-4 w-4" />
      </span>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Search pages, vendors, bills…"
        aria-label="Search pages, vendors, bills and line items"
        className={`${inputCls} h-9 pl-8 text-[13px]`}
      />

      {/* The box shares its line with the logo and the buttons now, so it can be
          narrow — the panel is anchored to its right edge and sized to the
          viewport instead, rather than inheriting that width. */}
      {showPanel && (
        <div className="absolute right-0 z-30 mt-1 max-h-[70vh] w-[min(30rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-lg border border-neutral-300 bg-white shadow-lg dark:border-neutral-700 dark:bg-ink-overlay">
          {!hasAnything && !billsLoading && (
            <p className="px-3 py-4 text-center text-[13px] text-neutral-500">
              Nothing matches “{query.trim()}”.
            </p>
          )}

          {pageMatches.length > 0 && (
            <Group label="Pages">
              {pageMatches.map((d) => (
                <Row
                  key={d.href}
                  href={d.href + qs}
                  onNavigate={close}
                  label={d.label}
                  desc={`${d.area} · ${d.desc}`}
                />
              ))}
            </Group>
          )}

          {vendorMatches.length > 0 && (
            <Group label="Vendors">
              {vendorMatches.map((v) => (
                <Row
                  key={v.id}
                  href={`/vendors?accountId=${encodeURIComponent(v.id)}`}
                  onNavigate={close}
                  label={v.name}
                  desc="See their bills — job, date, amount"
                />
              ))}
            </Group>
          )}

          {canSearchBills && (billsLoading || bills.length > 0) && (
            <Group label="Bills & line items">
              {bills.map((b) => (
                <BillRow key={b.id} bill={b} q={q} onNavigate={close} />
              ))}
              {billsLoading && bills.length === 0 && (
                <p className="px-3 py-2.5 text-[12px] text-neutral-400">Searching bills…</p>
              )}
              {bills.length >= MAX_BILLS && (
                <Row
                  href={`/bill-search?q=${encodeURIComponent(query.trim())}`}
                  onNavigate={close}
                  label={`See all bill matches for “${query.trim()}”`}
                  desc="Open the full bill search"
                />
              )}
            </Group>
          )}

          {billNumberQuery && (
            <Group label="Bill lookup">
              <Row
                href={`/vendors?number=${billNumberQuery}`}
                onNavigate={close}
                label={`Look up bill #${billNumberQuery}`}
                desc="Org-wide — bill numbers repeat across vendors"
              />
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

/** A labelled block of rows inside the panel. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line-soft last:border-b-0">
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      {children}
    </div>
  );
}

/** One tappable result. Thumb-sized, same anatomy as a ListRow. */
function Row({
  href,
  onNavigate,
  label,
  desc,
  external,
}: {
  href: string;
  onNavigate: () => void;
  label: React.ReactNode;
  desc?: React.ReactNode;
  external?: boolean;
}) {
  const inner = (
    <>
      <span className="block truncate text-[13px] font-semibold tracking-tight">{label}</span>
      {desc && (
        <span className="mt-0.5 block truncate text-[11px] text-neutral-500 dark:text-neutral-400">
          {desc}
        </span>
      )}
    </>
  );
  const cls =
    "block min-h-11 px-3 py-2 transition hover:bg-accent/5 active:bg-accent/10";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} onClick={onNavigate} className={cls}>
      {inner}
    </Link>
  );
}

/**
 * A bill hit — vendor and amount on top, and underneath the LINE that matched,
 * which is the whole point of searching "2x4": you want to see the bill it's on
 * and why it came back. Pre-JobTread rows have no bill page, so they open their
 * archived Drive PDF instead.
 */
function BillRow({ bill, q, onNavigate }: { bill: BillHit; q: string; onNavigate: () => void }) {
  const line = bill.matchedLines[0] ?? bill.lines[0] ?? null;
  const isJt = bill.source === "jobtread" && !!bill.jtDocId;
  const href = isJt
    ? `/bill/${encodeURIComponent(bill.jtDocId)}${bill.jobId ? `?jobId=${encodeURIComponent(bill.jobId)}` : ""}`
    : bill.pdfFileId
      ? `https://drive.google.com/file/d/${bill.pdfFileId}/view`
      : `/bill-search?q=${encodeURIComponent(q)}`;

  const desc = [
    bill.jobName || null,
    bill.issueDate || null,
    line?.description ? `“${line.description}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Row
      href={href}
      external={!isJt && !!bill.pdfFileId}
      onNavigate={onNavigate}
      label={
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate">{bill.vendor}</span>
          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-neutral-500">
            {money(bill.amount)}
          </span>
        </span>
      }
      desc={desc || (bill.invoiceId ? `#${bill.invoiceId}` : "Bill")}
    />
  );
}
