"use client";

import { InvoicingTabs } from "@/components/InvoicingTabs";
import { PackageEmailButton, PackageEmailNotes, PackageEmailResult, usePackageEmail } from "@/components/PackageEmail";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hubHref } from "@/lib/hubUrl";
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
} from "@/lib/invoiceStatus";
import { invoiceMarkup, jtDocumentUrl } from "@/lib/packageInvoices";
import {
  PAYMENT_TONE,
  PaymentMark,
  jobStatuses,
  liveTotals,
  useInvoicingSummary,
  type JobRow,
} from "./summary";
import { checkedAtLabel, openFindings, tally } from "@/app/trackingsheet/preSendMemory";
import { FixSheet } from "./FixSheet";
import type { Finding } from "@/lib/invoiceReview/types";
import { useJobChecks, type JobRun } from "@/app/trackingsheet/usePreSendCheck";

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

// Each filter reads EVERY invoice on the job: a job billed on two invoices is
// "Unpaid" while either is open, and "Paid" only when both are.
const FILTERS: { key: Filter; label: string; test: (j: JobRow) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "notInvoiced", label: "Not invoiced", test: (j) => !j.invoiced },
  { key: "draft", label: "Draft", test: (j) => jobStatuses(j).some((s) => s.payment === "draft") },
  {
    key: "unpaid",
    label: "Unpaid",
    test: (j) => jobStatuses(j).some((s) => s.payment === "open" || s.payment === "partPaid"),
  },
  {
    key: "paid",
    label: "Paid",
    test: (j) => {
      const live = jobStatuses(j).filter((s) => s.payment !== "void");
      return live.length > 0 && live.every((s) => s.payment === "paid");
    },
  },
  {
    // Open or paid, and JobTread has no email that reached anyone. Sent from
    // QuickBooks is possible, so this is a list to check, not a list of misses.
    key: "notEmailed",
    label: "Not emailed",
    test: (j) =>
      jobStatuses(j).some(
        (s) =>
          s.payment !== "draft" &&
          s.payment !== "void" &&
          (s.delivery === "notSent" || s.delivery === "bounced"),
      ),
  },
];

/** `embedYm`: the Jobs Hub draws this under its own header — no tab strip, and
 *  the address bar is the hub's to keep. */
