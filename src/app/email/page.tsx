"use client";

import { useCallback, useEffect, useState } from "react";

// The Companion's replacement for the Gmail add-on "Log Invoice" card. Lists
// unprocessed inbox emails (from Apps Script), and for each one you pick a
// project, optionally mark PAID, and log it — the identical one-click import
// (capture → Gemini → Drive → sheet row → optional JT draft → Gmail labels)
// runs server-side in Apps Script via _addonLogInvoiceCore.

interface EmailRow {
  threadId: string;
  messageId: string;
  subject: string;
  from: string;
  date: string; // ISO
  attachmentCount: number;
  hasPdf?: boolean; // first message has a PDF attachment (best-effort)
  // PDF attachments of the original message, in stable order. >1 means a single
  // vendor email carrying invoices for several jobs — the row splits into one
  // project picker per PDF and logs a separate bill for each.
  attachments?: { index: number; name: string }[];
  tagged?: boolean; // manually flagged "_Invoice to Log"
  labels: string[];
}

interface ProjectItem {
  label: string;
  id: string;
}

// Per-PDF outcome inside a multi-invoice log response.
interface AttResult {
  index: number;
  ok: boolean;
  kind?: string;
  message?: string;
  error?: string;
}

interface LogResult {
  ok: boolean;
  kind?: string; // single: logged|already_logged|…; multi: logged (all done) | partial
  message?: string;
  error?: string;
  finalized?: boolean; // multi: thread marked Processed (every attachment logged)
  results?: AttResult[]; // multi: one entry per attachment, keyed by index
}

// A row the office has dismissed from the active list without running the
// full import: either it was entered into JobTread by hand ("processed",
// tagged with the chosen job) or it isn't an invoice at all ("notRelevant").
interface Handled {
  type: "processed" | "notRelevant";
  projectLabel?: string;
}

async function callEmail<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Strip the "Name <email>" wrapper down to the friendly name (or the address).
function fmtFrom(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<.*>\s*$/);
  return (m ? m[1] : from).trim();
}

// Deep-link to the Gmail conversation so the office can read the full body.
// threadId is Gmail's own thread id (GmailThread.getId() server-side), which is
// exactly the fragment Gmail's web UI routes on. "#all/" finds the thread in any
// label, so it still works after the thread is marked Processed. "u/0" is the
// first signed-in account — assumes the office Gmail is that account.
function gmailUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

// Per-attachment form state key: sel/paid are shared maps, keyed by messageId
// for single invoices and messageId#index for each PDF in a multi-invoice email.
function attKey(messageId: string, index: number): string {
  return `${messageId}#${index}`;
}

