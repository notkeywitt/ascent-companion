"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/components/BillingSummary";
import {
  Banner,
  Button,
  Card,
  ChipScroller,
  EmptyState,
  FilterChip,
  Input,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
} from "@/components/ui";

/**
 * THE FINANCIAL JOURNAL — every write this app has made to a money record.
 *
 * Read-only, by design: the page has no edit and no delete, because a journal
 * you can amend answers nothing. It exists so "who changed this bill's tax", or
 * "what was on the line somebody deleted", has an answer that does not depend on
 * anyone remembering.
 *
 * Filters are the three questions actually asked of it — about one bill, about
 * one job, or about one person — plus the outcome filter, because a rejected
 * write is a different kind of question from a successful one.
 */

interface JournalRow {
  id: number;
  at: string;
  actor: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  docId: string;
  jobId: string;
  field: string;
  before: string;
  after: string;
  beforeSource: string;
  amount: number | null;
  route: string;
  requestId: string;
  outcome: string;
  error: string;
  summary: string;
}

type OutcomeFilter = "all" | "ok" | "error";

const OUTCOMES: { id: OutcomeFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "ok", label: "Written" },
  { id: "error", label: "Rejected" },
];

const stamp = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

/** The person, short — an email's local part is what the office recognises. */
const who = (row: JournalRow) => {
  if (!row.actor) return "system";
  const at = row.actor.indexOf("@");
  return at > 0 ? row.actor.slice(0, at) : row.actor;
};

/**
 * A stored value, made readable.
 *
 * A whole-record before/after is stored as JSON, and JSON braces in a list row
 * are unreadable — so an object is flattened to `key: value` pairs and anything
 * empty is dropped.
 */
function readable(text: string): string {
  if (!text) return "";
  if (!text.startsWith("{")) return text;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const parts = Object.entries(o)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    return parts.join(" · ") || "(empty)";
  } catch {
    return text;
  }
}

export default function JournalPage() {
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [docId, setDocId] = useState("");
  const [jobId, setJobId] = useState("");
  const [actor, setActor] = useState("");
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (beforeId?: number) => {
      const params = new URLSearchParams();
      if (docId.trim()) params.set("docId", docId.trim());
      if (jobId.trim()) params.set("jobId", jobId.trim());
      if (actor.trim()) params.set("actor", actor.trim());
      if (beforeId) params.set("beforeId", String(beforeId));
      params.set("limit", "100");
      const r = await fetch(`/api/journal?${params}`);
      if (!r.ok) throw new Error(`The journal could not be read (${r.status}).`);
      return (await r.json()) as { rows: JournalRow[]; nextBeforeId: number | null };
    },
    [docId, jobId, actor],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    load()
      .then((d) => {
        if (!live) return;
        setRows(d.rows);
        setNextBeforeId(d.rows.length >= 100 ? d.nextBeforeId : null);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Unknown error"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [load]);

  const more = async () => {
    if (!nextBeforeId) return;
    setLoadingMore(true);
    try {
      const d = await load(nextBeforeId);
      setRows((prev) => [...prev, ...d.rows]);
      setNextBeforeId(d.rows.length >= 100 ? d.nextBeforeId : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingMore(false);
    }
  };

  // The outcome filter is applied in the browser: the three buckets are small
  // relative to a page, and re-fetching to hide a row is a round trip for
  // nothing.
  const shown = rows.filter((r) => outcome === "all" || r.outcome === outcome);
  const rejected = rows.filter((r) => r.outcome === "error").length;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <PageHeader
        title="Financial journal"
        description="Every change this app has made to a bill, a line, or a time entry — who, when, from what, to what. Read-only and never trimmed."
      />

      <Card className="mb-4 space-y-2">
        <Input
          placeholder="Bill / invoice id"
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
        />
        <div className="flex gap-2">
          <Input
            placeholder="Job id"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Input
            placeholder="Person (email)"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="min-w-0 flex-1"
          />
        </div>
      </Card>

      <ChipScroller className="mb-4">
        {OUTCOMES.map((o) => (
          <FilterChip key={o.id} on={outcome === o.id} onClick={() => setOutcome(o.id)}>
            {o.label}
            {o.id === "error" && rejected > 0 ? ` (${rejected})` : ""}
          </FilterChip>
        ))}
      </ChipScroller>

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading ? (
        <Loading label="Reading the journal…" />
      ) : shown.length === 0 ? (
        <EmptyState>
          Nothing recorded yet. The journal fills as bills, lines and time entries are edited — a
          filter that is too narrow also lands here.
        </EmptyState>
      ) : (
        <>
          <SectionHeading trailing={`${shown.length} change${shown.length === 1 ? "" : "s"}`}>
            Newest first
          </SectionHeading>
          <Card pad={false} className="mt-2 divide-y divide-line-soft">
            {shown.map((r) => (
              <div key={r.id} className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm font-semibold">{r.action}</p>
                  {r.amount != null && (
                    <p className="shrink-0 text-sm tabular-nums">{money(r.amount)}</p>
                  )}
                </div>

                {r.field ? (
                  <p className="mt-1 break-words text-[13px] leading-relaxed">
                    <span className="text-neutral-500 dark:text-neutral-400">{r.field}</span>{" "}
                    <span className="tabular-nums">
                      {r.beforeSource === "none" ? "?" : readable(r.before) || "(empty)"}
                    </span>{" "}
                    <span aria-hidden className="text-neutral-400">
                      →
                    </span>{" "}
                    <span className="font-medium tabular-nums">
                      {readable(r.after) || "(empty)"}
                    </span>
                  </p>
                ) : (
                  (r.before || r.after) && (
                    <p className="mt-1 break-words text-[13px] leading-relaxed">
                      {readable(r.before) || readable(r.after)}
                    </p>
                  )
                )}

                {r.outcome === "error" && (
                  <p className="mt-1 text-[12px] leading-relaxed text-red-700 dark:text-red-400">
                    Rejected — {r.error || "no reason recorded"}
                  </p>
                )}

                <MetaLine
                  className="mt-1"
                  items={[
                    stamp(r.at),
                    who(r),
                    r.actorRole,
                    // Provenance, stated rather than implied — see the journal's
                    // rule 4. Only worth showing when it weakens the row.
                    r.field && r.beforeSource !== "read"
                      ? r.beforeSource === "client"
                        ? "prior value reported by the browser"
                        : "prior value not captured"
                      : "",
                    r.entityId ? `${r.entity} ${r.entityId}` : r.entity,
                  ]}
                />
              </div>
            ))}
          </Card>

          {nextBeforeId && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={more} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load older"}
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
