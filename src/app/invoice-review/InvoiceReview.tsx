"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  Button,
  Card,
  Chip,
  ChipScroller,
  CountBadge,
  EmptyState,
  FilterChip,
  Loading,
  PageHeader,
  SectionHeading,
  Select,
  StatementBlock,
  Textarea,
  Toggle,
} from "@/components/ui";
import { buildBrief } from "@/lib/invoiceReview/brief";
import { money } from "@/lib/invoiceReview/types";
import type { Finding, ReviewPayload } from "@/lib/invoiceReview/types";

/**
 * Pick a billing month, run the review, work the list.
 *
 * THE SHAPE OF THE SCREEN. One figure at the top (what's in question), one
 * paragraph saying what to look at first, then the findings worst-first. Each
 * row opens to the arithmetic behind it and a link to the thing it is about, so
 * the office can settle a finding without leaving the page — or record a ruling
 * that stops it coming back.
 *
 * WHY THERE IS A BUTTON. A month's review is a dozen jobs × six API calls and
 * can take a minute; running it on mount would spend that on every stray tap of
 * the launcher. The month is chosen first, then the review is asked for.
 *
 * READ-ONLY except for rulings. Nothing on this page can change an invoice, a
 * bill or a file — the one write is the note saying "we looked at this and it's
 * fine", which is why the button says that rather than "dismiss".
 */

/** The last 15 billing months, newest first. (Deliberately a local copy rather
 *  than an import from trackingsheet/Roster: that module is a whole client
 *  component, and pulling it in for ten lines of dates would ship the coding
 *  workbench to this page's bundle.) */
