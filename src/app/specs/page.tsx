"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  ChipScroller,
  Chip,
  EmptyState,
  FilterChip,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  Select,
} from "@/components/ui";
import { JobParamPicker, useJobIdParam } from "@/components/JobPicker";
import {
  groupByRoom,
  specEntry,
  suggestBudgetLine,
  type BudgetLine,
  type SpecLink,
  type SpecList,
  type SpecRow,
} from "@/lib/specList";

/**
 * Specifications — an architect's spec selection list for one job.
 *
 * The architect sends a finish schedule as a PDF (or a sheet), with each spec
 * linked to its product page. JobTread cannot follow a link inside a PDF and
 * cannot hold a sheet, so the office imports the PDF here: /api/specs reads its
 * links and its rows, and this page shows them room by room with every link
 * live. A row is OPEN while a choice is still to be made, and DECIDED once it
 * is.
 *
 * "Save to JobTread" sends ONE row onto the budget line it belongs to (owner's
 * call: individually, never in bulk). The line becomes a JobTread Specification
 * with the row added to its description — see /api/specs/jobtread.
 */

interface Current {
  id: number;
  /** Whether the PDF itself was kept (imports before 2026-09-29 have none). */
  hasPdf: boolean;
  fileName: string;
  importedAt: string;
  importedBy: string;
  list: SpecList;
}
interface Other {
  id: number;
  fileName: string;
  importedAt: string;
}

type Filter = "all" | "open" | "decided";
type ViewMode = "app" | "pdf";

async function readJson(r: Response) {
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b.error || `HTTP ${r.status}`);
  return b;
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** A spec's text, as a link when the schedule linked it. */
function Linked({ text, links }: { text: string; links: SpecLink[] }) {
  const cls = "text-accent underline decoration-current/40 underline-offset-2 hover:decoration-current dark:text-accent-soft";
  if (links.length === 1) {
    return (
      <a href={links[0].url} target="_blank" rel="noopener noreferrer" className={cls}>
        {text || links[0].text || links[0].url} ↗
      </a>
    );
  }
  return (
    <span>
      {text}
      {links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className={`${cls} ml-1.5`}>
          {l.text || new URL(l.url).hostname} ↗
        </a>
      ))}
    </span>
  );
}

