"use client";

/**
 * "Link" on a Sunset statement line: pick the JobTread bill the line pays, on
 * any job. The list is every Sunset bill of the statement's billing month (from
 * the reconcile's `months` block), unclaimed bills first, then the closest
 * amount. A bill another line already claims can still be picked — a link
 * outranks every automatic match. A bill from another month is linked by typing
 * its invoice number.
 *
 * Saves to /api/sunset-statement-links (companion DB). Nothing is written to
 * JobTread; the next reconcile applies the link.
 */

import { useMemo, useState } from "react";
import { Banner, Button, Dialog, Input } from "@/components/ui";
import { money } from "@/lib/money";
import { rankCandidates, type SunsetCandidate } from "@/lib/sunsetLinks";

export interface LinkTarget {
  statementExpId: string;
  statementName: string;
  line: { number: string; amount: number; date?: string };
  /** The bill this line is matched to now, if any. */
  currentDocId?: string;
  /** True when an office link (not the automatic match) made the current match. */
  linked?: boolean;
}

export function SunsetLinkPicker({
  target,
  candidates,
  statementName,
  onClose,
  onSaved,
}: {
  target: LinkTarget;
  candidates: SunsetCandidate[];
  /** Name of a statement by ExpID, for "claimed by" notes. */
  statementName: (expId: string) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ranked = useMemo(() => rankCandidates(candidates, target.line, q), [candidates, target.line, q]);

  async function send(method: "POST" | "DELETE", extra: Record<string, string> = {}) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sunset-statement-links", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statementExpId: target.statementExpId,
          lineNumber: target.line.number,
          ...extra,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Could not save the link.");
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onClose={onClose}
      busy={busy}
      size="lg"
      pad={false}
      title={`Link #${target.line.number || "—"} · ${money(target.line.amount)}`}
      description={`${target.statementName}. Pick the bill this statement line pays — on any job.`}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {target.linked && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => send("DELETE")}>
              Remove link
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-2 px-4 pt-3 sm:px-5">
        {error && <Banner tone="error">{error}</Banner>}
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by invoice #, job or amount"
          aria-label="Filter bills"
        />
      </div>
      <ul className="mt-2 max-h-[50dvh] divide-y divide-line-soft overflow-y-auto border-y border-line-soft">
        {ranked.length === 0 && (
          <li className="px-4 py-3 text-sm text-neutral-500 sm:px-5">No Sunset bill this month fits.</li>
        )}
        {ranked.map((c) => {
          const current = !!target.currentDocId && c.docId === target.currentDocId;
          const same = Math.abs(c.amount - target.line.amount) <= 0.01;
          return (
            <li key={c.uid}>
              <button
                type="button"
                disabled={busy || current}
                onClick={() => send("POST", { docId: c.docId, invoiceNumber: c.number })}
                className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:hover:bg-white/5 sm:px-5"
              >
                <span className="min-w-0">
                  <span className="font-medium">#{c.number || "—"}</span>
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {" · "}
                    {c.jobName || "no job"}
                    {c.date ? ` · ${c.date}` : ""}
                  </span>
                  {(current || c.claimedBy) && (
                    <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                      {current
                        ? "Matched to this line now"
                        : `Matched to ${statementName(c.claimedBy!.statementId)} line #${c.claimedBy!.line}`}
                    </span>
                  )}
                </span>
                <span className={"shrink-0 tabular-nums " + (same ? "font-semibold text-ok" : "")}>
                  {money(c.amount)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Or a bill from another month: invoice #"
          aria-label="Invoice number"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !typed.trim()}
          onClick={() => send("POST", { invoiceNumber: typed.trim() })}
        >
          Link
        </Button>
      </div>
    </Dialog>
  );
}
