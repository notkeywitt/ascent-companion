"use client";

import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Card, EmptyState, Loading, PageHeader, SectionLabel } from "@/components/ui";

interface WorkedRow {
  entryId: string;
  date: string;
  employee: string;
  jobLabel: string;
  costCode: string;
  start: string;
  end: string;
  jtStatus: string;
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
  worked: { rows: WorkedRow[]; total?: number; unsynced?: number; error?: string };
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
      if (posted) setMsg({ tone: "success", text: "Posted to JobTread." });
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

  const worked = data?.worked.rows ?? [];
  const leave = data?.leave.rows ?? [];
  const totalUnsynced = worked.length + leave.length;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <PageHeader
        title="Time Sync"
        description="Time records saved here but not yet in JobTread. Nothing is lost — retry any that stranded."
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
          {data?.leave.error && <Banner tone="error">Couldn&apos;t read leave records: {data.leave.error}</Banner>}

          {totalUnsynced === 0 && !data?.worked.error && !data?.leave.error ? (
            <EmptyState>
              All time records are in JobTread.
              {typeof data?.worked.total === "number" ? ` (${data.worked.total} worked entries checked.)` : ""}
            </EmptyState>
          ) : (
            <>
              <Card className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-2xl font-bold tabular-nums">{totalUnsynced}</div>
                  <div className="text-xs text-neutral-500">
                    not yet in JobTread — {worked.length} worked · {leave.length} leave
                  </div>
                </div>
                <Button disabled={busyAll || totalUnsynced === 0} onClick={retryAll}>
                  {busyAll ? "Retrying…" : "Retry all"}
                </Button>
              </Card>

              {worked.length > 0 && (
                <Card>
                  <SectionLabel>Worked time ({worked.length})</SectionLabel>
                  <ul className="mt-2 space-y-2">
                    {worked.map((r) => (
                      <li
                        key={r.entryId}
                        className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700/60"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">
                            {r.employee || "—"} <span className="font-normal text-neutral-500">· {r.date}</span>
                          </div>
                          <div className="truncate text-xs text-neutral-500">
                            {r.jobLabel}
                            {r.costCode ? ` · ${r.costCode}` : ""} · {r.start}–{r.end}
                          </div>
                          {r.jtStatus && <div className="truncate text-xs text-amber-600 dark:text-amber-400">{r.jtStatus}</div>}
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyId === `worked:${r.entryId}` || busyAll}
                          onClick={() => retry("worked", r.entryId)}
                        >
                          {busyId === `worked:${r.entryId}` ? "…" : "Retry"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {leave.length > 0 && (
                <Card>
                  <SectionLabel>Leave ({leave.length})</SectionLabel>
                  <ul className="mt-2 space-y-2">
                    {leave.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700/60"
                      >
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
            </>
          )}
        </div>
      )}
    </main>
  );
}
