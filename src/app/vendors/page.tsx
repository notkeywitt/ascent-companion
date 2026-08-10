"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import {
  EmptyState,
  Input,
  ListCard,
  ListRow,
  Loading,
  PageHeader,
  SectionHeading,
  btn,
} from "@/components/ui";

/**
 * Vendor bill search — job, date, amount, status, per vendor or per bill
 * number. JobTread's own vendor search only lists a bill's number; this
 * shows the rest without leaving the phone.
 *
 * Two independent lookups on one page rather than one input that guesses
 * intent from keystrokes: name search filters the already-cached vendor
 * list instantly (no network per keystroke), while the bill-number lookup is
 * org-wide and only fires on submit — bill numbers repeat across vendors
 * (confirmed live: #98 matches three different vendors/jobs), so it always
 * shows every match rather than assuming one.
 *
 * Gated by the "vendors" view in src/lib/views.ts (office + admin).
 */

interface VendorRef {
  id: string;
  name: string;
}
interface VendorBillRow {
  id: string;
  number: number | null;
  jobId: string | null;
  jobName: string;
  cost: number;
  status: string;
  issueDate: string | null;
}
interface VendorBillMatch extends VendorBillRow {
  vendorName: string;
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateLabel = (d: string | null) => {
  if (!d) return "No date";
  const dt = new Date(d + "T00:00:00");
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const isDigits = (s: string) => /^\d+$/.test(s.trim());

/** Amount + status, stacked — the trailing slot every bill row shares. */
function BillTrailing({ cost, status }: { cost: number; status: string }) {
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="text-sm font-semibold tabular-nums">{money(cost)}</span>
      <BillStatusBadge status={status} />
    </span>
  );
}

function billHref(b: { id: string; jobId: string | null }) {
  return b.jobId ? `/bill/${b.id}?jobId=${encodeURIComponent(b.jobId)}` : undefined;
}

function Vendors() {
  const search = useSearchParams();
  const initialAccountId = (search.get("accountId") ?? "").trim();
  const initialNumber = (search.get("number") ?? "").trim();

  const [query, setQuery] = useState("");
  const [vendors, setVendors] = useState<VendorRef[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [vendorsError, setVendorsError] = useState("");

  const [selected, setSelected] = useState<VendorRef | null>(null);
  const [bills, setBills] = useState<VendorBillRow[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [billsError, setBillsError] = useState("");

  const [numberQuery, setNumberQuery] = useState(initialNumber);
  const [numberMatches, setNumberMatches] = useState<VendorBillMatch[] | null>(null);
  const [numberLoading, setNumberLoading] = useState(false);
  const [numberError, setNumberError] = useState("");

  // The org's vendor list, off the same 30-min shared cache every other page
  // using /api/vendors reads — instant here too.
  useEffect(() => {
    let alive = true;
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error) {
          setVendorsError(String(j.error));
          return;
        }
        setVendors(Array.isArray(j.vendors) ? j.vendors : []);
      })
      .catch((e) => alive && setVendorsError(e instanceof Error ? e.message : "Network error"))
      .finally(() => alive && setVendorsLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  function loadVendorBills(v: VendorRef) {
    setSelected(v);
    setNumberMatches(null);
    setBills([]);
    setBillsLoading(true);
    setBillsError("");
    fetch(`/api/vendor-bills/${encodeURIComponent(v.id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setBillsError(String(j.error));
          return;
        }
        setBills(Array.isArray(j.bills) ? j.bills : []);
      })
      .catch((e) => setBillsError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setBillsLoading(false));
  }

  function runNumberLookup(raw: string) {
    if (!isDigits(raw)) return;
    setSelected(null);
    setBills([]);
    setNumberLoading(true);
    setNumberError("");
    fetch(`/api/vendor-bills/by-number?number=${encodeURIComponent(raw.trim())}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setNumberError(String(j.error));
          return;
        }
        setNumberMatches(Array.isArray(j.bills) ? j.bills : []);
      })
      .catch((e) => setNumberError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setNumberLoading(false));
  }

  // Deep-link from the Home search box (?accountId=… or ?number=…).
  useEffect(() => {
    if (!initialAccountId || vendors.length === 0) return;
    const v = vendors.find((x) => x.id === initialAccountId);
    if (v) loadVendorBills(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAccountId, vendors]);

  useEffect(() => {
    if (initialNumber) runNumberLookup(initialNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNumber]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return vendors.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 25);
  }, [q, vendors]);

  const total = bills.reduce((s, b) => s + b.cost, 0);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Vendors"
        description="Search a vendor to see every bill — job, date, amount, status."
      />

      {selected ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setBills([]);
              setBillsError("");
            }}
            className="text-sm font-semibold text-accent hover:underline"
          >
            ‹ Back to search
          </button>