export function InvoicingSummary({ embedYm, focusJobId }: { embedYm?: string; focusJobId?: string } = {}) {
  const [ym, setYm] = useState(embedYm ?? "");
  const email = usePackageEmail(ym);
  const [filter, setFilter] = useState<Filter>("all");
  const [savingField, setSavingField] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  // A note edit changes the email: ask again when the notes card closes.
  const { recheck: recheckEmail } = email;
  const notesWereOpen = useRef(false);
  useEffect(() => {
    if (!notesOpen && notesWereOpen.current) recheckEmail();
    notesWereOpen.current = notesOpen;
  }, [notesOpen, recheckEmail]);

  const months = useMemo(() => billingMonths(MONTH_COUNT), []);

  // Passing no `ym` on the first load is deliberate: the route answers for the
  // month before the billing month in force, so this page opens on the month
  // the office is invoicing.
  const { data, setData, loading, error, load: loadSummary } = useInvoicingSummary();
  const load = useCallback(
    async (period: string, refresh = false) => {
      const body = await loadSummary(period, refresh);
      if (body) setYm(body.periodKey);
    },
    [loadSummary],
  );

  // Mount only. Month changes go through onPickMonth so a failed load doesn't
  // strand the picker on a month the page isn't showing.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // A link from another close page names its month; with none, the route
    // answers for the month before the billing month in force.
    void load(embedYm ?? urlYm());
  }, [load]);

  const onPickMonth = (next: string) => {
    setYm(next);
    if (!embedYm) setUrlParam("ym", next);
    void load(next);
  };

  /**
   * Save ONE field. The page's state is already optimistic, so this only reports
   * a failure — and it re-reads nothing, because a whole-month refetch after
   * every blur would take tens of seconds.
   */
  const save = useCallback(
    async (fieldKey: string, patch: Record<string, unknown>): Promise<boolean> => {
      if (!data) return false;
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
        return true;
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "That edit did not save.");
        return false;
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
  const live = liveTotals(data?.jobs ?? []);
  const included = live.included;
  // The invoice review's job checks, one per included job: the side-by-side and
  // the per-check marks read them. Last run per job and month is kept on this
  // device, so the marks are there when the page opens.
  const checkIds = useMemo(() => included.map((j) => j.jtJobId), [included]);
  const jc = useJobChecks(ym, checkIds);
  const count = (f: Filter) => included.filter(FILTERS.find((x) => x.key === f)!.test).length;

  return (
    <main className={embedYm ? "w-full" : "w-full px-4 pad:px-7 py-6"}>
      {!embedYm && <InvoicingTabs ym={ym} />}
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
                {plural(live.invoiceCount, "invoice")} on {live.invoiced} of {plural(included.length, "job")} ·{" "}
                {money(live.paid)} paid ·{" "}
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
                    run={jc.runs[j.jtJobId]}
                    onCheck={() => void jc.check(j.jtJobId)}
                    focus={focusJobId === j.jtJobId}
                    ym={embedYm ? "" : ym}
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

          {notesOpen && (
            <PackageEmailNotes
              ym={ym}
              jobs={included}
              running={email.running}
              onPatch={(id, note) => patchJob(id, { note })}
              onSave={(id, note) => save(`${id}:note`, { jobId: id, note })}
              onDraft={async () => {
                await email.run();
                setNotesOpen(false);
              }}
              onClose={() => setNotesOpen(false)}
            />
          )}

          <StickyActionBar>
            <PackageEmailButton email={email} ym={ym} onOpen={() => setNotesOpen(true)} />
            <button
              type="button"
              className={btn("ghost", "md")}
              disabled={jc.batchRunning || checkIds.length === 0}
              onClick={() => jc.checkAll(checkIds)}
            >
              {jc.batchRunning ? `Checking ${jc.finished} / ${jc.total}…` : "Check all jobs"}
            </button>
            <button type="button" className={btn("ghost", "md")} onClick={() => void load(ym, true)}>
              Refresh figures
            </button>
          </StickyActionBar>
        </div>
      )}
    </main>
  );
}

