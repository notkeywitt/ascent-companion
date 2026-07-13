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
  tagged?: boolean; // manually flagged "_Invoice to Log"
  labels: string[];
}

interface ProjectItem {
  label: string;
  id: string;
}

interface LogResult {
  ok: boolean;
  kind?: string;
  message?: string;
  error?: string;
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

  // A row is "done" once it has logged (or was already in the system).
  const isDone = (id: string) => {
    const k = results[id]?.kind;
    return k === "logged" || k === "already_logged" || k === "already_processed";
  };

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

      {!loading && !loadError && emails.length === 0 && (
        <p className="text-sm text-neutral-500">Nothing to log — the inbox is clear.</p>
      )}

      <ul className="space-y-3">
        {emails.map((row) => {
          const result = results[row.messageId];
          const done = isDone(row.messageId);
          const busy = busyId === row.messageId;
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
              {!done && row.hasPdf === false && (
                <p className="mt-0.5 text-xs text-amber-600">
                  No PDF — the email body will be saved as the PDF.
                </p>
              )}

              {done ? (
                <p className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  ✓ {result?.message}
                </p>
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
    </main>
  );
}
