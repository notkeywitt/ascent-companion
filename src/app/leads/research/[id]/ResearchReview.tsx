"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { toast } from "@/components/Toast";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  StickyActionBar,
  Textarea,
  quietInputCls,
} from "@/components/ui";
import {
  BACKGROUND_FOLDER,
  FACT_GROUPS,
  TARGET_LABEL,
  type Dossier,
  type Fact,
  type MatchInfo,
  type Proposal,
  type ProposalTarget,
} from "@/lib/leadResearchRules";

/**
 * Review one lead research run (/leads/research/<id>). Everything Claude found
 * is PENCILED IN — drawn with a dashed underline — until a person approves it.
 * Approve writes the ticked JobTread fields, saves the summary and property
 * fields here, and uploads the ticked files to JobTread folder "Background".
 */

interface RunView {
  id: string;
  leadKey: string;
  leadName: string;
  address: string;
  status: "requested" | "running" | "ready" | "reviewed" | "error" | "cancelled";
  requestNote: string;
  requestedBy: string;
  runner: string;
  finishedAt: string;
  summary: string;
  match: MatchInfo;
  dossier: Dossier & { warnings?: string[] };
  error: string;
  reviewedBy: string;
  reviewedAt: string;
}

interface FileView {
  id: string;
  name: string;
  kind: "photo" | "document";
  mime: string;
  size: number;
  source: string;
  description: string;
  status: "staged" | "uploaded" | "discarded";
  error: string;
  complete: boolean;
}

const TARGETS: ProposalTarget[] = ["account", "location", "job"];
const pencil = "border-b border-dashed border-warn/70";
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

function SourceLink({ href }: { href: string }) {
  if (!href) return null;
  let host = href;
  try {
    host = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    /* keep the raw text */
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
      {host}
    </a>
  );
}

