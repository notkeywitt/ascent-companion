"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, Button, Card, EmptyState, Loading, PageHeader, SectionLabel } from "@/components/ui";
import { jtTimeUrl } from "@/lib/jtLinks";
import {
  PROBLEM_FIX,
  PROBLEM_LABEL,
  PROBLEM_ORDER,
  clockOf,
  type TimeProblem,
} from "@/lib/timeProblems";

/**
 * Time Sync — every time record that did not reach JobTread correctly.
 *
 * It used to list one thing: records with no JobTread id. That is only half the
 * failure, and not the half employees report. A clock-out JobTread refuses
 * leaves the entry OPEN in JobTread — it has an id, so the old filter hid it,
 * and it counts the wrong hours (usually none) until someone closes it by hand.
 * The rows are therefore GROUPED BY WHAT IS WRONG, and only the group the app
 * can fix from here carries a Retry button. The rest link into JobTread, where
 * the fix actually is; re-posting them would duplicate the entry.
 */

interface WorkedRow {
  entryId: string;
  date: string;
  employee: string;
  jobLabel: string;
  costCode: string;
  start: string;
  end: string;
  jtStatus: string;
  jtUserId: string;
  jtEntryId: string;
  jtStart?: string;
  jtEnd?: string;
  problem: TimeProblem;
  detail: string;
  retryable: boolean;
}
interface LeaveRow {
  id: number;
  name?: string;
  leaveType: string;
  hours: string;
  startDate: string;
  endDate: string;
}
interface Payload {
  ok: boolean;
  writesEnabled: boolean;
  worked: {
    rows: WorkedRow[];
    total?: number;
    unsynced?: number;
    problems?: number;
    checked?: number;
    from?: string;
    to?: string;
    error?: string;
    jtError?: string;
  };
  leave: { rows: LeaveRow[]; error?: string };
}

const hrs = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : v;
};