/** Pick the budget line, see what will be added, save. */
function SendPanel({
  row,
  lines,
  onSave,
  onCancel,
}: {
  row: SpecRow;
  lines: BudgetLine[];
  onSave: (costItemId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState(() => suggestBudgetLine(row, lines));
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, BudgetLine[]>();
    for (const l of lines) m.set(l.group || "No group", [...(m.get(l.group || "No group") ?? []), l]);
    return [...m];
  }, [lines]);
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-accent/5 p-2.5">
      <Select aria-label="Budget line" value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">Choose the budget line…</option>
        {groups.map(([group, ls]) => (
          <optgroup key={group} label={group}>
            {ls.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.isSpecification ? " · Specification" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
        Added to the line&apos;s description, below its estimate note. The line becomes a Specification the client must
        approve.
      </p>
      <pre className="whitespace-pre-wrap break-words rounded bg-white p-2 font-sans text-[12px] dark:bg-ink-raised">
        {specEntry(row)}
      </pre>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!choice || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(choice);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save to JobTread"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Row({
  row,
  onStatus,
  saving,
  lines,
  sending,
  onSend,
  onSave,
}: {
  row: SpecRow;
  onStatus: () => void;
  saving: boolean;
  lines: BudgetLine[] | null;
  sending: boolean;
  onSend: (on: boolean) => void;
  onSave: (costItemId: string) => Promise<void>;
}) {
  const open = row.status === "open";
  return (
    <div className="space-y-1 border-b border-line-soft px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight">
          {row.item}
          {row.qty && <span className="font-normal text-neutral-500"> × {row.qty}</span>}
        </span>
        {open && <Chip tone="warning">Open</Chip>}
        <button
          type="button"
          onClick={onStatus}
          disabled={saving}
          className="shrink-0 text-[11.5px] font-semibold text-neutral-500 hover:text-accent disabled:opacity-50"
        >
          {open ? "Mark decided" : "Reopen"}
        </button>
      </div>
      <div className="text-sm">
        {row.spec || row.specLinks.length ? (
          <Linked text={row.spec} links={row.specLinks} />
        ) : (
          <span className="text-neutral-500">No spec yet</span>
        )}
      </div>
      {row.alternates.map((a, i) => (
        <div key={i} className="text-[13px]">
          <span className="text-neutral-500">Alternate: </span>
          <Linked text={a.text} links={a.links} />
        </div>
      ))}
      {row.question && (
        <p className="text-[13px]">
          <span className="font-semibold">Question: </span>
          {row.question}
        </p>
      )}
      {row.impact && <p className="text-[13px] text-neutral-500">Impact: {row.impact}</p>}
      {row.answer && (
        <p className="text-[13px]">
          <span className="font-semibold">Answer: </span>
          {row.answer}
        </p>
      )}
      {row.notes && <p className="text-[13px] text-neutral-500">{row.notes}</p>}
      <MetaLine
        items={[
          row.tag && `Tag ${row.tag}`,
          row.addedBy && `Added by ${row.addedBy}`,
          row.revised && `Revised ${row.revised}`,
          ...row.other.map((o) => `${o.label}: ${o.value}`),
          row.jt && `In JobTread: ${row.jt.line}`,
        ]}
      />
      {lines &&
        (sending ? (
          <SendPanel row={row} lines={lines} onSave={onSave} onCancel={() => onSend(false)} />
        ) : (
          <button
            type="button"
            onClick={() => onSend(true)}
            className="text-[11.5px] font-semibold text-accent hover:underline dark:text-accent-soft"
          >
            {row.jt ? "Save to JobTread again" : "Save to JobTread"}
          </button>
        ))}
    </div>
  );
}

function Specs() {
  const [jobId] = useJobIdParam();
  const [current, setCurrent] = useState<Current | null>(null);
  const [others, setOthers] = useState<Other[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [saving, setSaving] = useState(-1);
  const [lines, setLines] = useState<BudgetLine[] | null>(null);
  const [sending, setSending] = useState(-1);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<ViewMode>("app");

  const show = (b: { current: Current | null; others: Other[] }) => {
    setCurrent(b.current);
    setOthers(b.others ?? []);
  };

  const load = useCallback(
    async (id = 0) => {
      if (!jobId) return;
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ jobId, ...(id ? { id: String(id) } : {}) });
        show(await readJson(await fetch(`/api/specs?${q}`, { cache: "no-store" })));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [jobId],
  );

  useEffect(() => {
    setCurrent(null);
    setOthers([]);
    void load();
  }, [load]);

  // The job's budget lines, for "Save to JobTread". Without them the button is
  // simply not offered.
  useEffect(() => {
    setLines(null);
    setSending(-1);
    if (!jobId) return;
    let alive = true;
    fetch(`/api/specs/jobtread?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then(readJson)
      .then((b) => alive && setLines(b.lines ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [jobId]);

  async function saveToJobTread(index: number, costItemId: string) {
    if (!current) return;
    setError("");
    setNotice("");
    try {
      const b = await readJson(
        await fetch("/api/specs/jobtread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId: current.id, index, costItemId }),
        }),
      );
      if (!b.wrote) {
        setNotice(b.message ?? "Nothing was written to JobTread.");
        return;
      }
      const rows = current.list.rows.map((r, i) => (i === index ? { ...r, jt: b.jt } : r));
      setCurrent({ ...current, list: { ...current.list, rows } });
      setSending(-1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function importPdf() {
    if (!file || !jobId) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("jobId", jobId);
      form.set("file", file);
      show(await readJson(await fetch("/api/specs", { method: "POST", body: form })));
      setFile(null);
      setFilter("all");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(index: number) {
    if (!current) return;
    const next = current.list.rows[index].status === "open" ? "decided" : "open";
    setSaving(index);
    setError("");
    try {
      await readJson(
        await fetch("/api/specs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: current.id, index, status: next }),
        }),
      );
      const rows = current.list.rows.map((r, i) => (i === index ? { ...r, status: next } : r));
      setCurrent({ ...current, list: { ...current.list, rows } as SpecList });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(-1);
    }
  }

  const rows = useMemo(() => current?.list.rows ?? [], [current]);
  const openCount = rows.filter((r) => r.status === "open").length;
  const groups = useMemo(
    () =>
      groupByRoom(rows)
        .map((g) => ({ ...g, rows: g.rows.filter(({ row }) => filter === "all" || row.status === filter) }))
        .filter((g) => g.rows.length > 0),
    [rows, filter],
  );

  const rowProps = (index: number) => ({
    saving: saving === index,
    onStatus: () => void toggle(index),
    lines,
    sending: sending === index,
    onSend: (on: boolean) => setSending(on ? index : -1),
    onSave: (costItemId: string) => saveToJobTread(index, costItemId),
  });

  return (
    // Full width: a finish schedule is a wide table, and this page is mostly
    // used at a desk (owner, 2026-09-29).
    <main className="px-4 pb-24 pt-6 pad:px-7">
      <PageHeader
        title="Specifications"
        description="An architect's spec selection list, with every product link live."
      />

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}
      {notice && (
        <Banner tone="warning" className="mb-4">
          {notice}
        </Banner>
      )}

      {/* The job, and a new revision to read in — one row at a desk. */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <JobParamPicker includeAll={false} placeholder="Choose a job…" />
        </div>
        {jobId && (
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <input
              type="file"
              accept="application/pdf"
              aria-label={current ? "New revision PDF" : "Spec list PDF"}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block max-w-xs text-sm file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-transparent file:px-3 file:py-2 file:text-sm file:font-semibold"
            />
            <Button onClick={importPdf} disabled={!file || busy}>
              {busy ? "Reading the schedule… about a minute" : "Read PDF"}
            </Button>
            <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
              For a spreadsheet, download it as a PDF first — its links survive.
            </span>
          </div>
        )}
      </div>

      {!jobId ? (
        <EmptyState>Pick a job to see its spec list.</EmptyState>
      ) : loading ? (
        <Loading label="Loading the spec list…" />
      ) : !current ? (
        <EmptyState>No spec list for this job yet. Read the architect&apos;s PDF above.</EmptyState>
      ) : (
        <div className="space-y-4">
          {/* What is on screen, and the controls over it. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="text-base font-semibold tracking-tight">{current.list.title || current.fileName}</div>
              <MetaLine
                items={[
                  current.list.revision && `Revision ${current.list.revision}`,
                  `${rows.length} items`,
                  `imported ${when(current.importedAt)}${current.importedBy ? ` by ${current.importedBy.split("@")[0]}` : ""}`,
                ]}
              />
            </div>
            {others.length > 0 && (
              <Select
                aria-label="Import to show"
                value={String(current.id)}
                onChange={(e) => void load(Number(e.target.value))}
                className="w-auto max-w-xs"
              >
                {[current, ...others]
                  .sort((a, b) => b.id - a.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {when(o.importedAt)} — {o.fileName}
                    </option>
                  ))}
              </Select>
            )}
            <div className="flex items-center gap-2">
              <FilterChip on={mode === "app"} onClick={() => setMode("app")}>
                App view
              </FilterChip>
              <FilterChip on={mode === "pdf"} onClick={() => setMode("pdf")}>
                PDF
              </FilterChip>
            </div>
            {mode === "app" ? (
              <ChipScroller bleed="0px">
                <FilterChip on={filter === "all"} onClick={() => setFilter("all")}>
                  All {rows.length}
                </FilterChip>
                <FilterChip on={filter === "open"} onClick={() => setFilter("open")}>
                  Open {openCount}
                </FilterChip>
                <FilterChip on={filter === "decided"} onClick={() => setFilter("decided")}>
                  Decided {rows.length - openCount}
                </FilterChip>
              </ChipScroller>
            ) : (
              current.hasPdf && (
                <a
                  href={`/api/specs/pdf?id=${current.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-accent hover:underline dark:text-accent-soft"
                >
                  Open the PDF in a new tab ↗
                </a>
              )
            )}
          </div>

          {mode === "pdf" ? (
            current.hasPdf ? (
              // The browser's own PDF viewer — the architect's document as sent,
              // with its links live.
              <iframe
                src={`/api/specs/pdf?id=${current.id}`}
                title="The architect's spec list PDF"
                className="h-[calc(100dvh-16rem)] min-h-[560px] w-full rounded-xl border border-line bg-white"
              />
            ) : (
              <EmptyState>
                This import has no PDF kept (imports before 2026-09-29, or a file over 8 MB). Read the PDF again to see
                it here.
              </EmptyState>
            )
          ) : (
            <>
              {/* DESK: one table, spreadsheet-dense, like the architect's own. */}
              <SpecTable groups={groups} rowProps={rowProps} />

              {/* PHONE / TABLET: the same rows, stacked, room by room. */}
              <div className="space-y-5 lg:hidden">
                {groups.map((g) => (
                  <section key={`${g.room}-${g.rows[0].index}`} className="space-y-2">
                    <SectionHeading>{g.room}</SectionHeading>
                    <ListCard>
                      {g.rows.map(({ row, index }) => (
                        <Row key={index} row={row} {...rowProps(index)} />
                      ))}
                    </ListCard>
                  </section>
                ))}
              </div>

              {current.list.unplaced.length > 0 && (
                <section className="space-y-2">
                  <SectionHeading>Links not matched to a row</SectionHeading>
                  <ListCard>
                    {current.list.unplaced.map((l) => (
                      <ListRow key={l.url} href={l.url} external label={l.text || l.url} desc={l.url} />
                    ))}
                  </ListCard>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}

type RowProps = {
  saving: boolean;
  onStatus: () => void;
  lines: BudgetLine[] | null;
  sending: boolean;
  onSend: (on: boolean) => void;
  onSave: (costItemId: string) => Promise<void>;
};

const TH = "sticky z-10 border-b border-line bg-cream px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-ink dark:text-neutral-400";
const TD = "px-2 py-1.5 align-top";

/** The desk view: every row in one dense table, a band per room. */
function SpecTable({
  groups,
  rowProps,
}: {
  groups: { room: string; rows: { row: SpecRow; index: number }[] }[];
  rowProps: (index: number) => RowProps;
}) {
  return (
    <table className="hidden w-full table-fixed border-collapse text-[12.5px] leading-snug lg:table">
      <colgroup>
        <col className="w-[11%]" />
        <col className="w-[3%]" />
        <col className="w-[20%]" />
        <col className="w-[14%]" />
        <col className="w-[15%]" />
        <col className="w-[14%]" />
        <col className="w-[8%]" />
        <col className="w-[4%]" />
        <col className="w-[5%]" />
        <col className="w-[6%]" />
      </colgroup>
      <thead>
        <tr>
          {["Item", "Qty", "Final spec", "Alternate", "Notes", "Question", "Answer", "Tag", "Status", "JobTread"].map((h) => (
            // Pinned right under the app header as the table scrolls.
            <th key={h} className={TH} style={{ top: "var(--appheader-h)" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={`${g.room}-${g.rows[0].index}`}>
            <tr>
              <td colSpan={10} className="border-b border-line bg-accent/5 px-2 py-1 text-[12px] font-bold tracking-tight">
                {g.room}
              </td>
            </tr>
            {g.rows.map(({ row, index }) => (
              <TableRow key={index} row={row} {...rowProps(index)} />
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function TableRow({ row, saving, onStatus, lines, sending, onSend, onSave }: { row: SpecRow } & RowProps) {
  const open = row.status === "open";
  return (
    <>
      <tr className="border-b border-line-soft transition hover:bg-accent/5">
        <td className={`${TD} font-semibold`}>{row.item}</td>
        <td className={`${TD} tabular-nums`}>{row.qty}</td>
        <td className={TD}>
          {row.spec || row.specLinks.length ? (
            <Linked text={row.spec} links={row.specLinks} />
          ) : (
            <span className="text-neutral-400">—</span>
          )}
        </td>
        <td className={TD}>
          {row.alternates.map((a, i) => (
            <div key={i}>
              <Linked text={a.text} links={a.links} />
            </div>
          ))}
        </td>
        <td className={`${TD} text-neutral-500 dark:text-neutral-400`}>
          {row.notes}
          {row.other.map((o) => (
            <div key={o.label}>
              {o.label}: {o.value}
            </div>
          ))}
        </td>
        <td className={TD}>
          {row.question}
          {row.impact && <div className="text-neutral-500">Impact: {row.impact}</div>}
        </td>
        <td className={TD}>{row.answer}</td>
        <td className={`${TD} text-neutral-500`} title={[row.addedBy && `Added by ${row.addedBy}`, row.revised && `Revised ${row.revised}`].filter(Boolean).join(" · ")}>
          {row.tag}
        </td>
        <td className={TD}>
          <button
            type="button"
            onClick={onStatus}
            disabled={saving}
            title={open ? "Mark decided" : "Reopen"}
            className="disabled:opacity-50"
          >
            {open ? <Chip tone="warning">Open</Chip> : <span className="text-[11.5px] text-neutral-500">Decided</span>}
          </button>
        </td>
        <td className={TD}>
          {row.jt && (
            <div className="truncate text-[11.5px] text-neutral-500" title={row.jt.line}>
              ✓ {row.jt.line}
            </div>
          )}
          {lines && !sending && (
            <button
              type="button"
              onClick={() => onSend(true)}
              className="text-[11.5px] font-semibold text-accent hover:underline dark:text-accent-soft"
            >
              {row.jt ? "Save again" : "Save…"}
            </button>
          )}
        </td>
      </tr>
      {sending && lines && (
        <tr>
          <td colSpan={10} className="border-b border-line-soft px-2 pb-2">
            <SendPanel row={row} lines={lines} onSave={onSave} onCancel={() => onSend(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Specs />
    </Suspense>
  );
}