export function ResearchReview({ id }: { id: string }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [files, setFiles] = useState<FileView[]>([]);
  const [filesTarget, setFilesTarget] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // The reviewer's working copy.
  const [summary, setSummary] = useState("");
  const [picks, setPicks] = useState<Record<string, { on: boolean; value: string }>>({});
  const [facts, setFacts] = useState<Fact[]>([]);
  const [keepFile, setKeepFile] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/research?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the dossier.");
      const r: RunView = data.run;
      setRun(r);
      setFiles(data.files ?? []);
      setFilesTarget(data.filesTarget ?? "");
      setSummary(r.summary);
      setFacts(r.dossier.facts);
      setPicks(Object.fromEntries(r.dossier.proposals.map((p) => [p.id, { on: p.selected && !p.applied, value: p.value }])));
      setKeepFile(Object.fromEntries((data.files ?? []).map((f: FileView) => [f.id, f.status === "staged" && f.complete])));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const reviewing = run?.status === "ready" || run?.status === "reviewed";
  const editable = run?.status === "ready";
  const proposals = run?.dossier.proposals ?? [];
  const pickedFields = proposals.filter((p) => !p.applied && picks[p.id]?.on && picks[p.id]?.value.trim());
  const stagedFiles = files.filter((f) => f.status === "staged" && f.complete);
  const pickedFiles = stagedFiles.filter((f) => keepFile[f.id]);
  const factGroups = useMemo(
    () => FACT_GROUPS.map((g) => ({ group: g, rows: facts.filter((f) => f.group === g) })).filter((g) => g.rows.length),
    [facts],
  );

  async function approve() {
    if (!run) return;
    const lines: string[] = [];
    try {
      if (editable || pickedFields.length) {
        setBusy("Saving the fields…");
        const res = await fetch("/api/leads/research/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: run.id,
            picks: pickedFields.map((p) => ({ id: p.id, value: picks[p.id].value })),
            facts,
            summary,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Approve failed.");
        if (data.previewed) {
          lines.push("JobTread writes are off on this deployment. Nothing was written.");
          setResult(lines);
          return;
        }
        for (const r of data.results ?? []) {
          lines.push(
            r.ok ? `${TARGET_LABEL[r.target as ProposalTarget]}: ${r.fields} field(s) saved in JobTread.` : `${TARGET_LABEL[r.target as ProposalTarget]}: not saved — ${r.error}`,
          );
        }
      }
      let n = 0;
      for (const f of stagedFiles) {
        setBusy(keepFile[f.id] ? `Uploading ${++n} of ${pickedFiles.length}…` : "Dropping files left out…");
        const res = await fetch("/api/leads/research/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: f.id, action: keepFile[f.id] ? "upload" : "discard" }),
        });
        const data = await res.json().catch(() => ({}));
        if (keepFile[f.id] && !res.ok) lines.push(`${f.name}: not uploaded — ${data.error || res.status}`);
      }
      if (pickedFiles.length) lines.push(`${pickedFiles.length} file(s) sent to ${BACKGROUND_FOLDER}.`);
      toast("Approved");
      setResult(lines);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setResult(lines);
    } finally {
      setBusy("");
    }
  }

  async function discard() {
    if (!run || !confirm("Throw this research away? Its files are dropped and nothing reaches JobTread.")) return;
    setBusy("Discarding…");
    await fetch(`/api/leads/research?id=${encodeURIComponent(run.id)}`, { method: "DELETE" });
    setBusy("");
    await load();
  }

  if (loading && !run) return <Loading />;
  if (!run) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-3">
        <Banner tone="error">{err || "No such research run."}</Banner>
      </main>
    );
  }

  const m = run.match;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-32 pt-3 pad:px-7">
      <PageHeader
        title="Property research"
        description={
          <MetaLine
            items={[
              <Link key="l" href={`/leads#lead-${run.leadKey}`} className="text-accent hover:underline">
                {run.leadName || "Lead"}
              </Link>,
              run.address,
              m.parcel && `Parcel ${m.parcel}`,
            ]}
          />
        }
      />

      {err && <Banner tone="error">{err}</Banner>}
      {run.status === "requested" && <Banner tone="info">Waiting for a Mac to start this run.</Banner>}
      {run.status === "running" && <Banner tone="info">Claude is researching on {run.runner || "a Mac"}. This page fills in when it is done.</Banner>}
      {run.status === "error" && <Banner tone="warning">Research stopped: {run.error}</Banner>}
      {run.status === "cancelled" && <Banner tone="neutral">This run was discarded.</Banner>}
      {editable && (
        <Banner tone="warning">
          Penciled in. Nothing has reached JobTread. Check each value against its source, untick what is wrong, then approve.
        </Banner>
      )}
      {run.status === "reviewed" && (
        <Banner tone="success">
          Reviewed by {run.reviewedBy || "the office"} on {when(run.reviewedAt)}.
        </Banner>
      )}
      {m.confidence !== "high" && reviewing && (
        <div className="mt-3">
          <Banner tone="warning">
            Parcel match: {m.confidence}. {m.note || "Confirm this is the right property before you approve."}
          </Banner>
        </div>
      )}
      {result.length > 0 && (
        <div className="mt-3">
          <Banner tone="info">
            <ul className="list-disc pl-4">
              {result.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {reviewing && (
        <div className="mt-5 space-y-6">
          {/* ------------------------------------------------------- summary */}
          <section className="space-y-2">
            <SectionHeading>Summary</SectionHeading>
            {editable ? (
              <Textarea rows={7} value={summary} onChange={(e) => setSummary(e.target.value)} className={pencil} />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{run.summary}</p>
            )}
            {run.requestNote && <MetaLine items={[`Asked to look into: ${run.requestNote}`]} />}
          </section>

          {/* ----------------------------------------------- JobTread fields */}
          <section className="space-y-2">
            <SectionHeading trailing={<span className="text-xs text-neutral-500">{pickedFields.length} ticked</span>}>
              JobTread fields
            </SectionHeading>
            {proposals.length === 0 ? (
              <EmptyState>Nothing new for JobTread. Every field the research could fill already holds the same value.</EmptyState>
            ) : (
              TARGETS.filter((t) => proposals.some((p) => p.target === t)).map((t) => (
                <Card key={t} pad={false} className="divide-y divide-line-soft">
                  <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{TARGET_LABEL[t]}</div>
                  {proposals
                    .filter((p) => p.target === t)
                    .map((p) => (
                      <ProposalRow
                        key={p.id}
                        p={p}
                        pick={picks[p.id] ?? { on: false, value: p.value }}
                        editable={!p.applied && reviewing}
                        onChange={(next) => setPicks((s) => ({ ...s, [p.id]: next }))}
                      />
                    ))}
                </Card>
              ))
            )}
          </section>

          {/* ------------------------------------------ the app's own fields */}
          <section className="space-y-2">
            <SectionHeading>Property details</SectionHeading>
            <p className="text-xs text-neutral-500">Kept in the app, not in JobTread. Edit or remove a row before you approve.</p>
            {factGroups.length === 0 && <p className="text-xs italic text-neutral-500">None.</p>}
            {factGroups.map(({ group, rows }) => (
              <Card key={group} pad={false} className="divide-y divide-line-soft">
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{group}</div>
                {rows.map((f) => (
                  <div key={f.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-start gap-2 px-3 py-2 text-sm">
                    <div className="pt-2 text-neutral-600 dark:text-neutral-400">{f.label}</div>
                    <div className="space-y-0.5">
                      {editable ? (
                        <textarea
                          rows={Math.min(6, Math.ceil(f.value.length / 22) || 1)}
                          value={f.value}
                          onChange={(e) => setFacts((all) => all.map((x) => (x.id === f.id ? { ...x, value: e.target.value } : x)))}
                          className={`w-full resize-y ${quietInputCls} ${pencil}`}
                        />
                      ) : (
                        <div className="whitespace-pre-wrap pt-2">{f.value}</div>
                      )}
                      <div className="text-[11px]">
                        <SourceLink href={f.source} />
                      </div>
                    </div>
                    {editable && (
                      <Button size="xs" variant="ghost" aria-label={`Remove ${f.label}`} onClick={() => setFacts((all) => all.filter((x) => x.id !== f.id))}>
                        ✕
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
            ))}
          </section>

          {/* ------------------------------------------------------- permits */}
          {run.dossier.permits.length > 0 && (
            <section className="space-y-2">
              <SectionHeading>Permits and inspections</SectionHeading>
              <Card pad={false} className="divide-y divide-line-soft">
                {run.dossier.permits.map((p, i) => (
                  <div key={i} className="space-y-0.5 px-3 py-2 text-sm">
                    <MetaLine items={[p.number && <span className="font-semibold text-neutral-800 dark:text-neutral-200">{p.number}</span>, p.type, p.status, p.date]} />
                    {p.description && <p className="text-neutral-700 dark:text-neutral-300">{p.description}</p>}
                    <div className="text-[11px]">
                      <SourceLink href={p.source} />
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          )}

          {/* --------------------------------------------------------- files */}
          <section className="space-y-2">
            <SectionHeading trailing={<span className="text-xs text-neutral-500">{pickedFiles.length} ticked</span>}>
              Photos and documents
            </SectionHeading>
            <p className="text-xs text-neutral-500">
              Approve uploads the ticked files to JobTread, folder {BACKGROUND_FOLDER}
              {filesTarget ? `, on ${filesTarget}` : ""}.
            </p>
            {files.length === 0 && <p className="text-xs italic text-neutral-500">No files were downloaded.</p>}
            <div className="grid grid-cols-2 gap-2 pad:grid-cols-3">
              {files
                .filter((f) => f.kind === "photo")
                .map((f) => (
                  <FileTile key={f.id} f={f} on={!!keepFile[f.id]} onToggle={(on) => setKeepFile((s) => ({ ...s, [f.id]: on }))} />
                ))}
            </div>
            <Card pad={false} className="divide-y divide-line-soft">
              {files
                .filter((f) => f.kind !== "photo")
                .map((f) => (
                  <div key={f.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    {f.status === "staged" && f.complete ? (
                      <Checkbox checked={!!keepFile[f.id]} onChange={(e) => setKeepFile((s) => ({ ...s, [f.id]: e.target.checked }))} className="pt-0.5" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      {f.status === "staged" && f.complete ? (
                        <a href={`/api/leads/research/file?id=${f.id}`} target="_blank" rel="noreferrer" className="break-words font-medium text-accent hover:underline">
                          {f.name}
                        </a>
                      ) : (
                        <span className="break-words font-medium">{f.name}</span>
                      )}
                      {f.description && <p className="text-xs text-neutral-600 dark:text-neutral-400">{f.description}</p>}
                      <MetaLine
                        items={[kb(f.size), <SourceLink key="s" href={f.source} />, fileState(f), f.error && <span className="text-danger">{f.error}</span>]}
                      />
                    </div>
                  </div>
                ))}
            </Card>
          </section>

          {/* ------------------------------------------- questions + sources */}
          {run.dossier.openQuestions.length > 0 && (
            <section className="space-y-2">
              <SectionHeading>To confirm</SectionHeading>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {run.dossier.openQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-2">
            <SectionHeading>Sources</SectionHeading>
            <Card pad={false} className="divide-y divide-line-soft">
              {run.dossier.sources.map((s, i) => (
                <div key={i} className="px-3 py-2 text-sm">
                  <MetaLine
                    items={[
                      <span key="n" className="font-medium text-neutral-800 dark:text-neutral-200">{s.name || s.url}</span>,
                      <SourceLink key="u" href={s.url} />,
                      !s.reached && <Chip tone="warning">not reached</Chip>,
                    ]}
                  />
                  {s.note && <p className="text-xs text-neutral-600 dark:text-neutral-400">{s.note}</p>}
                </div>
              ))}
            </Card>
            {(run.dossier.warnings?.length ?? 0) > 0 && (
              <details className="text-xs text-neutral-500">
                <summary className="cursor-pointer">Left out by the app ({run.dossier.warnings?.length})</summary>
                <ul className="mt-1 list-disc pl-5">
                  {run.dossier.warnings?.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            <MetaLine items={[run.runner && `Run on ${run.runner}`, run.finishedAt && `finished ${when(run.finishedAt)}`, run.requestedBy && `asked by ${run.requestedBy}`]} />
          </section>
        </div>
      )}

      {reviewing && (editable || pickedFields.length > 0 || stagedFiles.length > 0) && (
        <StickyActionBar>
          <span className="text-sm text-neutral-500">
            {busy || `${pickedFields.length} field${pickedFields.length === 1 ? "" : "s"} · ${pickedFiles.length} file${pickedFiles.length === 1 ? "" : "s"}`}
          </span>
          <div className="ml-auto flex gap-2">
            {editable && (
              <Button variant="ghost" disabled={!!busy} onClick={discard}>
                Discard
              </Button>
            )}
            <Button disabled={!!busy} onClick={approve}>
              Approve
            </Button>
          </div>
        </StickyActionBar>
      )}
    </main>
  );
}

function fileState(f: FileView): string {
  if (f.status === "uploaded") return `in JobTread › ${BACKGROUND_FOLDER}`;
  if (f.status === "discarded") return "left out";
  if (!f.complete) return "did not finish uploading";
  return "";
}

function ProposalRow({
  p,
  pick,
  editable,
  onChange,
}: {
  p: Proposal;
  pick: { on: boolean; value: string };
  editable: boolean;
  onChange: (next: { on: boolean; value: string }) => void;
}) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 text-sm">
      {editable ? (
        <Checkbox checked={pick.on} onChange={(e) => onChange({ ...pick, on: e.target.checked })} className="pt-2" aria-label={`Write ${p.label}`} />
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="font-medium">{p.label}</span>
          {p.applied && <Chip tone="success">saved</Chip>}
          {!p.applied && p.current && <Chip tone="warning">replaces a value</Chip>}
        </div>
        {editable ? (
          p.type === "option" && p.options.length ? (
            <select value={pick.value} onChange={(e) => onChange({ ...pick, value: e.target.value })} className={`w-full ${quietInputCls} ${pencil}`}>
              {p.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input value={pick.value} onChange={(e) => onChange({ ...pick, value: e.target.value })} className={`w-full ${quietInputCls} ${pencil}`} />
          )
        ) : (
          <div>{p.value}</div>
        )}
        <MetaLine
          items={[
            p.current && `now: ${p.current}`,
            <SourceLink key="s" href={p.source} />,
            p.note,
            p.error && <span className="text-danger">{p.error}</span>,
          ]}
        />
      </div>
    </div>
  );
}

function FileTile({ f, on, onToggle }: { f: FileView; on: boolean; onToggle: (on: boolean) => void }) {
  const staged = f.status === "staged" && f.complete;
  return (
    <div className={`overflow-hidden rounded-control border ${on ? "border-accent" : "border-line"} bg-white dark:bg-ink-raised`}>
      {staged ? (
        <a href={`/api/leads/research/file?id=${f.id}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- a staged file served by our own route */}
          <img src={`/api/leads/research/file?id=${f.id}`} alt={f.description || f.name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
        </a>
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center p-2 text-center text-xs text-neutral-500">{fileState(f) || f.name}</div>
      )}
      <div className="space-y-0.5 p-2 text-xs">
        {staged && <Checkbox checked={on} onChange={(e) => onToggle(e.target.checked)} label="Keep" />}
        <div className="line-clamp-2 text-neutral-600 dark:text-neutral-400">{f.description || f.name}</div>
        <SourceLink href={f.source} />
      </div>
    </div>
  );
}
