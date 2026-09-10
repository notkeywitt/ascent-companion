"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
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

/**
 * Invoicing Package — the month's client-billing summary, and the Google Doc it
 * writes.
 *
 * ONE DOC PER BILLING MONTH, named for the month it goes out in ("September '26
 * Invoicing Package") and filed in that month's own Drive invoicing folder. The
 * 30-minute tracking-sheet push rewrites it whenever a figure moves, so this
 * page is not the only thing keeping it current — it is where the office READS
 * the month and EDITS the wording.
 *
 * WHAT IS EDITABLE, AND WHY IT IS NOT THE DOC. Every rebuild replaces the doc's
 * body, so anything typed into the doc is lost on the next push. The editable
 * fields live here instead and are stored on the Project Database's "Invoicing
 * Summary" tab:
 *
 *   headline    the opening sentence, defaulted to "We are billing N clients a
 *               total of $X this month"
 *   per job     include/exclude, the customer and job headings the doc prints,
 *               and a note under that job
 *   closing     a paragraph at the end
 *
 * EVERY FIGURE COMES FROM JOBTREAD, through Apps Script: bills from the same
 * pull the tracking-sheet sync uses, labor from the month's time entries, and
 * the total from the job's client invoice when one exists. A job with no invoice
 * yet shows its COST and says so — cost is not what the client is billed, since
 * P&O and sales tax are added on the tracking sheet.
 *
 * Edits save on blur, one field at a time. There is no Save button on purpose:
 * the office walks down a list of nine jobs typing notes, and a page that needs
 * a commit at the end is a page that loses them.
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

const money = (n: number) =>
  (n < 0 ? "-$" : "$") +
  Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export default function InvoicingSummaryPage() {
  const [ym, setYm] = useState("");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState("");
  const [savingField, setSavingField] = useState("");
  const [saveError, setSaveError] = useState("");

  const months = useMemo(() => billingMonths(MONTH_COUNT), []);

  /**
   * The month's figures. Passing no `ym` on the first load is deliberate: the
   * route answers for the BILLING MONTH IN FORCE — the one picked on the home
   * page — so this page opens on the month the office is closing rather than
   * on whatever the calendar rolled to.
   */
  const load = useCallback(async (period: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        period ? `/api/invoicing-summary?ym=${encodeURIComponent(period)}` : "/api/invoicing-summary",
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
    void load("");
  }, [load]);

  const onPickMonth = (next: string) => {
    setYm(next);
    setBuildNote("");
    void load(next);
  };

  /**
   * Save ONE field. The page's state is already optimistic, so this only reports
   * a failure — and it re-reads nothing, because a whole-month refetch after
   * every keystroke-blur would take tens of seconds.
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
        // An edit changes what the doc would say, so it is now out of date.
        setData((d) => (d ? { ...d, stale: true } : d));
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

  const build = async () => {
    if (!data) return;
    setBuilding(true);
    setBuildNote("");
    setError("");
    // The build re-reads the whole month and then draws two cost rings per job,
    // which is minutes. Say so before the office decides the page has hung and
    // reloads it — a reload throws the work away and starts another one.
    const slow = setTimeout(
      () => setBuildNote("Still writing. The cost rings take a few minutes — leave this page open."),
      45_000,
    );
    try {
      const res = await fetch("/api/invoicing-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "build", ym: data.periodKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setBuildNote(String(body.note || "The doc is up to date."));
      setData((d) =>
        d ? { ...d, stale: false, written: true, docId: body.docId, docUrl: body.docUrl } : d,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The doc could not be written.");
    } finally {
      clearTimeout(slow);
      setBuilding(false);
    }
  };

  // Jobs grouped the way the doc groups them: by the customer heading the office
  // set, falling back to JobTread's own customer name.
  const customers = useMemo(() => {
    if (!data) return [];
    const order: string[] = [];
    const byName = new Map<string, JobRow[]>();
    for (const j of [...data.jobs].sort(
      (a, b) =>
        a.customerLabel.localeCompare(b.customerLabel) || a.jobLabel.localeCompare(b.jobLabel),
    )) {
      let list = byName.get(j.customerLabel);
      if (!list) {
        byName.set(j.customerLabel, (list = []));
        order.push(j.customerLabel);
      }
      list.push(j);
    }
    return order.map((name) => ({ name, jobs: byName.get(name)! }));
  }, [data]);

  // Every headline figure is recomputed from the page's OWN state, not read off
  // `data.totals`: leaving a job out has to move the total on the tap, and a
  // whole-month refetch to learn that takes tens of seconds.
  const included = data?.jobs.filter((j) => j.include) ?? [];
  const live = {
    total: included.reduce((s, j) => s + j.total, 0),
    labor: included.reduce((s, j) => s + j.labor, 0),
    bills: included.reduce((s, j) => s + j.bills, 0),
    invoiced: included.filter((j) => j.invoiced).length,
    customers: new Set(included.map((j) => j.customerLabel)).size,
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <PageHeader
        title="Invoicing Package"
        description={
          data
            ? `${data.monthLabel} billing · goes out as ${data.invoiceMonthLabel}`
            : "The month's client billing, and the doc it writes."
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
              disabled={loading || building}
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

      {loading && <Loading label="Reading the month from JobTread…" />}

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
                Labor {money(live.labor)} · Bills {money(live.bills)} ·{" "}
                {plural(included.length, "job")} · {plural(live.customers, "client")}
              </>
            }
            footnote={
              live.invoiced < included.length
                ? `${included.length - live.invoiced} job(s) have no client invoice yet, so their line shows cost — the client is billed the invoice, which adds P&O and sales tax.`
                : undefined
            }
          />

          {/* The doc itself: where it is, and whether it still matches. */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{data.docTitle}</p>
                <MetaLine
                  items={[
                    data.written ? "written" : "not written yet",
                    data.stale ? (
                      <Chip key="stale" tone="warning">
                        Out of date
                      </Chip>
                    ) : (
                      "up to date"
                    ),
                  ]}
                  className="mt-1"
                />
              </div>
              {data.docUrl && (
                <a
                  className={btn("secondary", "sm")}
                  href={data.docUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open doc ↗
                </a>
              )}
            </div>
            {buildNote && <p className="mt-2 text-xs text-neutral-500">{buildNote}</p>}
          </Card>

          {/* The wording the office owns. */}
          <section className="space-y-2">
            <SectionHeading
              trailing={savingField === "headline" ? <span className="text-[11px] text-neutral-500">saving…</span> : undefined}
            >
              Headline
            </SectionHeading>
            <Textarea
              rows={2}
              value={data.headline}
              placeholder={data.defaultHeadline}
              onChange={(e) => setData((d) => (d ? { ...d, headline: e.target.value } : d))}
              onBlur={(e) => void save("headline", { headline: e.target.value })}
            />
            <p className="text-[11px] text-neutral-500">
              Leave it empty and the doc writes the sentence above.
            </p>
          </section>

          {customers.length === 0 && (
            <EmptyState>Nothing was billed in {monthLabel(data.periodKey)}.</EmptyState>
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

              {cust.jobs.map((j) => (
                <JobCard
                  key={j.jtJobId}
                  job={j}
                  saving={savingField.startsWith(j.jtJobId)}
                  onPatch={(patch) => patchJob(j.jtJobId, patch)}
                  onSave={(field, patch) =>
                    void save(`${j.jtJobId}:${field}`, { jobId: j.jtJobId, ...patch })
                  }
                />
              ))}
            </section>
          ))}

          <section className="space-y-2">
            <SectionHeading>Closing note</SectionHeading>
            <Textarea
              rows={3}
              value={data.closing}
              placeholder="Anything that should follow the last job. Optional."
              onChange={(e) => setData((d) => (d ? { ...d, closing: e.target.value } : d))}
              onBlur={(e) => void save("closing", { closing: e.target.value })}
            />
          </section>

          {saveError && <Banner tone="error">{saveError}</Banner>}

          <StickyActionBar>
            <Button onClick={() => void build()} disabled={building}>
              {building ? "Writing the doc…" : data.written ? "Rewrite the doc" : "Write the doc"}
            </Button>
            <button
              type="button"
              className={btn("ghost", "md")}
              onClick={() => void load(ym)}
              disabled={building}
            >
              Refresh figures
            </button>
          </StickyActionBar>
        </div>
      )}
    </main>
  );
}

