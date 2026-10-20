"use client";

import { InvoicingTabs } from "@/components/InvoicingTabs";
import { PackageEmailButton, PackageEmailResult, usePackageEmail } from "@/components/PackageEmail";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setUrlParam, urlYm } from "@/lib/urlParam";
import {
  Banner,
  Card,
  Chip,
  ChipScroller,
  EmptyState,
  FilterChip,
  Input,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  Select,
  StatementBlock,
  Textarea,
  Toggle,
  btn,
} from "@/components/ui";
import { StickyActionBar } from "@/components/StickyActionBar";
import { billingMonths, monthLabel } from "@/lib/billingMonths";
import { money } from "@/lib/money";
import {
  DELIVERY_LABEL,
  PAYMENT_LABEL,
  type InvoiceStatus,
  type PaymentState,
} from "@/lib/invoiceStatus";

/**
 * Invoice Status — every job billed in a month, and where its client invoice
 * stands: Draft / Open / Part paid / Paid, and whether JobTread emailed it and
 * the client opened it.
 *
 * THE FIGURES come from Apps Script's read of the month (`MonthlyInvoicingSummary.js`):
 * bills from the pull the tracking-sheet sync uses, labor from the month's time
 * entries, and the total from the job's client invoice when one exists. A job
 * with no invoice yet shows its COST — not what the client is billed, since P&O
 * and sales tax are added on the tracking sheet.
 *
 * THE STATUS is read live from JobTread on every open (`lib/invoiceStatus`), not
 * from that cache. An invoice sent from QuickBooks has no JobTread email record,
 * so it reads "not sent from JobTread" — JobTread cannot say whether it went out.
 *
 * THE EMAIL. "Draft invoicing email" saves the month's package email to Gmail.
 * Each job's include flag, headings and note carry into it, so they stay
 * editable here, behind "Edit". The Package Google Doc still exists — the
 * 30-minute tracking-sheet push keeps it current — and the page links to it.
 *
 * Edits save on blur, one field at a time. There is no Save button on purpose.
 */

/** How many billing months the picker offers. */
const MONTH_COUNT = 18;

interface JobLinks {
  appTracking: string;
  appLabor: string;
  jtJob: string;
  jtLabor: string;
  jtInvoice: string;
  jtDocuments: string;
}

interface JobRow {
  jtJobId: string;
  projectId: string;
  customer: string;
  job: string;
  customerLabel: string;
  jobLabel: string;
  include: boolean;
  note: string;
  labor: number;
  laborHours: number;
  laborPeople: number;
  bills: number;
  billCount: number;
  vendorCount: number;
  cost: number;
  total: number;
  invoiced: boolean;
  invoiceNumber: string;
  invoiceStatus: string;
  invoiceBalance: number;
  trackingSheetUrl: string;
  billingFolderUrl: string;
  /** -1 when the month's folder was never created for this job. */
  billingFolderFiles: number;
  links: JobLinks;
  /** Payment and email state, read live from JobTread. Absent on a job with no
   *  invoice, and when that read failed (the warnings say so). */
  status?: InvoiceStatus | null;
}