/** A link drawn as a small button. `external` opens a new tab (JobTread, Drive, Sheets). */
function LinkButton({
  href,
  external,
  title,
  children,
}: {
  href: string;
  external?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      title={title}
      className={btn("secondary", "xs")}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/** Dollars apart that still reads as agreeing: rounding across a month of lines. */
const AGREE = 1;

/**
 * The app's month beside JobTread's invoice, cost against cost. The app's cost is
 * Apps Script's read of the month's bills and labor. JobTread's is the cost basis
 * of the client invoices. What the month still has to invoice sits between them,
 * so a job agrees when app cost = on invoice + still to invoice. The numbers come
 * from the job check, so they need that run.
 */
function SideBySide({ job, run }: { job: JobRow; run: JobRun | undefined }) {
  const f = run?.mem?.result.figures;
  const n = job.invoices?.length ?? (job.invoiced ? 1 : 0);
  const onLabel = n > 1 ? `On ${n} JT invoices` : "On JT invoice";
  if (!f) {
    // No job check yet: the month's cost against the cost on ALL of its
    // invoices, from the live status read. Without the check there is no
    // "still to invoice", so a gap is shown, not judged.
    const known = (job.invoices ?? []).filter((i) => i.status && typeof i.cost === "number");
    if (!known.length) {
      return (
        <p className="mt-2 text-xs text-neutral-500">
          App cost {money(job.cost)} · not compared with JobTread yet
        </p>
      );
    }
    const onInvoices = known.reduce((s, i) => s + (i.cost ?? 0), 0);
    const gap = job.cost - onInvoices;
    return (
      <div className="mt-2">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Figure label="App cost" value={job.cost} />
          <Figure label={onLabel} value={onInvoices} />
          <Figure label="Not on an invoice" value={gap} />
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {Math.abs(gap) <= AGREE
            ? "✓ The month's labor and bills are all on its invoices"
            : `${money(Math.abs(gap))} ${gap > 0 ? "of labor and bills is on no invoice" : "more on the invoices than the month's labor and bills"} — run the check to explain it`}
        </p>
      </div>
    );
  }
  const gap = job.cost - f.invoiceCost - f.toBeInvoiced;
  const agrees = Math.abs(gap) <= AGREE;
  return (
    <div className="mt-2">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Figure label="App cost" value={job.cost} />
        <Figure label={onLabel} value={f.invoiceCost} />
        <Figure label="Still to invoice" value={f.toBeInvoiced} />
      </div>
      <p
        className={`mt-1 text-xs ${agrees ? "text-ok" : "text-warn"}`}
        title="App cost, minus the cost on all of the month's JobTread invoices, minus what the app says is still to invoice."
      >
        {agrees
          ? "✓ App and JobTread agree"
          : `Off by ${money(Math.abs(gap))} — ${gap > 0 ? "app is higher" : "JobTread is higher"}`}
        {f.invoiceTotal > 0 ? ` · billed ${money(f.invoiceTotal)} with markup and tax` : ""}
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line-soft px-2 py-1">
      <p className="text-[11px] text-neutral-500">{label}</p>
      <p className="font-semibold tabular-nums">{money(value)}</p>
    </div>
  );
}

/**
 * Every invoice check's result on this job. The summary line is the answer; the
 * list behind it names each check, so a clean job still shows what ran.
 */
function CheckMarks({ run, onCheck, ym }: { run: JobRun | undefined; onCheck: () => void; ym: string }) {
  const [open, setOpen] = useState(false);
  const [fixing, setFixing] = useState<Finding | null>(null);
  const busy = run?.state === "queued" || run?.state === "running";
  const mem = run?.mem;
  const checks = mem?.result.checks;
  const t = mem ? tally(mem) : null;
  const incomplete = !!mem?.result.evidenceWarnings.length;
  const open_ = mem ? openFindings(mem) : [];
  const fixingCheck = fixing ? checks?.find((c) => c.kinds?.includes(fixing.kind)) : undefined;
  // A run saved before checks carried their kinds: list its findings unsorted.
  const unsorted = open_.filter((f) => !checks?.some((c) => c.kinds?.includes(f.kind)));

  return (
    <div className="mt-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {checks && t ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={`font-semibold ${t.errors ? "text-danger" : t.warnings || incomplete ? "text-warn" : "text-ok"}`}
          >
            {t.errors || t.warnings
              ? [t.errors && `${t.errors} to fix`, t.warnings && `${t.warnings} to look at`]
                  .filter(Boolean)
                  .join(" · ")
              : incomplete
                ? "Check incomplete"
                : `✓ ${plural(checks.length, "check")} clear`}
            {open ? " ▴" : " ▾"}
          </button>
        ) : (
          <span className="text-neutral-500">Checks not run</span>
        )}
        {mem && <span className="text-neutral-500">{checkedAtLabel(mem.at)}</span>}
        <button type="button" disabled={busy} onClick={onCheck} className={btn("ghost", "xs")}>
          {busy ? "Checking…" : mem ? "Re-check" : "Check this job"}
        </button>
      </div>
      {run?.error && <p className="mt-1 text-danger">{run.error}</p>}
      {open && incomplete && <p className="mt-1 text-warn">{mem!.result.evidenceWarnings.join(" ")}</p>}
      {open && checks && (
        <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {checks.map((c) => (
            <li key={c.id}>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={
                    c.errors ? "text-danger" : c.warnings ? "text-warn" : incomplete ? "text-neutral-500" : "text-ok"
                  }
                  aria-hidden
                >
                  {c.errors ? "✕" : c.warnings ? "!" : incomplete ? "?" : "✓"}
                </span>
                <span>{c.title}</span>
                {c.errors + c.warnings > 0 && (
                  <span className="tabular-nums text-neutral-500">{c.errors + c.warnings}</span>
                )}
              </div>
              {open_
                .filter((f) => c.kinds?.includes(f.kind))
                .map((f) => (
                  <FindingRow key={f.key} f={f} onFix={() => setFixing(f)} />
                ))}
            </li>
          ))}
        </ul>
      )}
      {open && unsorted.length > 0 && (
        <div className="mt-1.5">
          {unsorted.map((f) => (
            <FindingRow key={f.key} f={f} onFix={() => setFixing(f)} />
          ))}
        </div>
      )}
      <FixSheet
        finding={fixing}
        checkTitle={fixingCheck?.title ?? ""}
        checkDescription={fixingCheck?.description ?? ""}
        ym={ym}
        onClose={() => setFixing(null)}
        onFixed={onCheck}
      />
    </div>
  );
}

