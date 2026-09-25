"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import {
  EmptyState,
  FilterChip,
  Input,
  ListCard,
  ListRow,
  Loading,
  PageHeader,
  QuietInput,
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
interface VendorContact {
  name: string;
  title: string;
  email: string;
  phone: string;
}
interface VendorDetail {
  id: string;
  name: string;
  email: string;
  phone: string;
  billType: "Bill" | "Expense";
  addresses: string[];
  contacts: VendorContact[];
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

/** "+13604683952" → "(360) 468-3952". Anything else is shown as stored. */
const phoneLabel = (p: string) => {
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
};

/**
 * Email, phone and address for one vendor.
 *
 * JobTread keeps each as a custom field — on the account ("vendor") or on a
 * contact ("vendorContact") — and most of the 235 vendor accounts carry none of
 * them. So a field that is MISSING renders as an input rather than not at all:
 * the office fills it in where the gap shows up, which is here, instead of
 * opening JobTread. A field already on file stays a plain row that dials or
 * mails; changing one is still JobTread's job.
 */
function VendorDetailCard({
  detail,
  onSaved,
}: {
  detail: VendorDetail;
  onSaved: (d: VendorDetail) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A fresh vendor is a fresh form — otherwise a half-typed phone number
  // follows you to the next vendor.
  useEffect(() => {
    setDraft({});
    setError("");
  }, [detail.id]);

  const contacts = detail.contacts.filter((c) => c.name || c.email || c.phone);
  const address = detail.addresses[0] ?? "";
  const missing = [
    { key: "email", label: "Email", type: "email", placeholder: "name@vendor.com" },
    { key: "phone", label: "Phone", type: "tel", placeholder: "(360) 555-0134" },
    { key: "address", label: "Address", type: "text", placeholder: "Street, city, state ZIP" },
  ].filter(
    (f) =>
      !({ email: detail.email, phone: detail.phone, address } as Record<string, string>)[f.key],
  );

  const typed = Object.entries(draft).filter(([, v]) => v.trim());

  function save(fields: Record<string, string> = Object.fromEntries(typed)) {
    if (Object.keys(fields).length === 0) return;
    setSaving(true);
    setError("");
    fetch("/api/vendor-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: detail.id, ...fields }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(String(j.error));
          return;
        }
        if (j.previewed) {
          setError("Writes are switched off — nothing was saved.");
          return;
        }
        setDraft({});
        if (j.detail) onSaved(j.detail as VendorDetail);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setSaving(false));
  }

  return (
    <div className="space-y-2">
      <ListCard>
        {detail.email && (
          <ListRow href={`mailto:${detail.email}`} label={detail.email} desc="Email" />
        )}
        {detail.phone && (
          <ListRow href={`tel:${detail.phone}`} label={phoneLabel(detail.phone)} desc="Phone" />
        )}
        {detail.addresses.map((a) => (
          <ListRow key={a} label={a} desc="Address" />
        ))}

        {/* Nothing on file for this one — the row IS the input. */}
        {missing.map((f) => (
          <div
            key={f.key}
            className="flex min-h-[56px] items-center gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0"
          >
            <label
              htmlFor={`vendor-${f.key}`}
              className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
            >
              {f.label}
            </label>
            <QuietInput
              id={`vendor-${f.key}`}
              type={f.type}
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              disabled={saving}
            />
          </div>
        ))}

        {/* What /add-bill files this vendor's bills as. Saves on tap. */}
        <div className="flex min-h-[56px] items-center gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0">
          <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Bill type
          </span>
          <div className="flex gap-2">
            {(["Bill", "Expense"] as const).map((t) => (
              <FilterChip
                key={t}
                on={detail.billType === t}
                onClick={() => !saving && detail.billType !== t && save({ billType: t })}
                title={t === "Expense" ? "Already paid when it arrives" : "Paid later, on terms"}
              >
                {t}
              </FilterChip>
            ))}
          </div>
        </div>

        {contacts.map((c) => (
          <ListRow
            key={`${c.name}-${c.email}-${c.phone}`}
            label={c.name || "Contact"}
            desc={
              [c.title, c.email, c.phone && phoneLabel(c.phone)].filter(Boolean).join(" · ") ||
              "Contact"
            }
          />
        ))}
      </ListCard>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {typed.length > 0 && (
        <button type="button" className={btn("primary", "md")} onClick={() => save()} disabled={saving}>
          {saving ? "Saving…" : `Save to JobTread`}
        </button>
      )}
    </div>
  );
}

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
  const [detail, setDetail] = useState<VendorDetail | null>(null);
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
    setDetail(null);
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
        setDetail(j.detail ?? null);
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
  // No query = every vendor, A–Z. A query narrows the same list.
  const matches = useMemo(
    () =>
      vendors
        .filter((v) => !q || v.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [q, vendors],
  );

  const total = bills.reduce((s, b) => s + b.cost, 0);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Vendors"
        description="Pick a vendor to see every bill — job, date, amount, status."
      />

      {selected ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setBills([]);
              setDetail(null);
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

          {detail && <VendorDetailCard detail={detail} onSaved={setDetail} />}

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
          <div className="space-y-2 border-t border-line pt-5">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={vendorsLoading ? "Loading vendors…" : `Search ${vendors.length} vendors`}
              aria-label="Search vendors"
              autoFocus
            />
            {vendorsError && <p className="text-sm text-red-600">{vendorsError}</p>}

            {!vendorsLoading && !vendorsError && (
              <div className="space-y-2 pt-2">
                <SectionHeading>
                  {!q
                    ? `All vendors · ${matches.length}`
                    : matches.length === 1
                      ? "1 match"
                      : `${matches.length} matches`}
                </SectionHeading>
                {matches.length === 0 ? (
                  <EmptyState>{q ? `Nothing matches “${query.trim()}”.` : "No vendors in JobTread."}</EmptyState>
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