interface Summary {
  periodKey: string;
  month: number;
  year: number;
  monthLabel: string;
  invoiceMonthLabel: string;
  docTitle: string;
  docId: string;
  docUrl: string;
  /** A figure has moved since the doc was last written. */
  stale: boolean;
  /** The doc has been written at least once. */
  written: boolean;
  /** When Apps Script last read these figures from JobTread. */
  computedAt: string;
  /** How long that read took. Printed, because this month's read is the thing
   *  that runs into Apps Script's ceiling when a month grows. */
  readMs: number;
  headline: string;
  defaultHeadline: string;
  closing: string;
  totals: {
    customers: number;
    jobs: number;
    labor: number;
    bills: number;
    cost: number;
    total: number;
    invoiced: number;
  };
  warnings: string[];
  jobs: JobRow[];
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** "Oct 20", or "Oct 20, 2025" outside this year. Local time: these are datetimes. */
function day(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

/** The list filters. Each is a question the office asks while closing a month. */
type Filter = "all" | "notInvoiced" | "draft" | "unpaid" | "paid" | "notEmailed";

const FILTERS: { key: Filter; label: string; test: (j: JobRow) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "notInvoiced", label: "Not invoiced", test: (j) => !j.invoiced },
  { key: "draft", label: "Draft", test: (j) => j.status?.payment === "draft" },
  {
    key: "unpaid",
    label: "Unpaid",
    test: (j) => j.status?.payment === "open" || j.status?.payment === "partPaid",
  },
  { key: "paid", label: "Paid", test: (j) => j.status?.payment === "paid" },
  {
    // Open or paid, and JobTread has no email that reached anyone. Sent from
    // QuickBooks is possible, so this is a list to check, not a list of misses.
    key: "notEmailed",
    label: "Not emailed",
    test: (j) =>
      !!j.status &&
      j.status.payment !== "draft" &&
      j.status.payment !== "void" &&
      (j.status.delivery === "notSent" || j.status.delivery === "bounced"),
  },
];

export default function InvoicingSummaryPage() {
  const [ym, setYm] = useState("");
  const email = usePackageEmail(ym);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [savingField, setSavingField] = useState("");
  const [saveError, setSaveError] = useState("");

  const months = useMemo(() => billingMonths(MONTH_COUNT), []);

  /**
   * The month's figures and statuses. Passing no `ym` on the first load is
   * deliberate: the route answers for the BILLING MONTH IN FORCE — the one
   * picked on the home page — so this page opens on the month the office is
   * closing rather than on whatever the calendar rolled to.
   */
  const load = useCallback(async (period: string, refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (period) q.set("ym", period);
      // Without this the FIGURES are Apps Script's cache of the last full
      // read, which is what makes opening this page fast. The statuses are
      // live either way. "Refresh figures" pays for a live read of the month.
      if (refresh) q.set("refresh", "1");
      const res = await fetch(
        q.size ? `/api/invoicing-summary?${q}` : "/api/invoicing-summary",
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body as Summary);
      setYm((body as Summary).periodKey);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Could not read the month.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Mount only. Month changes go through onPickMonth so a failed load doesn't
  // strand the picker on a month the page isn't showing.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // A link from another close page names its month; with none, the route
    // answers for the billing month in force.
    void load(urlYm());
  }, [load]);

  const onPickMonth = (next: string) => {
    setYm(next);
    setUrlParam("ym", next);
    void load(next);
  };

  /**
   * Save ONE field. The page's state is already optimistic, so this only reports
   * a failure — and it re-reads nothing, because a whole-month refetch after
   * every blur would take tens of seconds.
   */
  const save = useCallback(
    async (fieldKey: string, patch: Record<string, unknown>) => {
      if (!data) return;
      setSavingField(fieldKey);
      setSaveError("");
      try {
        const res = await fetch("/api/invoicing-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "save", ym: data.periodKey, ...patch }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "That edit did not save.");
      } finally {
        setSavingField("");
      }
    },
    [data],
  );

  const patchJob = (jobId: string, patch: Partial<JobRow>) =>
    setData((d) =>
      d
        ? { ...d, jobs: d.jobs.map((j) => (j.jtJobId === jobId ? { ...j, ...patch } : j)) }
        : d,
    );

  const test = FILTERS.find((f) => f.key === filter)!.test;

  // Jobs grouped by the customer heading the office set, falling back to
  // JobTread's own customer name.
  //
  // WHAT IS LEFT OUT SINKS. Ascent's own jobs — Office, Shop, Electrical — sit
  // under the customer "Ascent" and so sorted to the very top of a page about
  // what clients are billed. They are excluded by default, so ordering on that
  // rather than on their names puts them last without a second list of job
  // names to keep in step with the Apps Script side. Alphabetical order still
  // decides everything within each half, because the sort is stable.
  const customers = useMemo(() => {
    if (!data) return [];
    const order: string[] = [];
    const byName = new Map<string, JobRow[]>();
    for (const j of [...data.jobs].filter(test).sort(
      (a, b) =>
        Number(b.include) - Number(a.include) ||
        a.customerLabel.localeCompare(b.customerLabel) ||
        a.jobLabel.localeCompare(b.jobLabel),
    )) {
      let list = byName.get(j.customerLabel);
      if (!list) {
        byName.set(j.customerLabel, (list = []));
        order.push(j.customerLabel);
      }
      list.push(j);
    }
    return order
      .map((name) => ({ name, jobs: byName.get(name)! }))
      .sort((a, b) => Number(b.jobs.some((j) => j.include)) - Number(a.jobs.some((j) => j.include)));
  }, [data, test]);

  // When Apps Script last read the month's figures from JobTread. The page
  // serves that read from a cache, so it says how old it is.
  const readAt = data?.computedAt
    ? new Date(data.computedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";

  // Every headline figure is recomputed from the page's OWN state: leaving a
  // job out has to move the total on the tap.
  const included = data?.jobs.filter((j) => j.include) ?? [];
  const count = (f: Filter) => included.filter(FILTERS.find((x) => x.key === f)!.test).length;
  const live = {
    total: included.reduce((s, j) => s + j.total, 0),
    labor: included.reduce((s, j) => s + j.labor, 0),
    bills: included.reduce((s, j) => s + j.bills, 0),
    invoiced: included.filter((j) => j.invoiced).length,
    customers: new Set(included.map((j) => j.customerLabel)).size,
    due: included.reduce(
      (s, j) =>
        s + (j.status && (j.status.payment === "open" || j.status.payment === "partPaid") ? j.status.balance : 0),
      0,
    ),
    paid: included.reduce((s, j) => s + (j.status ? j.status.amountPaid : 0), 0),
  };

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 py-6">
      <InvoicingTabs ym={ym} />
      <PageHeader
        title="Invoice Status"
        description={
          data
            ? `${data.monthLabel} billing · goes out as ${data.invoiceMonthLabel}`
            : "Every job billed this month: paid or open, emailed or not."
        }
        actions={
          // Wrapped rather than sized: `inputCls` carries `w-full`, and Tailwind
          // resolves two width utilities by stylesheet order, so a `w-44` on the
          // Select itself would silently lose to it.
          <div className="w-44 max-w-[50vw]">
            <Select
              aria-label="Billing month"
              value={ym}
              onChange={(e) => onPickMonth(e.target.value)}
              disabled={loading}
            >
              {/* The pinned period can be older than the picker's 18 months. */}
              {ym && !months.some((m) => m.value === ym) && (
                <option value={ym}>{monthLabel(ym)}</option>
              )}
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading && <Loading label="Reading the month…" />}

      {!loading && data && (
        <div className="space-y-5">
          {data.warnings.map((w) => (
            <Banner key={w} tone="warning">
              {w}
            </Banner>
          ))}

          <StatementBlock
            label={`${data.monthLabel} — to be invoiced`}
            value={money(live.total)}
            sub={
              <>
                {plural(live.invoiced, "invoice")} of {plural(included.length, "job")} · {money(live.paid)} paid ·{" "}
                {money(live.due)} due · {plural(live.customers, "client")}
              </>
            }
            // Said on every month: a job's figure is BIGGER than its labor
            // plus its bills whenever it is invoiced, and reading that as an
            // error is the single most reported thing about this page.
            footnote={
              `An invoiced job shows what the client is billed — its cost plus P&O and sales tax. ` +
              (live.invoiced < included.length
                ? `${included.length - live.invoiced} job(s) have no client invoice yet and show cost instead.`
                : `Every job here is invoiced.`)
            }
          />

          <ChipScroller>
            {FILTERS.map((f) => (
              <FilterChip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
                {f.key !== "all" && <span className="tabular-nums opacity-70">{count(f.key)}</span>}
              </FilterChip>
            ))}
          </ChipScroller>

          {customers.length === 0 && (
            <EmptyState>
              {data.jobs.length === 0
                ? `Nothing was billed in ${monthLabel(data.periodKey)}.`
                : "No job matches this filter."}
            </EmptyState>
          )}

          {customers.map((cust) => (
            <section key={cust.name} className="space-y-2">
              <SectionHeading
                trailing={
                  <span className="text-xs tabular-nums text-neutral-500">
                    {money(cust.jobs.filter((j) => j.include).reduce((s, j) => s + j.total, 0))}
                  </span>
                }
              >
                {cust.name}
              </SectionHeading>
              <Card pad={false} className="divide-y divide-line-soft overflow-hidden">
                {cust.jobs.map((j) => (
                  <JobItem
                    key={j.jtJobId}
                    job={j}
                    saving={savingField.startsWith(j.jtJobId)}
                    onPatch={(patch) => patchJob(j.jtJobId, patch)}
                    onSave={(field, patch) =>
                      void save(`${j.jtJobId}:${field}`, { jobId: j.jtJobId, ...patch })
                    }
                  />
                ))}
              </Card>
            </section>
          ))}

          <MetaLine
            items={[
              readAt ? `Figures read ${readAt}${data.readMs > 0 ? ` in ${Math.round(data.readMs / 1000)}s` : ""}` : null,
              "status read live from JobTread",
              data.docUrl ? (
                <a key="doc" className="underline" href={data.docUrl} target="_blank" rel="noreferrer">
                  Package doc ↗
                </a>
              ) : null,
            ]}
          />

          {saveError && <Banner tone="error">{saveError}</Banner>}

          <PackageEmailResult email={email} />

          <StickyActionBar>
            <PackageEmailButton email={email} ym={ym} />
            <button type="button" className={btn("ghost", "md")} onClick={() => void load(ym, true)}>
              Refresh figures
            </button>
          </StickyActionBar>
        </div>
      )}
    </main>
  );
}

const PAYMENT_TONE: Record<PaymentState, string> = {
  draft: "text-warn",
  open: "text-neutral-800 dark:text-neutral-100",
  partPaid: "text-warn",
  paid: "text-ok",
  void: "text-danger",
};

/** Where the money is: Draft / Open / Part paid / Paid / Void, or Not invoiced. */
function PaymentMark({ job }: { job: JobRow }) {
  if (!job.invoiced) {
    return (
      <Chip tone="warning" title="No client invoice in JobTread for this month yet">
        Not invoiced
      </Chip>
    );
  }
  const s = job.status;
  if (!s) return <span>Invoice status unknown</span>;
  return (
    <span className={`font-semibold ${PAYMENT_TONE[s.payment]}`}>
      {PAYMENT_LABEL[s.payment]}
      {s.payment === "partPaid" ? ` · ${money(s.balance)} due` : ""}
    </span>
  );
}

/** Where the email is: JobTread's own record of sending the invoice. */
function DeliveryMark({ status }: { status: InvoiceStatus }) {
  const who = status.sentTo.length ? `Emailed to ${status.sentTo.join(", ")}` : undefined;
  if (status.bounced && status.delivery !== "opened") {
    return (
      <Chip tone="danger" title={who}>
        Email bounced
      </Chip>
    );
  }
  switch (status.delivery) {
    case "opened":
      return (
        <span className="text-ok" title={who}>
          Opened{status.viewedAt ? ` ${day(status.viewedAt)}` : ""}
        </span>
      );
    case "delivered":
      return (
        <span title={who}>
          Emailed, not opened{status.deliveryAt ? ` · ${day(status.deliveryAt)}` : ""}
        </span>
      );
    case "sending":
      return <span title={who}>Sending</span>;
    default:
      return (
        <span title="JobTread has no record of emailing this invoice. It may have gone out from QuickBooks.">
          {DELIVERY_LABEL.notSent}
          {status.inQbo ? " · in QuickBooks" : ""}
        </span>
      );
  }
}

/**
 * One job: its status, its figures, its links, and — folded away — the three
 * things the office can change for the invoicing email.
 */
function JobItem({
  job,
  saving,
  onPatch,
  onSave,
}: {
  job: JobRow;
  saving: boolean;
  onPatch: (patch: Partial<JobRow>) => void;
  onSave: (field: string, patch: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const s = job.status;

  return (
    <div className={`px-4 py-3 ${job.include ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{job.jobLabel}</p>
          <MetaLine
            className="mt-1"
            items={[
              <PaymentMark key="pay" job={job} />,
              s && s.payment !== "draft" && s.payment !== "void" ? <DeliveryMark key="mail" status={s} /> : null,
            ]}
          />
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold tabular-nums">{money(job.total)}</p>
          {s && s.payment === "open" && s.balance > 0 && s.balance < job.total - 0.005 ? (
            <p className="text-[11px] tabular-nums text-neutral-500">{money(s.balance)} due</p>
          ) : null}
        </div>
      </div>

      <MetaLine
        className="mt-1.5"
        items={[
          job.invoiced ? (
            <a key="inv" className="underline" href={job.links.jtInvoice} target="_blank" rel="noreferrer">
              Invoice{job.invoiceNumber ? ` #${job.invoiceNumber}` : ""} ↗
            </a>
          ) : null,
          // The total is the client INVOICE on an invoiced job, so it is bigger
          // than labor plus bills by the markup and the tax. Printing the cost
          // beside it is what stops that reading as a wrong total.
          job.invoiced ? <span key="cost">{money(job.cost)} cost</span> : null,
          <a key="labor" className="underline" href={job.links.jtLabor} target="_blank" rel="noreferrer">
            Labor {money(job.labor)}
            {job.laborHours ? ` · ${job.laborHours} hrs` : ""}
          </a>,
          <a key="bills" className="underline" href={job.links.jtDocuments} target="_blank" rel="noreferrer">
            Bills {money(job.bills)}
            {job.billCount ? ` · ${plural(job.billCount, "bill")}` : ""}
          </a>,
        ]}
      />

      <MetaLine
        className="mt-1"
        items={[
          <a key="app" className="underline" href={job.links.appTracking}>
            Tracking Sheets
          </a>,
          job.trackingSheetUrl ? (
            <a key="sheet" className="underline" href={job.trackingSheetUrl} target="_blank" rel="noreferrer">
              Sheet ↗
            </a>
          ) : null,
          job.billingFolderUrl ? (
            <a key="drive" className="underline" href={job.billingFolderUrl} target="_blank" rel="noreferrer">
              Backup ({job.billingFolderFiles}) ↗
            </a>
          ) : (
            <span key="nofolder">No billing folder</span>
          ),
          <a key="review" className="underline" href={job.links.appLabor}>
            Labor Review
          </a>,
          job.include ? null : (
            <Chip key="out" tone="neutral">
              Left out
            </Chip>
          ),
          saving ? "saving…" : null,
        ]}
      />

      {job.note && !open && (
        <p className="mt-2 border-l-2 border-line pl-2.5 text-[12px] italic text-neutral-500 dark:text-neutral-400">
          {job.note}
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-1.5 text-[12px] text-neutral-500 underline dark:text-neutral-400"
      >
        {open ? "Done" : "Edit for the email"}
      </button>

      {open && (
        <div className="mt-3 space-y-2.5 border-t border-line-soft pt-3">
          <Toggle
            checked={job.include}
            label="Include this job in the invoicing email"
            onChange={(next) => {
              onPatch({ include: next });
              onSave("include", { include: next });
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-neutral-500">Customer heading</span>
              <Input
                value={job.customerLabel}
                placeholder={job.customer}
                onChange={(e) => onPatch({ customerLabel: e.target.value })}
                onBlur={(e) => onSave("customerLabel", { customerLabel: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-500">Job heading</span>
              <Input
                value={job.jobLabel}
                placeholder={job.job}
                onChange={(e) => onPatch({ jobLabel: e.target.value })}
                onBlur={(e) => onSave("jobLabel", { jobLabel: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] text-neutral-500">Note under this job</span>
            <Textarea
              rows={2}
              value={job.note}
              onChange={(e) => onPatch({ note: e.target.value })}
              onBlur={(e) => onSave("note", { note: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