export default function TimeSyncPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "info" | "warning"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string>("");
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/time-sync");
      const json = (await res.json()) as Payload;
      if (!res.ok || json.ok === false) setErr("Could not load the sync status.");
      else setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function retry(kind: "worked" | "leave", id: string | number) {
    setBusyId(`${kind}:${id}`);
    setMsg(null);
    try {
      const res = await fetch("/api/time-sync/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });
      const j = await res.json();
      const posted = j.jtStatus === "pushed" || j.jtPosted;
      // A posted record can still carry a note — the retry moves a record
      // JobTread would not take onto the same code's Labor line, and the office
      // must be told its hours landed somewhere other than the row said.
      if (posted) setMsg({ tone: j.error ? "info" : "success", text: j.error || "Posted to JobTread." });
      else if (j.jtStatus === "adopted (already in JobTread)")
        // Adoption resolved the record either way. It still needs a person when
        // the entry it found is the open one, and then the route says so.
        setMsg({
          tone: j.error ? "warning" : "info",
          text: j.error || "JobTread already had it — the record now names that entry.",
        });
      else setMsg({ tone: "warning", text: j.error || `Not posted: ${j.jtStatus || "unknown"}.` });
      await load();
    } catch (e) {
      setMsg({ tone: "warning", text: e instanceof Error ? e.message : "Retry failed." });
    } finally {
      setBusyId("");
    }
  }

  async function retryAll() {
    setBusyAll(true);
    setMsg(null);
    try {
      const res = await fetch("/api/time-sync/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const j = await res.json();
      const s = j.summary ?? { tried: 0, posted: 0, failed: 0 };
      setMsg({
        tone: s.posted > 0 && s.failed === 0 ? "success" : s.posted > 0 ? "info" : "warning",
        text: `Retried ${s.tried}: ${s.posted} posted, ${s.failed} still pending.`,
      });
      await load();
    } catch (e) {
      setMsg({ tone: "warning", text: e instanceof Error ? e.message : "Retry failed." });
    } finally {
      setBusyAll(false);
    }
  }

  const worked = useMemo(() => data?.worked.rows ?? [], [data]);
  const leave = data?.leave.rows ?? [];
  const retryableCount = worked.filter((r) => r.retryable).length + leave.length;
  const totalProblems = worked.length + leave.length;

  // One group per problem, in PROBLEM_ORDER. Empty groups never render, so the
  // page grows a heading only when that failure actually happened.
  const groups = useMemo(
    () =>
      PROBLEM_ORDER.map((problem) => ({
        problem,
        rows: worked.filter((r) => r.problem === problem),
      })).filter((g) => g.rows.length > 0),
    [worked],
  );

  const windowNote =
    data?.worked.from && data?.worked.to
      ? `${data.worked.checked ?? 0} recent entries cross-checked against JobTread (${data.worked.from} to ${data.worked.to}).`
      : "";

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <PageHeader
        title="Time Sync"
        description="Time records that did not reach JobTread correctly. Nothing is lost — the record is saved here either way."
      />

      {err && <Banner tone="error" className="mb-4">{err}</Banner>}
      {msg && <Banner tone={msg.tone} className="mb-4">{msg.text}</Banner>}

      {loading ? (
        <Loading label="Checking records…" />
      ) : (
        <div className="space-y-5">
          {data && !data.writesEnabled && (
            <Banner tone="warning">
              JobTread writes are currently OFF (COMPANION_WRITES_ENABLED). Records are safely saved, but
              retries won&apos;t post until writes are enabled.
            </Banner>
          )}

          {data?.worked.error && (
            <Banner tone="error">Couldn&apos;t read the Time Entries sheet: {data.worked.error}</Banner>
          )}
          {data?.worked.jtError && (
            <Banner tone="warning">
              Couldn&apos;t cross-check against JobTread: {data.worked.jtError} The sheet&apos;s own
              record is below, so nothing here is missing — but an entry JobTread changed or dropped
              would not show yet.
            </Banner>
          )}
          {data?.leave.error && <Banner tone="error">Couldn&apos;t read leave records: {data.leave.error}</Banner>}

          {totalProblems === 0 && !data?.worked.error ? (
            <EmptyState>
              Every time record is in JobTread with the hours it was logged with.
              {typeof data?.worked.total === "number" ? ` ${data.worked.total} records on file.` : ""}
            </EmptyState>
          ) : (
            <>
              <Card className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-2xl font-bold tabular-nums">{totalProblems}</div>
                  <div className="text-xs text-neutral-500">
                    need attention — {worked.length} worked · {leave.length} leave
                  </div>
                </div>
                <Button disabled={busyAll || retryableCount === 0} onClick={retryAll}>
                  {busyAll ? "Retrying…" : `Retry ${retryableCount}`}
                </Button>
              </Card>

              {groups.map(({ problem, rows }) => (
                <Card key={problem} pad={false}>
                  <div className="px-4 pt-4">
                    <SectionLabel>
                      {PROBLEM_LABEL[problem]} ({rows.length})
                    </SectionLabel>
                    <p className="mt-1 text-xs text-neutral-500">{PROBLEM_FIX[problem]}</p>
                  </div>
                  <ul className="mt-3 divide-y divide-line-soft">
                    {rows.map((r) => (
                      <li key={r.entryId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium">
                            {r.employee || "—"} <span className="font-normal text-neutral-500">· {r.date}</span>
                          </div>
                          <div className="truncate text-xs text-neutral-500">
                            {r.jobLabel}
                            {r.costCode ? ` · ${r.costCode}` : ""} · {clockOf(r.start)}–{clockOf(r.end)}
                          </div>
                          {r.detail && (
                            <div className="text-xs text-amber-600 dark:text-amber-400">{r.detail}</div>
                          )}
                        </div>
                        {r.retryable ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busyId === `worked:${r.entryId}` || busyAll}
                            onClick={() => retry("worked", r.entryId)}
                          >
                            {busyId === `worked:${r.entryId}` ? "…" : "Retry"}
                          </Button>
                        ) : (
                          <a
                            className="shrink-0 whitespace-nowrap text-xs font-medium text-accent underline-offset-2 hover:underline"
                            href={jtTimeUrl({
                              userId: r.jtUserId,
                              entryId: r.jtEntryId,
                              from: r.date,
                            })}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Fix in JobTread →
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}

              {leave.length > 0 && (
                <Card pad={false}>
                  <div className="px-4 pt-4">
                    <SectionLabel>Leave not in JobTread ({leave.length})</SectionLabel>
                  </div>
                  <ul className="mt-3 divide-y divide-line-soft">
                    {leave.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium">
                            {r.name || "—"}{" "}
                            <span className="font-normal uppercase text-neutral-500">{r.leaveType}</span>
                          </div>
                          <div className="truncate text-xs text-neutral-500">
                            {hrs(r.hours)} hr · {r.startDate}
                            {r.endDate && r.endDate !== r.startDate ? `–${r.endDate}` : ""}
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyId === `leave:${r.id}` || busyAll}
                          onClick={() => retry("leave", r.id)}
                        >
                          {busyId === `leave:${r.id}` ? "…" : "Retry"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {windowNote && <p className="px-1 text-xs text-neutral-500">{windowNote}</p>}
            </>
          )}
        </div>
      )}
    </main>
  );
}