          <SectionHeading
            trailing={
              !billsLoading && !billsError ? (
                <span className="text-[11px] tabular-nums text-neutral-500">
                  {bills.length} bill{bills.length === 1 ? "" : "s"} · {money(total)}
                </span>
              ) : undefined
            }
          >
            {selected.name}
          </SectionHeading>

          {billsError && <p className="text-sm text-red-600">{billsError}</p>}
          {billsLoading && <Loading label="Loading bills…" />}
          {!billsLoading && !billsError && bills.length === 0 && (
            <EmptyState>No bills for {selected.name}.</EmptyState>
          )}
          {!billsLoading && !billsError && bills.length > 0 && (
            <ListCard>
              {bills.map((b) => (
                <ListRow
                  key={b.id}
                  href={billHref(b)}
                  label={b.number != null ? `#${b.number} · ${b.jobName}` : b.jobName}
                  desc={dateLabel(b.issueDate)}
                  trailing={<BillTrailing cost={b.cost} status={b.status} />}
                />
              ))}
            </ListCard>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={vendorsLoading ? "Loading vendors…" : `Search ${vendors.length} vendors`}
              aria-label="Search vendors"
              autoFocus
            />
            {vendorsError && <p className="text-sm text-red-600">{vendorsError}</p>}

            {q && (
              <div className="space-y-2 pt-2">
                <SectionHeading>{matches.length === 1 ? "1 match" : `${matches.length} matches`}</SectionHeading>
                {matches.length === 0 ? (
                  <EmptyState>Nothing matches “{query.trim()}”.</EmptyState>
                ) : (
                  <ListCard>
                    {matches.map((v) => (
                      <ListRow key={v.id} onClick={() => loadVendorBills(v)} label={v.name} />
                    ))}
                  </ListCard>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-line pt-5">
            <SectionHeading>Look up a bill by number</SectionHeading>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runNumberLookup(numberQuery);
              }}
              className="flex gap-2"
            >
              <Input
                type="text"
                inputMode="numeric"
                value={numberQuery}
                onChange={(e) => setNumberQuery(e.target.value)}
                placeholder="Bill #"
                aria-label="Bill number"
              />
              <button
                type="submit"
                className={btn("secondary", "md")}
                disabled={!isDigits(numberQuery) || numberLoading}
              >
                Go
              </button>
            </form>
            <p className="text-xs text-neutral-500">
              Org-wide, not per vendor — bill numbers repeat, so this can return more than one.
            </p>

            {numberError && <p className="text-sm text-red-600">{numberError}</p>}
            {numberLoading && <Loading label="Looking up bill…" />}
            {numberMatches && (
              <div className="space-y-2 pt-2">
                <SectionHeading>
                  {numberMatches.length === 0
                    ? `No bills numbered #${numberQuery.trim()}`
                    : `${numberMatches.length} bill${numberMatches.length === 1 ? "" : "s"} numbered #${numberQuery.trim()}`}
                </SectionHeading>
                {numberMatches.length > 0 && (
                  <ListCard>
                    {numberMatches.map((b) => (
                      <ListRow
                        key={b.id}
                        href={billHref(b)}
                        label={b.vendorName}
                        desc={`${b.jobName} · ${dateLabel(b.issueDate)}`}
                        trailing={<BillTrailing cost={b.cost} status={b.status} />}
                      />
                    ))}
                  </ListCard>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default function VendorsPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Vendors />
    </Suspense>
  );
}
