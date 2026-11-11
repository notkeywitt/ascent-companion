"use client";

import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Card, MetaLine, SectionHeading } from "@/components/ui";
import { subscribeQueue } from "./batchQueue";

/**
 * The Tools page's batch card: tools captured with Batch add that wait for
 * Claude Code on the office Mac, what it added lately, and what it could not
 * do. Office and admin also get "Analyze Tools Batch" and Retry / Discard.
 * Hidden when the batch is empty and nothing happened this week.
 */

interface Summary {
  canAnalyze: boolean;
  counts: Record<string, number>;
  problems: { id: string; toolId: string; error: string; updatedAt: string }[];
  recentlyAdded: { id: string; toolId: string; name: string; updatedAt: string }[];
  events: { kind: string; message: string; by: string; at: string }[];
  due: { due: boolean; reason: string; why: string };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const EVENT_WORDS: Record<string, string> = {
  request: "Analysis asked for",
  started: "Office Mac started",
  done: "Office Mac finished",
  error: "Office Mac run failed",
};

export function BatchCard({ reloadKey }: { reloadKey: number }) {
  const [s, setS] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tools/batch");
      const json = await res.json();
      if (res.ok && json.ok) setS(json as Summary);
    } catch {
      /* the card stays hidden; the page works without it */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Photos still on this phone: show them, and reload once they have all gone up.
  const [onPhone, setOnPhone] = useState(0);
  useEffect(() => {
    let prev = 0;
    return subscribeQueue((q) => {
      setOnPhone(q.pending);
      if (prev > 0 && q.pending === 0) void load();
      prev = q.pending;
    });
  }, [load]);

  if (!s) return null;
  const waiting = (s.counts.ready ?? 0) + (s.counts.capturing ?? 0);
  const analyzing = s.counts.analyzing ?? 0;
  const problems = s.problems.length;
  if (!waiting && !analyzing && !problems && !onPhone && !s.recentlyAdded.length) return null;

  async function post(url: string, body?: object) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "That did not work.");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (await post("/api/tools/batch/analyze")) {
      setNote("Asked. The office Mac starts within 10 minutes.");
      void load();
    }
  }

  async function act(action: "retry" | "discard", id: string) {
    if (action === "discard" && !window.confirm("Discard this tool and its photos?")) return;
    if (await post("/api/tools/batch", { action, id })) void load();
  }

  const last = s.events[0];
  return (
    <Card className="mb-4">
      <SectionHeading>Batch add</SectionHeading>
      <MetaLine
        items={[
          onPhone ? `${onPhone} still uploading from this phone` : "",
          `${waiting} waiting`,
          analyzing ? `${analyzing} analyzing` : "",
          problems ? `${problems} need a look` : "",
        ].filter(Boolean)}
      />
      {last && (
        <p className="mt-1 text-xs text-neutral-500">
          {EVENT_WORDS[last.kind] ?? last.kind} · {when(last.at)}
          {last.message && last.kind !== "request" ? ` · ${last.message}` : ""}
        </p>
      )}
      {!s.due.due && waiting > 0 && s.due.why && (
        <p className="mt-1 text-xs text-neutral-500">Timer: {s.due.why}.</p>
      )}

      {s.canAnalyze && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={analyze} disabled={busy || !waiting}>
            Analyze Tools Batch
          </Button>
          {note && <span className="text-xs text-ok">{note}</span>}
        </div>
      )}
      {err && (
        <Banner tone="error" className="mt-3">
          {err}
        </Banner>
      )}

      {problems > 0 && (
        <div className="mt-3 divide-y divide-line-soft">
          {s.problems.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{p.toolId}</div>
                <div className="text-xs text-danger">{p.error}</div>
              </div>
              {s.canAnalyze && (
                <div className="flex shrink-0 gap-1">
                  <Button size="xs" variant="secondary" disabled={busy} onClick={() => act("retry", p.id)}>
                    Retry
                  </Button>
                  <Button size="xs" variant="secondary" disabled={busy} onClick={() => act("discard", p.id)}>
                    Discard
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {s.recentlyAdded.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs text-neutral-500">
            Added from batches this week ({s.recentlyAdded.length})
          </summary>
          <div className="mt-1 divide-y divide-line-soft">
            {s.recentlyAdded.map((a) => (
              <div key={a.id} className="py-1.5">
                <span className="font-medium">{a.toolId}</span> · {a.name || "—"}
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
