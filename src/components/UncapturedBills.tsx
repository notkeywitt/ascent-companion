"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { JobPicker } from "@/components/JobPicker";
import { Banner, Button, Chip, CountBadge, Input, Select, Spinner } from "@/components/ui";

/**
 * "Not in JobTread" — the uncaptured-bill queue, shown above the Invoicing list.
 *
 * WHY IT LIVES HERE. Every row in this queue is a real cost that never reached
 * JobTread, which means it is missing from the client invoice you are about to
 * stage. It belongs in the invoicing workflow, not in a settings corner, and it
 * deliberately ignores the month picker: these rows go stale precisely because
 * nothing was looking at them, and several carry the WRONG billing period (bills
 * ingested before 2026-07-07 were stamped with the arrival month instead of the
 * before-the-10th rule). Filtering by month would hide the ones most in need of
 * fixing. Each row shows its own period instead.
 *
 * The editor exposes the CHILD LINES, not just the header total, because the
 * push builds JobTread's lines from them — correcting the header alone would
 * push the wrong numbers. Amounts here are frequently wrong outright (a $4.00
 * charge extracted as $5,850.00), so the line list is fully editable: retype,
 * recode, add, remove.
 */

interface Line {
  lineId?: string;
  csi: string;
  description: string;
  amount: number;
}
interface Item {
  expId: string;
  vendor: string;
  vendorId: string;
  amount: number;
  date: string;
  status: string;
  projectId: string;
  projectName: string;
  customerName: string;
  jtJobId: string;
  billingMonth: number | null;
  billingYear: number | null;
  driveUrl: string;
  paymentReceipt: boolean;
  lines: Line[];
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const period = (it: Item) =>
  it.billingMonth && it.billingYear ? `${MONTHS[it.billingMonth - 1]} ${it.billingYear}` : "no period";

const jobLabel = (it: Item) =>
  [it.customerName, it.projectName].filter(Boolean).join(" / ") || it.projectId || "no job";

// A queue row is only actionable while it is still uncaptured. Both backend
// guards answer "already in JobTread" when a sync linked it while you were
// looking — that means it is handled, so drop it rather than showing an error
// the office can do nothing about. Same convention as /needs-project.
const isStale = (err?: string) => /already in JobTread/i.test(err ?? "");

/** Working copy of one row's edits — untouched rows push exactly as they are. */
interface Draft {
  lines: Line[];
  jobId: string;
  date: string;
  dirty: boolean;
}

export function UncapturedBills({ jobId }: { jobId?: string } = {}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  // cost code -> label, per JobTread job. The push coerces any code outside the
  // job's budget to the placeholder, so the picker offers the budget, not a
  // global CSI list — what you choose here is what actually lands.
  const [budgets, setBudgets] = useState<Record<string, Record<string, string>>>({});
  // Proof the sweep ran, not just that it found nothing: how many in-scope bills
  // it examined, the window it covered, and when. An empty queue and a broken
  // scan are indistinguishable without this, and since this queue is the ONLY
  // thing watching these rows, "nothing found" has to be visibly different from
  // "nothing ran".
  const [scan, setScan] = useState<{ scanned: number; since: string; at: string } | null>(null);
  const [checking, setChecking] = useState(true);

  const load = useCallback(async () => {
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/uncaptured", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Request failed");
        setScan(null);
      } else {
        setItems(json.items ?? []);
        setScan({
          scanned: Number(json.scanned ?? 0),
          since: String(json.since ?? ""),
          at: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setScan(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // In the per-job workbench this shows only that job's stranded bills — the
  // rest of the page is about one job, and a queue of fifteen other customers'
  // bills there is noise. Nothing is hidden: the count of the others is linked
  // through to the all-jobs view, which lists every one.
  const shown = useMemo(
    () => (jobId ? (items ?? []).filter((i) => i.jtJobId === jobId) : (items ?? [])),
    [items, jobId],
  );
  const elsewhere = (items?.length ?? 0) - shown.length;

  // Fetch each involved job's budget once the section is opened — not on mount,
  // since most visits to Invoicing never expand this.
  useEffect(() => {
    if (!open) return;
    const ids = [...new Set(shown.map((i) => i.jtJobId).filter(Boolean))].filter(
      (id) => !(id in budgets),
    );
    if (ids.length === 0) return;
    let alive = true;
    fetch(`/api/job-budget?jobIds=${ids.slice(0, 25).join(",")}`)
      .then((r) => r.json())
      .then((j) => {
        if (alive && j.budgets) setBudgets((b) => ({ ...b, ...j.budgets }));
      })
      .catch(() => {
        /* the code field falls back to free text — never block the queue */
      });
    return () => {
      alive = false;
    };
  }, [open, shown, budgets]);

  const total = useMemo(() => shown.reduce((s, i) => s + (i.amount || 0), 0), [shown]);

  const drop = (expId: string) => {
    setItems((prev) => (prev ?? []).filter((i) => i.expId !== expId));
    setExpanded((e) => (e === expId ? null : e));
  };

  const draftFor = (it: Item): Draft =>
    drafts[it.expId] ?? { lines: it.lines.map((l) => ({ ...l })), jobId: "", date: it.date, dirty: false };

  const setDraft = (expId: string, patch: Partial<Draft>) =>
    setDrafts((d) => {
      const base = d[expId] ?? { lines: [], jobId: "", date: "", dirty: false };
      return { ...d, [expId]: { ...base, ...patch, dirty: true } };
    });

  const toggle = (it: Item) => {
    const next = expanded === it.expId ? null : it.expId;
    setExpanded(next);
    if (next && !drafts[it.expId]) {
      setDrafts((d) => ({
        ...d,
        [it.expId]: { lines: it.lines.map((l) => ({ ...l })), jobId: "", date: it.date, dirty: false },
      }));
    }
  };

  async function post(expId: string, body: Record<string, unknown>, failLabel: string) {
    setBusy((b) => ({ ...b, [expId]: true }));
    setMsg((m) => ({ ...m, [expId]: "" }));
    try {
      const res = await fetch("/api/uncaptured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expId, ...body }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        if (isStale(json.error)) {
          drop(expId);
          return;
        }
        setMsg((m) => ({ ...m, [expId]: json.error ?? failLabel }));
        return;
      }
      drop(expId);
    } catch (e) {
      setMsg((m) => ({ ...m, [expId]: e instanceof Error ? e.message : "Network error" }));
    } finally {
      setBusy((b) => ({ ...b, [expId]: false }));
    }
  }

  function push(it: Item) {
    const d = draftFor(it);
    const body: Record<string, unknown> = {};
    // Only send what was actually edited — an untouched row pushes verbatim.
    if (d.dirty) {
      body.lines = d.lines.map((l) => ({
        csi: l.csi,
        description: l.description,
        amount: Number(l.amount) || 0,
      }));
      if (d.jobId) body.jobId = d.jobId;
      if (d.date && d.date !== it.date) body.dateReceived = d.date;
    }
    post(it.expId, body, "Push failed");
  }

  function dismiss(it: Item) {
    if (
      !window.confirm(
        `Dismiss ${it.vendor}?\n\nUse this when the charge already reached JobTread another way (hand-entered, re-imported). The sheet row and its PDF are kept — it just stops showing here.`,
      )
    )
      return;
    post(it.expId, { dismiss: true }, "Dismiss failed");
  }

  function remove(it: Item) {
    if (
      !window.confirm(
        `Delete ${it.vendor} ${money(it.amount)}?\n\nThis removes the sheet row, its line items, and moves the PDF to the Drive bin. Use it for a payment receipt, a duplicate, or a junk extraction — not for a real unbilled cost.`,
      )
    )
      return;
    post(it.expId, { delete: true }, "Delete failed");
  }

  // ── First load. Say so, so a slow Apps Script round trip doesn't read as "clear". ──
  if (checking && !items && !error) {
    return (
      <p className="mb-4 flex items-center gap-2 text-xs text-neutral-500">
        <Spinner />
        Checking for bills not in JobTread…
      </p>
    );
  }

  // ── The scan FAILED. This must never be mistakable for an all-clear, because
  // the failure mode is silent by nature: no queue, no bills, no complaint. The
  // overwhelmingly likely cause is the Apps Script web app not carrying the
  // action yet (clasp push advances the code but NOT the versioned deployment),
  // so name that instead of a bare error string. ──
  if (error) {
    const notDeployed = /unknown action/i.test(error);
    return (
      <Banner tone="error" className="mb-4">
        <span className="block font-semibold">Couldn’t check for unpushed bills</span>
        <span className="mt-0.5 block text-xs">
          {notDeployed
            ? "The Apps Script web app doesn’t have this action yet — redeploy it (clasp deploy -i …), since clasp push alone doesn’t advance the versioned deployment."
            : error}
        </span>
        <span className="mt-1 block text-xs opacity-80">
          Until this succeeds, treat the absence of a queue as unknown, not as clear.
        </span>
        <button
          type="button"
          onClick={load}
          disabled={checking}
          className="mt-2 text-xs font-semibold underline disabled:opacity-50"
        >
          {checking ? "Retrying…" : "Retry"}
        </button>
      </Banner>
    );
  }

  // ── All clear, and provably so: the count of bills actually examined, the
  // window covered, and the time of the check. ──
  if (shown.length === 0) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-emerald-300 bg-emerald-50/60 px-3 py-2 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/20">
        <span className="font-semibold text-emerald-800 dark:text-emerald-300">
          ✓ {jobId ? "Every bill on this job is in JobTread" : "Every ingested bill is in JobTread"}
        </span>
        <span className="flex items-center gap-3 text-emerald-700/80 dark:text-emerald-400/70">
          <span>
            {scan
              ? `checked ${scan.scanned.toLocaleString("en-US")} bill${
                  scan.scanned === 1 ? "" : "s"
                }${scan.since ? ` since ${scan.since}` : ""} · ${scan.at}`
              : "checked"}
          </span>
          {elsewhere > 0 && (
            <Link href="/recode" className="font-semibold text-accent dark:text-accent-soft">
              {elsewhere} on other jobs →
            </Link>
          )}
          <button
            type="button"
            onClick={load}
            disabled={checking}
            className="font-semibold underline disabled:opacity-50"
          >
            {checking ? "Checking…" : "Re-check"}
          </button>
        </span>
      </div>
    );
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
            Not in JobTread
            {shown.length > 0 && <CountBadge n={shown.length} />}
          </span>
          <span className="mt-0.5 block text-xs text-amber-800/80 dark:text-amber-200/70">
            {money(total)} of ingested bills never pushed — missing from{" "}
            {jobId ? "this job’s invoice" : "these invoices"}
          </span>
          {/* Same scan stamp the all-clear state carries, so a stale or partial
              read is as visible here as it is there. */}
          {scan && (
            <span className="mt-0.5 block text-[11px] text-amber-800/60 dark:text-amber-200/50">
              of {scan.scanned.toLocaleString("en-US")} checked
              {scan.since ? ` since ${scan.since}` : ""} · {scan.at}
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm font-semibold text-amber-900 dark:text-amber-200">
          {open ? "Hide" : "Review"}
        </span>
      </button>

      {open && (
        <div className="border-t border-amber-200 px-3 pb-3 pt-3 dark:border-amber-900/60">
          {error && <Banner tone="error">{error}</Banner>}

          <ul className="space-y-2">
            {shown.map((it) => {
              const d = draftFor(it);
              const codes = budgets[it.jtJobId] ?? {};
              const codeList = Object.keys(codes).sort();
              const lineTotal = d.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
              const isOpen = expanded === it.expId;

              return (
                <li
                  key={it.expId}
                  className="rounded-lg border border-line bg-white dark:bg-ink-raised"
                >
                  <button
                    type="button"
                    onClick={() => toggle(it)}
                    className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{it.vendor}</span>
                        {it.paymentReceipt && (
                          <Chip tone="danger" title="Line items read “Payment of $…” — this looks like a receipt, not a bill">
                            receipt?
                          </Chip>
                        )}
                        {it.status !== "Needs Review" && <Chip tone="warning">{it.status}</Chip>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-neutral-500">
                        {jobLabel(it)} · {it.date || "no date"} · bills {period(it)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-semibold tabular-nums">
                        {money(it.amount)}
                      </span>
                      <span className="text-xs text-neutral-400">{isOpen ? "close" : "fix"}</span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-line px-3 pb-3 pt-3">
                      {it.driveUrl && (
                        <a
                          href={it.driveUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mb-3 inline-block text-sm font-semibold text-accent hover:underline dark:text-accent-soft"
                        >
                          View PDF ↗
                        </a>
                      )}

                      <div className="mb-3 grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                            Job
                          </label>
                          <JobPicker
                            value={d.jobId}
                            onChange={(id) => setDraft(it.expId, { jobId: id })}
                            includeAll={false}
                            placeholder={jobLabel(it)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                            Received
                          </label>
                          <Input
                            type="date"
                            value={d.date}
                            onChange={(e) => setDraft(it.expId, { date: e.target.value })}
                          />
                        </div>
                      </div>

                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        Lines
                      </label>
                      <div className="space-y-1.5">
                        {d.lines.map((ln, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            {codeList.length > 0 ? (
                              <Select
                                value={ln.csi}
                                onChange={(e) => {
                                  const lines = d.lines.map((l, j) =>
                                    j === i ? { ...l, csi: e.target.value } : l,
                                  );
                                  setDraft(it.expId, { lines });
                                }}
                                className="!py-1.5 text-xs"
                              >
                                {!codes[ln.csi] && <option value={ln.csi}>{ln.csi || "— code —"}</option>}
                                {codeList.map((code) => (
                                  <option key={code} value={code}>
                                    {code}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <Input
                                value={ln.csi}
                                placeholder="cost code"
                                onChange={(e) => {
                                  const lines = d.lines.map((l, j) =>
                                    j === i ? { ...l, csi: e.target.value } : l,
                                  );
                                  setDraft(it.expId, { lines });
                                }}
                                className="!py-1.5 text-xs"
                              />
                            )}
                            <Input
                              type="number"
                              step="0.01"
                              value={String(ln.amount)}
                              onChange={(e) => {
                                const lines = d.lines.map((l, j) =>
                                  j === i ? { ...l, amount: Number(e.target.value) } : l,
                                );
                                setDraft(it.expId, { lines });
                              }}
                              className="!w-28 shrink-0 !py-1.5 text-right font-mono text-xs"
                            />
                            <button
                              type="button"
                              aria-label="Remove line"
                              onClick={() =>
                                setDraft(it.expId, { lines: d.lines.filter((_, j) => j !== i) })
                              }
                              className="shrink-0 rounded px-2 py-1.5 text-xs text-neutral-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() =>
                            setDraft(it.expId, {
                              lines: [
                                ...d.lines,
                                { csi: codeList[0] ?? "", description: "", amount: 0 },
                              ],
                            })
                          }
                          className="text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
                        >
                          + Add line
                        </button>
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {money(lineTotal)}
                        </span>
                      </div>

                      {d.dirty && (
                        <p className="mt-2 text-xs text-neutral-500">
                          The billing period is recalculated from the received date on push (bills
                          arriving on or before the 10th bill to the previous month), and the PDF
                          re-files itself to match.
                        </p>
                      )}

                      {msg[it.expId] && (
                        <Banner tone="error" className="mt-2 !px-3 !py-2 !text-xs">
                          {msg[it.expId]}
                        </Banner>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          onClick={() => push(it)}
                          disabled={busy[it.expId] || d.lines.length === 0}
                        >
                          {busy[it.expId] ? (
                            <>
                              <Spinner className="mr-1.5" />
                              Pushing…
                            </>
                          ) : d.dirty ? (
                            "Fix & Push"
                          ) : (
                            "Push as-is"
                          )}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="!py-2"
                          onClick={() => dismiss(it)}
                          disabled={busy[it.expId]}
                          title="Already in JobTread another way — keep the row and PDF, just stop showing it"
                        >
                          Dismiss
                        </Button>
                        <button
                          type="button"
                          onClick={() => remove(it)}
                          disabled={busy[it.expId]}
                          className="ml-auto rounded-lg px-2.5 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <span>
              Every billing period is listed, not just the month above — these rows go unnoticed
              precisely because nothing else surfaces them.
            </span>
            {elsewhere > 0 && (
              <Link href="/recode" className="font-semibold text-accent dark:text-accent-soft">
                {elsewhere} on other jobs →
              </Link>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