function monthChoices() {
  const out: { ym: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

/** The month the office is most likely reviewing right now: the billing month
 *  just closed. Matches the 10th-to-10th window the rest of the app uses — on
 *  or before the 10th we are still closing the month before last. */
function defaultYm(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - (d.getDate() <= 10 ? 2 : 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Lens = "all" | "fix" | "look" | "set-aside";

const LENSES: { id: Lens; label: string }[] = [
  { id: "fix", label: "To fix" },
  { id: "look", label: "To look at" },
  { id: "set-aside", label: "Set aside" },
  { id: "all", label: "Everything" },
];

function inLens(f: Finding, lens: Lens): boolean {
  if (lens === "all") return true;
  if (f.suppressedBy) return lens === "set-aside";
  if (lens === "set-aside") return false;
  return lens === "fix" ? f.severity === "error" : f.severity === "warning";
}

/**
 * "this morning" / "yesterday" / "on 12 Aug" for a filed run's timestamp.
 *
 * Deliberately coarse. The exact minute a sweep ran is never the question; the
 * question is only ever whether what's on screen is current enough to act on.
 */
function whenChecked(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "earlier";
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${then.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function InvoiceReview() {
  const months = useMemo(monthChoices, []);
  const [ym, setYm] = useState(defaultYm);
  const [data, setData] = useState<ReviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  /** True only while a LIVE sweep is running. Reading a filed run is instant,
   *  and telling someone it "takes a minute" while it doesn't is its own bug. */
  const [sweeping, setSweeping] = useState(false);
  const [error, setError] = useState("");
  const [lens, setLens] = useState<Lens>("fix");
  const [open, setOpen] = useState<Set<string>>(new Set());

  // The ruling being written, if any: which finding, the note, and how wide.
  const [ruling, setRuling] = useState<{ finding: Finding; reason: string; wide: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  // "Copied" / "Couldn't copy" on the hand-to-Claude button.
  const [copied, setCopied] = useState("");

  /**
   * Load a month. `stored` reads the last FILED run — instant, because it is
   * that run rather than a fresh sweep of JobTread, Drive and Gmail — and
   * answers nothing at all when the month has never been reviewed. A live run
   * is the explicit "Run review" action, and files itself on the way out.
   */
  const load = useCallback(
    async (stored: boolean) => {
      setLoading(true);
      setSweeping(!stored);
      setError("");
      setData(null);
      try {
        const q = stored ? "&stored=only" : "";
        const res = await fetch(`/api/invoice-review?ym=${encodeURIComponent(ym)}${q}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Review failed (${res.status})`);
        // stored=only answers `{ stored: null }` for a month nobody has checked.
        // That is not an error and not an empty review — it is "no run on file",
        // and the page falls back to prompting for one.
        if (stored && json && json.stored === null) return;
        setData(json as ReviewPayload);
        setOpen(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Review failed.");
      } finally {
        setLoading(false);
        setSweeping(false);
      }
    },
    [ym],
  );

  /** The explicit action: sweep everything again, now. */
  const run = useCallback(() => load(false), [load]);

  // Opening a month shows what was last found for it straight away — the
  // scheduled run means that is usually this morning's. Nothing is fetched from
  // JobTread here, so this costs a single row read.
  useEffect(() => {
    void load(true);
  }, [load]);

  const saveRuling = useCallback(async () => {
    if (!ruling || !ruling.reason.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/invoice-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: ruling.finding.key,
          kind: ruling.finding.kind,
          jobId: ruling.finding.jobId,
          scope: ruling.wide ? "job-kind" : "finding",
          reason: ruling.reason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Could not save that.");
      // Reflect it immediately rather than re-running a minute-long review.
      setData((d) =>
        d
          ? {
              ...d,
              findings: d.findings.map((f) =>
                f.key === ruling.finding.key ||
                (ruling.wide && f.kind === ruling.finding.kind && f.jobId === ruling.finding.jobId)
                  ? {
                      ...f,
                      suppressedBy: {
                        reason: ruling.reason.trim(),
                        by: "you",
                        at: new Date().toISOString(),
                        scope: ruling.wide ? "job-kind" : "finding",
                      },
                    }
                  : f,
              ),
            }
          : d,
      );
      setRuling(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  }, [ruling]);

  /**
   * Hand the whole review to Claude without an API key.
   *
   * The app's own paragraph needs ANTHROPIC_API_KEY; this needs nothing. It puts
   * a self-contained briefing on the clipboard — the findings, the gaps, and an
   * instruction not to redo the arithmetic — to paste into Claude wherever the
   * office already has it. Clipboard rather than a share sheet or a download,
   * because pasting into a chat is the one gesture that works identically on a
   * phone and a laptop.
   */
  const copyForClaude = useCallback(async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(buildBrief(data));
      setCopied("Copied — paste it into Claude");
    } catch {
      setCopied("Couldn't copy. Long-press to select instead.");
    }
    setTimeout(() => setCopied(""), 4000);
  }, [data]);

  /**
   * The same briefing, through the OS share sheet — one tap to the Claude app on
   * a phone, instead of copy, switch app, paste. Offered only where the browser
   * actually has it (so: not desktop Chrome), which is why it is state rather
   * than a render-time check — reading navigator during render would disagree
   * between the server and the first client paint.
   */
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const shareForClaude = useCallback(async () => {
    if (!data) return;
    try {
      await navigator.share({
        title: `Invoice review — ${data.evidence.monthLabel}`,
        text: buildBrief(data),
      });
    } catch {
      // A cancelled share sheet lands here too, so say nothing.
    }
  }, [data]);

  // Memoized, not inline: both feed useMemo dependency lists below, and a fresh
  // array identity on every render would re-group the whole list each keystroke
  // in the ruling box.
  const live = useMemo(
    () => data?.findings.filter((f) => !f.suppressedBy) ?? [],
    [data],
  );
  const shown = useMemo(
    () => data?.findings.filter((f) => inLens(f, lens)) ?? [],
    [data, lens],
  );
  const atStake = live.reduce((s, f) => s + Math.abs(f.amount ?? 0), 0);
  const counts = useMemo(
    () => ({
      fix: live.filter((f) => f.severity === "error").length,
      look: live.filter((f) => f.severity === "warning").length,
      "set-aside": data?.findings.filter((f) => f.suppressedBy).length ?? 0,
      all: data?.findings.length ?? 0,
    }),
    [data, live],
  );

  // Findings read best grouped the way the office works: one customer at a time.
  const groups = useMemo(() => {
    const by = new Map<string, Finding[]>();
    for (const f of shown) {
      const k = f.customerName || f.jobName || "Unassigned";
      by.set(k, [...(by.get(k) ?? []), f]);
    }
    return Array.from(by.entries());
  }, [shown]);

  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const monthLabel = months.find((m) => m.ym === ym)?.label ?? ym;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">
      <PageHeader
        title="Invoice Review"
        description="Cross-check a month's client invoices against the bills behind them and the backup filed in Drive."
      />

      <Card className="mt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-xs uppercase tracking-wide opacity-70">
              Billing month
            </span>
            <Select value={ym} onChange={(e) => setYm(e.target.value)} disabled={loading}>
              {months.map((m) => (
                <option key={m.ym} value={m.ym}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
          <Button onClick={run} disabled={loading}>
            {loading ? "Reviewing…" : data ? "Check again" : "Run review"}
          </Button>
          {data ? (
            <Button variant="outline" onClick={copyForClaude}>
              Copy for Claude
            </Button>
          ) : null}
          {data && canShare ? (
            <Button variant="ghost" onClick={shareForClaude}>
              Share…
            </Button>
          ) : null}
        </div>
        {copied ? <p className="mt-2 text-xs opacity-70">{copied}</p> : null}
        {data && data.summarySource === "fallback" ? (
          <p className="mt-2 text-xs opacity-60">
            {/* Say WHY, not just that it happened. A silent fallback hid a real
                outage for as long as it lasted — see narrate.ts. */}
            {data.summaryNote ||
              "The summary is written from the checks, not by Claude."}{" "}
            “Copy for Claude” hands the whole review to Claude anywhere you already have
            it.
          </p>
        ) : null}
        {data ? (
          <p className="mt-3 text-xs opacity-60">
            {/* A filed run must never be mistaken for a fresh one. */}
            {data.storedAt
              ? `Last checked ${whenChecked(data.storedAt)} — press “Check again” to sweep it now. `
              : "Checked just now. "}
            Backup is filed in {data.evidence.folderRoot}
          </p>
        ) : null}
      </Card>

      {error ? (
        <Banner tone="error" className="mt-4">
          {error}
        </Banner>
      ) : null}

      {loading ? (
        <Loading
          label={
            sweeping
              ? `Reviewing ${monthLabel} — this takes a minute`
              : `Opening ${monthLabel}…`
          }
        />
      ) : null}

      {data ? (
        <>
          <StatementBlock
            className="mt-6"
            label={`In question — ${data.evidence.monthLabel}`}
            value={money(atStake)}
            sub={`${live.length} finding${live.length === 1 ? "" : "s"} across ${data.evidence.jobs.length} job${data.evidence.jobs.length === 1 ? "" : "s"}`}
            footnote={
              data.summarySource === "claude"
                ? "Read by Claude over the checks below."
                : "Summary written from the checks below."
            }
          />

          <Banner tone={counts.fix ? "warning" : "success"} className="mt-4">
            {data.summary}
          </Banner>

          {data.evidence.warnings.length ? (
            <Banner tone="error" className="mt-3">
              <span className="font-medium">This review is incomplete.</span>{" "}
              {data.evidence.warnings.join(" · ")}
            </Banner>
          ) : null}

          {/* A skipped check must never read as a passed one. */}
          {!data.evidence.emailChecked && !data.evidence.warnings.length ? (
            <Banner tone="neutral" className="mt-3">
              The office mailbox wasn&apos;t searched, so nothing here says whether every
              vendor invoice that arrived this period actually reached JobTread.
            </Banner>
          ) : null}

          <ChipScroller className="mt-5">
            {LENSES.map((l) => (
              <FilterChip key={l.id} on={lens === l.id} onClick={() => setLens(l.id)}>
                {l.label} <CountBadge n={counts[l.id]} />
              </FilterChip>
            ))}
          </ChipScroller>

          {!shown.length ? (
            <EmptyState className="mt-6">
              {lens === "fix"
                ? `Nothing to fix in ${data.evidence.monthLabel}.`
                : "Nothing here."}
            </EmptyState>
          ) : null}

          {groups.map(([customer, findings]) => (
            <section key={customer} className="mt-6">
              <SectionHeading trailing={<CountBadge n={findings.length} />}>
                {customer}
              </SectionHeading>
              <div className="mt-2 overflow-hidden rounded-xl border border-line">
                {findings.map((f, i) => {
                  const isOpen = open.has(f.key);
                  return (
                    <div
                      key={f.key}
                      className={i ? "border-t border-line-soft" : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(f.key)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left"
                      >
                        <Chip
                          tone={
                            f.suppressedBy
                              ? "neutral"
                              : f.severity === "error"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {f.suppressedBy ? "Set aside" : f.severity === "error" ? "Fix" : "Look"}
                        </Chip>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{f.title}</span>
                          <span className="block text-xs opacity-60">
                            {f.jobName}
                            {f.invoiceNumber ? ` · invoice #${f.invoiceNumber}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums opacity-70">
                          {f.amount == null ? "" : money(f.amount)}
                        </span>
                      </button>

                      {isOpen ? (
                        <div className="border-t border-line-soft px-4 py-3">
                          <p className="text-sm leading-relaxed opacity-80">{f.detail}</p>

                          {f.suppressedBy ? (
                            <p className="mt-3 text-xs opacity-60">
                              Set aside by {f.suppressedBy.by}
                              {f.suppressedBy.scope === "job-kind"
                                ? " for every finding like it on this job"
                                : ""}
                              : “{f.suppressedBy.reason}”
                            </p>
                          ) : null}

                          <div className="mt-3 flex flex-wrap gap-2">
                            {f.sourceLink ? (
                              <a
                                href={f.sourceLink}
                                target={f.sourceLink.startsWith("http") ? "_blank" : undefined}
                                rel="noreferrer"
                              >
                                <Button variant="outline" size="sm">
                                  {f.sourceLabel ?? "Open source"}
                                </Button>
                              </a>
                            ) : null}
                            {f.suppressedBy ? null : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRuling({ finding: f, reason: "", wide: false })}
                              >
                                Not an issue…
                              </Button>
                            )}
                          </div>

                          {ruling?.finding.key === f.key ? (
                            <div className="mt-3 rounded-lg border border-line-strong p-3">
                              <p className="text-xs opacity-70">
                                Say why this is fine. It is recorded, and this finding won&apos;t
                                be raised again.
                              </p>
                              <Textarea
                                className="mt-2"
                                rows={3}
                                autoFocus
                                value={ruling.reason}
                                placeholder="e.g. the client is billed monthly for this allowance — there is no vendor invoice"
                                onChange={(e) =>
                                  setRuling({ ...ruling, reason: e.target.value })
                                }
                              />
                              <div className="mt-2">
                                <Toggle
                                  checked={ruling.wide}
                                  onChange={(wide) => setRuling({ ...ruling, wide })}
                                  label="Apply to every finding like this on this job"
                                />
                              </div>
                              <div className="mt-3 flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={saveRuling}
                                  disabled={saving || !ruling.reason.trim()}
                                >
                                  {saving ? "Saving…" : "Record it"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setRuling(null)}
                                  disabled={saving}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}
