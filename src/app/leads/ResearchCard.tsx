"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Banner, Button, MetaLine, SectionHeading, Textarea, btn } from "@/components/ui";

/**
 * The Research section of a lead (/leads). Asks a Mac to build the property
 * dossier (src/lib/leadResearch.ts), shows where the run is, and opens the
 * review page when it is ready.
 */

interface RunLite {
  id: string;
  status: "requested" | "running" | "ready" | "reviewed" | "error" | "cancelled";
  requestedAt: string;
  requestedBy: string;
  runner: string;
  startedAt: string;
  finishedAt: string;
  summary: string;
  error: string;
  reviewedAt: string;
  reviewedBy: string;
  live?: { lastStep: string; lastEventAt: string; steps: number };
}

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export function ResearchCard({ lead }: { lead: { id: string; name: string; address: string } }) {
  const [runs, setRuns] = useState<RunLite[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/research?leadId=${encodeURIComponent(lead.id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load research.");
      setRuns(data.runs ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRuns([]);
    }
  }, [lead.id]);

  useEffect(() => {
    load();
  }, [load]);

  const latest = runs?.[0] ?? null;
  const active = latest && (latest.status === "requested" || latest.status === "running");

  // While a run waits or runs, check again every 10 seconds.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [active, load]);

  async function request() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/leads/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, name: lead.name, address: lead.address, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start research.");
      setAsking(false);
      setNote("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/leads/research?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <SectionHeading>Property research</SectionHeading>
      {err && <Banner tone="error">{err}</Banner>}
      {runs === null ? (
        <p className="text-xs text-neutral-500">Loading…</p>
      ) : (
        <div className="space-y-2 text-xs">
          {latest?.status === "requested" && (
            <MetaLine items={["Waiting for a Mac to start it", `asked ${when(latest.requestedAt)}`]} />
          )}
          {latest?.status === "running" && (
            <div className="space-y-0.5">
              <MetaLine items={[`Researching on ${latest.runner || "a Mac"}`, `since ${when(latest.startedAt)}`, latest.live ? `${latest.live.steps} steps` : "takes 10–40 minutes"]} />
              {latest.live?.lastStep && <p className="truncate text-neutral-700 dark:text-neutral-300">Now: {latest.live.lastStep}</p>}
            </div>
          )}
          {latest?.status === "error" && <Banner tone="warning">Research stopped: {latest.error}</Banner>}
          {(latest?.status === "ready" || latest?.status === "reviewed") && (
            <div className="space-y-1.5">
              <MetaLine
                items={[
                  latest.status === "ready" ? <span className="font-semibold text-warn">Penciled in. Needs review</span> : `Reviewed by ${latest.reviewedBy || "the office"}`,
                  when(latest.status === "ready" ? latest.finishedAt : latest.reviewedAt),
                ]}
              />
              {latest.summary && <p className="line-clamp-4 text-neutral-700 dark:text-neutral-300">{latest.summary}</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {latest && (latest.status === "ready" || latest.status === "reviewed") && (
              <Link href={`/leads/research/${latest.id}`} className={btn("primary", "sm")}>
                {latest.status === "ready" ? "Review dossier" : "Open dossier"}
              </Link>
            )}
            {active ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => latest && cancel(latest.id)}>
                Cancel
              </Button>
            ) : (
              !asking && (
                <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
                  {latest ? "Research again" : "Research property"}
                </Button>
              )
            )}
          </div>

          {asking && (
            <div className="space-y-2 rounded-control bg-neutral-50 p-2.5 dark:bg-white/5">
              <p className="text-neutral-600 dark:text-neutral-400">
                Claude reads the county&apos;s property, permit and inspection records and other sources for{" "}
                {lead.address || "this lead's address"}, downloads the photos and documents, and pencils in the
                fields. Nothing reaches JobTread until you approve it.
              </p>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything to look into (optional) — e.g. the parcel number, a second lot, the septic"
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={request}>
                  {busy ? "Asking…" : "Start research"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
                  Not now
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