export default function EmailPage() {
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Per-row form + result state, keyed by messageId.
  const [sel, setSel] = useState<Record<string, string>>({});
  const [paid, setPaid] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState("");
  const [results, setResults] = useState<Record<string, LogResult>>({});
  // Rows pulled out of the active list via the Processed / Not-relevant
  // checkboxes. UI-only for now — kept in state so they can be undone.
  const [handled, setHandled] = useState<Record<string, Handled>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [emailsRes, projectsRes] = await Promise.all([
        callEmail<{ ok: boolean; emails?: EmailRow[]; error?: string }>({ action: "listEmails" }),
        callEmail<{ ok: boolean; projects?: ProjectItem[]; error?: string }>({ action: "listProjects" }),
      ]);
      if (!emailsRes.ok) throw new Error(emailsRes.error || "Could not load emails.");
      if (!projectsRes.ok) throw new Error(projectsRes.error || "Could not load projects.");
      setEmails(emailsRes.emails ?? []);
      setProjects(projectsRes.projects ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function logOne(row: EmailRow) {
    const projectId = sel[row.messageId] || "";
    if (!projectId || busyId) return;
    setBusyId(row.messageId);
    setResults((r) => ({ ...r, [row.messageId]: { ok: true, message: "Logging…" } }));
    try {
      const res = await callEmail<LogResult>({
        action: "logInvoice",
        messageId: row.messageId,
        projectId,
        paid: !!paid[row.messageId],
      });
      setResults((r) => ({ ...r, [row.messageId]: res }));
    } catch (e) {
      setResults((r) => ({
        ...r,
        [row.messageId]: { ok: false, error: e instanceof Error ? e.message : "Network error" },
      }));
    } finally {
      setBusyId("");
    }
  }

  // Multi-invoice email: log one bill per PDF. Every attachment must have a
  // project picked (the back-end marks the thread Processed only once ALL the
  // assignments it receives log, so we send all of them together — a partial
  // send would finalize the thread with PDFs still un-logged).
  async function logAll(row: EmailRow) {
    const atts = row.attachments ?? [];
    if (busyId || atts.length === 0) return;
    const assignments = atts.map((a) => ({
      index: a.index,
      projectId: sel[attKey(row.messageId, a.index)] || "",
      paid: !!paid[attKey(row.messageId, a.index)],
    }));
    if (assignments.some((a) => !a.projectId)) return; // all pickers required
    setBusyId(row.messageId);
    setResults((r) => ({ ...r, [row.messageId]: { ok: true, message: "Logging…" } }));
    try {
      const res = await callEmail<LogResult>({
        action: "logInvoice",
        messageId: row.messageId,
        assignments,
      });
      setResults((r) => ({ ...r, [row.messageId]: res }));
    } catch (e) {
      setResults((r) => ({
        ...r,
        [row.messageId]: { ok: false, error: e instanceof Error ? e.message : "Network error" },
      }));
    } finally {
      setBusyId("");
    }
  }

  // Clear the transient per-row result once a mark succeeds.
  function clearResult(id: string) {
    setResults((r) => {
      const n = { ...r };
      delete n[id];
      return n;
    });
  }

  // The job(s) to tag when marking a row Processed: the single-invoice picker,
  // or every assigned per-PDF picker on a multi-invoice email (deduped).
  function processedTargets(row: EmailRow): { ids: string[]; labels: string[] } {
    const atts = row.attachments ?? [];
    const raw =
      atts.length > 1
        ? atts.map((a) => sel[attKey(row.messageId, a.index)] || "")
        : [sel[row.messageId] || ""];
    const ids = Array.from(new Set(raw.filter(Boolean)));
    const labels = ids.map((id) => projects.find((p) => p.id === id)?.label ?? "");
    return { ids, labels };
  }

  // Entered into JobTread by hand → tag the thread Processed + the assigned
  // job(s) and drop it from the list. Needs at least one job so the server can
  // tag it (a multi-invoice email tags every assigned job).
  async function markProcessed(row: EmailRow) {
    const { ids, labels } = processedTargets(row);
    if (!ids.length || busyId) return;
    const projectLabel = labels.filter(Boolean).join(", ");
    setBusyId(row.messageId);
    setResults((r) => ({ ...r, [row.messageId]: { ok: true, message: "Marking processed…" } }));
    try {
      const res = await callEmail<LogResult>({
        action: "markProcessed",
        messageId: row.messageId,
        projectId: ids[0], // back-compat with the single-project server path
        projectIds: ids,
      });
      if (res.ok) {
        setHandled((h) => ({ ...h, [row.messageId]: { type: "processed", projectLabel } }));
        clearResult(row.messageId);
      } else {
        setResults((r) => ({ ...r, [row.messageId]: res }));
      }
    } catch (e) {
      setResults((r) => ({
        ...r,
        [row.messageId]: { ok: false, error: e instanceof Error ? e.message : "Network error" },
      }));
    } finally {
      setBusyId("");
    }
  }

  // Not actually an invoice → tag "Not an Invoice" and drop it from the list.
  async function markNotRelevant(row: EmailRow) {
    if (busyId) return;
    setBusyId(row.messageId);
    setResults((r) => ({ ...r, [row.messageId]: { ok: true, message: "Removing…" } }));
    try {
      const res = await callEmail<LogResult>({
        action: "markNotRelevant",
        messageId: row.messageId,
      });
      if (res.ok) {
        setHandled((h) => ({ ...h, [row.messageId]: { type: "notRelevant" } }));
        clearResult(row.messageId);
      } else {
        setResults((r) => ({ ...r, [row.messageId]: res }));
      }
    } catch (e) {
      setResults((r) => ({
        ...r,
        [row.messageId]: { ok: false, error: e instanceof Error ? e.message : "Network error" },
      }));
    } finally {
      setBusyId("");
    }
  }

  // Reverse a mark on the server (removes the Gmail labels) so the row returns
  // to the queue. Best-effort: on failure the row stays handled — the labels
  // are still applied server-side, so the two views stay consistent.
  async function undoHandled(row: EmailRow) {
    const info = handled[row.messageId];
    if (!info || busyId) return;
    setBusyId(row.messageId);
    try {
      const { ids } = processedTargets(row);
      const res = await callEmail<LogResult>({
        action: info.type === "processed" ? "markProcessed" : "markNotRelevant",
        messageId: row.messageId,
        projectId: ids[0] || "",
        projectIds: ids,
        wasTagged: !!row.tagged,
        undo: true,
      });
      if (res.ok) {
        setHandled((h) => {
          const next = { ...h };
          delete next[row.messageId];
          return next;
        });
        clearResult(row.messageId);
      }
    } catch {
      /* leave it handled — server labels unchanged, so state stays consistent */
    } finally {
      setBusyId("");
    }
  }

  // A row is "done" once it has logged (or was already in the system).
  const isDone = (id: string) => {
    const k = results[id]?.kind;
    return k === "logged" || k === "already_logged" || k === "already_processed";
  };

  // Handled rows drop out of the active list into the tray at the bottom.
  const visible = emails.filter((r) => !handled[r.messageId]);
  const handledList = emails.filter((r) => handled[r.messageId]);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Ascent Companion
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Email Inbox</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Unprocessed emails with attachments. Pick a project and log an invoice — same
            one-click import as the old Gmail card.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="mt-1 shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-40 dark:border-neutral-700"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {loadError && <p className="mb-3 text-sm text-red-600">{loadError}</p>}

      {!loading && !loadError && visible.length === 0 && (
        <p className="text-sm text-neutral-500">Nothing to log — the inbox is clear.</p>
      )}

      <ul className="space-y-3">
        {visible.map((row) => {
          const result = results[row.messageId];
          const done = isDone(row.messageId);
          const busy = busyId === row.messageId;
          const atts = row.attachments ?? [];
          const isMulti = atts.length > 1;
          const allAssigned = atts.every((a) => !!sel[attKey(row.messageId, a.index)]);
          return (
            <li
              key={row.messageId}
              className={
                "rounded-xl border p-4 transition " +
                (done
                  ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20"
                  : "border-neutral-200 dark:border-neutral-800")
              }
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold">
                  {row.tagged && (
                    <span className="mr-1.5 rounded bg-accent/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-accent">
                      Tagged
                    </span>
                  )}
                  {row.subject}
                </p>
                <span className="shrink-0 text-xs text-neutral-500">{fmtDate(row.date)}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-neutral-500">
                {fmtFrom(row.from)}
                {row.attachmentCount > 0 && (
                  <span className="ml-2">
                    📎 {row.attachmentCount} attachment{row.attachmentCount === 1 ? "" : "s"}
                  </span>
                )}
              </p>
              <a
                href={gmailUrl(row.threadId)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                Open in Gmail ↗
              </a>
              {!done && row.hasPdf === false && (
                <p className="mt-0.5 text-xs text-amber-600">
                  No PDF — the email body will be saved as the PDF.
                </p>
              )}

              {done ? (
                <p className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  ✓ {result?.message}
                </p>
              ) : isMulti ? (
                <>
                  <p className="mt-3 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    {atts.length} invoices in this email — assign a job to each.
                  </p>
                  <div className="mt-2 space-y-2">
                    {atts.map((a) => {
                      const k = attKey(row.messageId, a.index);
                      const attRes = result?.results?.find((rr) => rr.index === a.index);
                      return (
                        <div
                          key={k}
                          className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800"
                        >
                          <p className="mb-1.5 truncate text-xs font-medium text-neutral-600 dark:text-neutral-300">
                            📄 {a.name}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={sel[k] ?? ""}
                              disabled={busy}
                              onChange={(e) => setSel((s) => ({ ...s, [k]: e.target.value }))}
                              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                            >
                              <option value="">— select a project —</option>
                              {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                            <label className="flex shrink-0 items-center gap-1.5 text-sm">
                              <input
                                type="checkbox"
                                checked={!!paid[k]}
                                disabled={busy}
                                onChange={(e) => setPaid((p) => ({ ...p, [k]: e.target.checked }))}
                                className="h-4 w-4 rounded border-neutral-300"
                              />
                              PAID
                            </label>
                          </div>
                          {attRes && (
                            <p
                              className={
                                "mt-1.5 text-xs " +
                                (attRes.ok
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-red-600")
                              }
                            >
                              {attRes.ok ? "✓ " : ""}
                              {attRes.message || attRes.error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <button
                      onClick={() => void logAll(row)}
                      disabled={!allAssigned || busy}
                      className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {busy ? "Logging…" : `Log all ${atts.length} invoices`}
                    </button>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-500">
                      <label
                        className="flex items-center gap-1.5"
                        title="All these invoices were entered into JobTread by hand — tag the thread processed with the assigned jobs and drop it from the list."
                      >
                        <input
                          type="checkbox"
                          checked={false}
                          disabled={busy || !atts.some((a) => sel[attKey(row.messageId, a.index)])}
                          onChange={() => markProcessed(row)}
                          className="h-4 w-4 rounded border-neutral-300 disabled:opacity-40"
                        />
                        Processed
                        {atts.some((a) => sel[attKey(row.messageId, a.index)])
                          ? ""
                          : " (assign a job first)"}
                      </label>
                      <label
                        className="flex items-center gap-1.5"
                        title="Not an invoice — drop it from the list."
                      >
                        <input
                          type="checkbox"
                          checked={false}
                          disabled={busy}
                          onChange={() => markNotRelevant(row)}
                          className="h-4 w-4 rounded border-neutral-300"
                        />
                        Not relevant
                      </label>
                    </div>
                  </div>

                  {result && !result.ok && (
                    <p className="mt-2 text-sm text-red-600">{result.error || result.message}</p>
                  )}
                  {result && result.ok && !done && result.message && (
                    <p className="mt-2 text-sm text-amber-600">{result.message}</p>
                  )}
                </>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      value={sel[row.messageId] ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        setSel((s) => ({ ...s, [row.messageId]: e.target.value }))
                      }
                      className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <option value="">— select a project —</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>

                    <label className="flex shrink-0 items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={!!paid[row.messageId]}
                        disabled={busy}
                        onChange={(e) =>
                          setPaid((p) => ({ ...p, [row.messageId]: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-neutral-300"
                      />
                      PAID
                    </label>

                    <button
                      onClick={() => void logOne(row)}
                      disabled={!sel[row.messageId] || busy}
                      className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {busy ? "Logging…" : "Log Invoice"}
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-neutral-500">
                    <label
                      className="flex items-center gap-1.5"
                      title="Already entered into JobTread by hand — tag it processed with the selected job and drop it from the list."
                    >
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={busy || !sel[row.messageId]}
                        onChange={() => markProcessed(row)}
                        className="h-4 w-4 rounded border-neutral-300 disabled:opacity-40"
                      />
                      Processed{sel[row.messageId] ? "" : " (pick a job first)"}
                    </label>
                    <label
                      className="flex items-center gap-1.5"
                      title="Not an invoice — drop it from the list."
                    >
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={busy}
                        onChange={() => markNotRelevant(row)}
                        className="h-4 w-4 rounded border-neutral-300"
                      />
                      Not relevant
                    </label>
                  </div>

                  {result && !result.ok && (
                    <p className="mt-2 text-sm text-red-600">{result.error || result.message}</p>
                  )}
                  {result && result.ok && !done && result.message && (
                    <p className="mt-2 text-sm text-amber-600">{result.message}</p>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {handledList.length > 0 && (
        <section className="mt-6 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Handled ({handledList.length})
          </p>
          <ul className="space-y-1">
            {handledList.map((row) => {
              const info = handled[row.messageId];
              return (
                <li
                  key={row.messageId}
                  className="flex items-center justify-between gap-3 text-xs text-neutral-500"
                >
                  <span className="min-w-0 truncate">
                    {info.type === "processed" ? (
                      <span className="text-emerald-700 dark:text-emerald-400">✓ Processed</span>
                    ) : (
                      <span>✕ Not relevant</span>
                    )}
                    {info.projectLabel ? ` · ${info.projectLabel}` : ""} — {row.subject}
                  </span>
                  <button
                    onClick={() => void undoHandled(row)}
                    disabled={busyId === row.messageId}
                    className="shrink-0 font-semibold text-accent disabled:opacity-40"
                  >
                    Undo
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