/** One open finding under its check: its title, and the button to the Fix sheet. */
function FindingRow({ f, onFix }: { f: Finding; onFix: () => void }) {
  return (
    <div className="ml-4 flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-neutral-500" title={f.title}>
        {f.title}
      </span>
      <button
        type="button"
        onClick={onFix}
        className="inline-flex min-h-9 shrink-0 items-center font-semibold text-accent hover:underline lg:min-h-0"
      >
        Fix
      </button>
    </div>
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

type JobInvoice = NonNullable<JobRow["invoices"]>[number];

/**
 * One client invoice of the job's month: its number and title, where the money
 * and the email are, what it bills and on what cost. A job billed on two
 * invoices (Berger Bunkhouse, October 2026: #473 with P&O, #416 the plumbing
 * fixtures at cost) shows two of these.
 */
function InvoiceCard({ jobId, fallbackHref, inv }: { jobId: string; fallbackHref: string; inv: JobInvoice }) {
  const s = inv.status;
  const markup = invoiceMarkup(inv);
  const total = inv.priceWithTax || 0;
  const title = inv.warranty ? "Warranty record" : inv.name || "Invoice";
  return (
    <a
      href={inv.id ? jtDocumentUrl(jobId, inv.id) : fallbackHref}
      target="_blank"
      rel="noreferrer"
      title={inv.description || (inv.warranty ? "Every line 88 90 00, billed at $0" : undefined)}
      className="block rounded-md border border-line-soft px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">
            #{inv.number || "—"} · {title} ↗
          </p>
          <MetaLine
            className="mt-0.5 text-xs"
            items={[
              s ? (
                <span key="pay" className={`font-semibold ${PAYMENT_TONE[s.payment]}`}>
                  {PAYMENT_LABEL[s.payment]}
                </span>
              ) : (
                <span key="pay">Status unknown</span>
              ),
              s && s.payment !== "draft" && s.payment !== "void" ? <DeliveryMark key="mail" status={s} /> : null,
              markup.label ? (
                markup.atCost ? (
                  <Chip key="mk" tone="neutral" title="Every line billed at its cost: a materials invoice with no P&O">
                    {markup.label}
                  </Chip>
                ) : (
                  <span key="mk">{markup.label}</span>
                )
              ) : null,
            ]}
          />
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">{money(total)}</p>
          {typeof inv.cost === "number" && inv.cost > 0 ? (
            <p className="text-[11px] tabular-nums text-neutral-500">cost {money(inv.cost)}</p>
          ) : null}
          {s && (s.payment === "open" || s.payment === "partPaid") && s.balance > 0.005 && s.balance < total - 0.005 ? (
            <p className="text-[11px] tabular-nums text-neutral-500">{money(s.balance)} due</p>
          ) : null}
        </div>
      </div>
    </a>
  );
}

/**
 * One job: its status, its figures, its links, and — folded away — the three
 * things the office can change for the invoicing email.
 */
function JobItem({
  job,
  run,
  onCheck,
  focus,
  ym,
  saving,
  onPatch,
  onSave,
}: {
  job: JobRow;
  run: JobRun | undefined;
  onCheck: () => void;
  focus: boolean;
  /** Set on the standalone page only: it adds a link into the Jobs Hub. */
  ym: string;
  saving: boolean;
  onPatch: (patch: Partial<JobRow>) => void;
  onSave: (field: string, patch: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const s = job.status;
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) row.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);
  // Every invoice gets its own card. An old payload with no list keeps the
  // single status line under the job name.
  const cards = job.invoiced ? job.invoices ?? [] : [];

  return (
    <div ref={row} className={`px-4 py-3 ${job.include ? "" : "opacity-60"} ${focus ? "bg-accent/10" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{job.jobLabel}</p>
          <MetaLine
            className="mt-1"
            items={
              cards.length
                ? [cards.length > 1 ? <span key="n">{plural(cards.length, "invoice")} this month</span> : null]
                : [
                    <PaymentMark key="pay" job={job} />,
                    s && s.payment !== "draft" && s.payment !== "void" ? (
                      <DeliveryMark key="mail" status={s} />
                    ) : null,
                  ]
            }
          />
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold tabular-nums">{money(job.total)}</p>
          {cards.length > 1 ? (
            <p className="text-[11px] text-neutral-500">all invoices</p>
          ) : s && s.payment === "open" && s.balance > 0 && s.balance < job.total - 0.005 ? (
            <p className="text-[11px] tabular-nums text-neutral-500">{money(s.balance)} due</p>
          ) : null}
        </div>
      </div>

      {cards.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {cards.map((iv) => (
            <InvoiceCard key={`inv-${iv.id || iv.number}`} jobId={job.jtJobId} fallbackHref={job.links.jtInvoice} inv={iv} />
          ))}
        </div>
      )}

      <SideBySide job={job} run={run} />
      <CheckMarks run={run} onCheck={onCheck} ym={ym} />

      {/* Every link is a small button. The total above is the client INVOICE on
          an invoiced job, so it is bigger than labor plus bills by the markup
          and the tax; the side-by-side prints cost against cost for that reason. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {job.invoiced && !cards.length && (
          <LinkButton href={job.links.jtInvoice} external>
            Invoice{job.invoiceNumber ? ` #${job.invoiceNumber}` : ""} ↗
          </LinkButton>
        )}
        <LinkButton href={job.links.jtLabor} external>
          Labor {money(job.labor)}
          {job.laborHours ? ` · ${job.laborHours} hrs` : ""} ↗
        </LinkButton>
        <LinkButton href={job.links.jtDocuments} external>
          Bills {money(job.bills)}
          {job.billCount ? ` · ${plural(job.billCount, "bill")}` : ""} ↗
        </LinkButton>
        <LinkButton href={job.links.appTracking}>Tracking Sheets</LinkButton>
        {ym && <LinkButton href={hubHref(job.jtJobId, ym, { tab: "status" })}>Open in Jobs Hub</LinkButton>}
        {job.trackingSheetUrl && (
          <LinkButton href={job.trackingSheetUrl} external>
            Sheet ↗
          </LinkButton>
        )}
        {job.billingFolderUrl ? (
          <LinkButton href={job.billingFolderUrl} external>
            Backup ({job.billingFolderFiles}) ↗
          </LinkButton>
        ) : (
          <span className="text-xs text-neutral-500">No billing folder</span>
        )}
        <LinkButton href={job.links.appLabor}>Labor Review</LinkButton>
        {job.include ? null : <Chip tone="neutral">Left out</Chip>}
        {saving ? <span className="text-xs text-neutral-500">saving…</span> : null}
      </div>

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
