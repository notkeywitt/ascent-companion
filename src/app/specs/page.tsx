"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Card,
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

  const rows = current?.list.rows ?? [];
  const openCount = rows.filter((r) => r.status === "open").length;
  const groups = useMemo(
    () =>
      groupByRoom(rows)
        .map((g) => ({ ...g, rows: g.rows.filter(({ row }) => filter === "all" || row.status === filter) }))
        .filter((g) => g.rows.length > 0),
    [rows, filter],
  );

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 lg:max-w-3xl">
      <PageHeader
        title="Specifications"
        description="An architect's spec selection list, room by room, with every product link live."
      />
      <div className="mb-4">
        <JobParamPicker includeAll={false} placeholder="Choose a job…" />
      </div>

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

      {!jobId ? (
        <EmptyState>Pick a job to see its spec list.</EmptyState>
      ) : (
        <>
          <Card className="mb-5 space-y-3">
            <div className="text-sm font-semibold">{current ? "Import a new revision" : "Import the spec list"}</div>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-transparent file:px-3 file:py-2 file:text-sm file:font-semibold"
            />
            <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
              The architect&apos;s PDF. For a spreadsheet, download it as a PDF first — its links survive.
            </p>
            <Button onClick={importPdf} disabled={!file || busy}>
              {busy ? "Reading the schedule… about a minute" : "Read PDF"}
            </Button>
          </Card>

          {loading ? (
            <Loading label="Loading the spec list…" />
          ) : !current ? (
            <EmptyState>No spec list for this job yet.</EmptyState>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="text-base font-semibold tracking-tight">
                  {current.list.title || current.fileName}
                </div>
                <MetaLine
                  items={[
                    current.list.revision && `Revision ${current.list.revision}`,
                    `${rows.length} items`,
                    `imported ${when(current.importedAt)}${current.importedBy ? ` by ${current.importedBy.split("@")[0]}` : ""}`,
                  ]}
                />
                {others.length > 0 && (
                  <Select
                    aria-label="Import to show"
                    value={String(current.id)}
                    onChange={(e) => void load(Number(e.target.value))}
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
              </div>

              <ChipScroller>
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

              {groups.map((g) => (
                <section key={`${g.room}-${g.rows[0].index}`} className="space-y-2">
                  <SectionHeading>{g.room}</SectionHeading>
                  <ListCard>
                    {g.rows.map(({ row, index }) => (
                      <Row
                        key={index}
                        row={row}
                        saving={saving === index}
                        onStatus={() => void toggle(index)}
                        lines={lines}
                        sending={sending === index}
                        onSend={(on) => setSending(on ? index : -1)}
                        onSave={(costItemId) => saveToJobTread(index, costItemId)}
                      />
                    ))}
                  </ListCard>
                </section>
              ))}

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
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Specs />
    </Suspense>
  );
}