/**
 * One job: its figures, the links the doc prints, and the three things the
 * office can change about it.
 *
 * The editable block is folded away by default. Nine jobs each showing four
 * inputs is a wall of form; the money and the links are what the page is read
 * for, and the wording is what it is occasionally opened to fix.
 */
function JobCard({
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

  return (
    <Card className={job.include ? "" : "opacity-60"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{job.jobLabel}</p>
          <MetaLine
            items={[
              job.invoiced ? (
                <span key="inv">
                  Invoice{job.invoiceNumber ? ` #${job.invoiceNumber}` : ""} · {job.invoiceStatus}
                </span>
              ) : (
                <Chip key="nyi" tone="warning">
                  Not invoiced
                </Chip>
              ),
              job.include ? null : (
                <Chip key="out" tone="neutral">
                  Left out
                </Chip>
              ),
              saving ? "saving…" : null,
            ]}
            className="mt-1"
          />
        </div>
        <p className="shrink-0 text-lg font-bold tabular-nums">{money(job.total)}</p>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2 text-sm">
        <FigureCell
          label="Labor"
          value={money(job.labor)}
          meta={job.laborHours ? `${job.laborHours} hrs · ${plural(job.laborPeople, "person", "people")}` : "no time logged"}
          href={job.links.jtLabor}
        />
        <FigureCell
          label="Bills"
          value={money(job.bills)}
          meta={
            job.billCount
              ? `${plural(job.billCount, "bill")} · ${plural(job.vendorCount, "vendor")}`
              : "no bills"
          }
          href={job.links.jtDocuments}
        />
      </div>

      <MetaLine
        className="mt-2.5"
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
          <a
            key="jt"
            className="underline"
            href={job.invoiced ? job.links.jtInvoice : job.links.jtDocuments}
            target="_blank"
            rel="noreferrer"
          >
            {job.invoiced ? "Invoice ↗" : "JobTread ↗"}
          </a>,
          <a key="labor" className="underline" href={job.links.appLabor}>
            Labor Review
          </a>,
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
        className="mt-2 text-[11.5px] text-neutral-500 underline dark:text-neutral-400"
      >
        {open ? "Done editing" : "Edit wording"}
      </button>

      {open && (
        <div className="mt-3 space-y-2.5 border-t border-line-soft pt-3">
          <Toggle
            checked={job.include}
            label="Include this job in the package"
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
    </Card>
  );
}

/** One figure and where it came from. The whole cell is the link. */
function FigureCell({
  label,
  value,
  meta,
  href,
}: {
  label: string;
  value: string;
  meta: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border border-line-soft px-2.5 py-2 transition hover:border-line"
    >
      <span className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="block text-base font-semibold tabular-nums">{value}</span>
      <span className="block text-[11px] text-neutral-500">{meta}</span>
    </a>
  );
}
