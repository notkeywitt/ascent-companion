"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/Toast";
import {
  Banner,
  Button,
  Card,
  Chip,
  Input,
  Label,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  Segmented,
  Textarea,
  Toggle,
  btn,
} from "@/components/ui";
import { AGENT_SCRIPTS, MODELS, STALL_MINUTES, scriptById, type AgentModel, type AgentScript } from "@/lib/agentScripts";
import { AdminTabs } from "@/app/admin/AdminTabs";

/**
 * AI SCRIPTS (/ai-scripts, admin) — the Claude Code scripts the Macs run.
 *
 * Live progress comes from Claude Code's own event output, relayed by
 * scripts/agent-progress/agent-run.mjs: watching costs no tokens. Every
 * setting here is a plain save; the Mac reads it before its next run.
 * Add a script in src/lib/agentScripts.ts and it appears here.
 */

interface Settings {
  model: AgentModel;
  paused: boolean;
  extraPrompt: string;
  maxTurns: number;
  runRequestedAt: string;
  runRequestedBy: string;
  runArg: string;
  updatedBy: string;
  updatedAt: string;
}
interface RunView {
  id: string;
  scriptId: string;
  machine: string;
  model: string;
  title: string;
  ref: string;
  status: "running" | "done" | "error" | "stopped";
  startedAt: string;
  endedAt: string;
  lastEventAt: string;
  lastStep: string;
  steps: number;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  result: string;
  stopRequested: boolean;
}
interface EventView {
  id: number;
  at: string;
  kind: string;
  text: string;
}
interface Dashboard {
  scripts: { id: string; settings: Settings; lastRun: RunView | null; installedOn: { machine: string; lastCheckAt: string }[] }[];
  running: (RunView & { events: EventView[] })[];
  recent: RunView[];
  machines: {
    name: string;
    lastSeenAt: string;
    scripts: Record<string, string>;
    busy: string;
    codeVersion: string;
    codeNote: string;
    codeCheckedAt: string;
  }[];
  deployedVersion: string;
}

const mins = (iso: string) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity);
function ago(iso: string): string {
  const m = mins(iso);
  if (!Number.isFinite(m)) return "never";
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function duration(a: string, b: string): string {
  if (!a) return "";
  const s = Math.max(0, ((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
const cost = (n: number | null) => (n == null ? "" : `$${n.toFixed(2)}`);
const modelLabel = (m: string) => MODELS.find((x) => x.id === m)?.label ?? m;

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/ai-scripts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function StatusChip({ run }: { run: RunView }) {
  if (run.status === "running") {
    if (run.stopRequested) return <Chip tone="warning">stopping</Chip>;
    return mins(run.lastEventAt) > STALL_MINUTES ? <Chip tone="warning">stalled</Chip> : <Chip tone="info">running</Chip>;
  }
  if (run.status === "error") return <Chip tone="danger">failed</Chip>;
  if (run.status === "stopped") return <Chip tone="warning">stopped</Chip>;
  return null;
}

export function AiScripts() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-scripts");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load the scripts.");
      setData(d);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Every 5 seconds while something runs or waits for a Mac; every 30 otherwise.
  const busy = !!data && (data.running.length > 0 || data.scripts.some((s) => s.settings.runRequestedAt));
  useEffect(() => {
    const t = setInterval(load, busy ? 5000 : 30000);
    return () => clearInterval(t);
  }, [busy, load]);

  if (!data) return err ? <main className="mx-auto max-w-2xl px-4 pt-3"><Banner tone="error">{err}</Banner></main> : <Loading />;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-3 pad:px-7 lg:max-w-4xl">
      <AdminTabs />
      <PageHeader
        title="AI Scripts"
        description="The Claude Code scripts the Macs run. A change here applies to the next run. Watching a run costs no tokens."
      />
      {err && <Banner tone="error">{err}</Banner>}

      <div className="space-y-6">
        {/* ---------------------------------------------------- running now */}
        <section className="space-y-2">
          <SectionHeading>Running now</SectionHeading>
          {data.running.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing is running.</p>
          ) : (
            data.running.map((r) => <LiveRun key={r.id} run={r} onChanged={load} />)
          )}
        </section>

        {/* -------------------------------------------------------- scripts */}
        <section className="space-y-2">
          <SectionHeading>Scripts</SectionHeading>
          <ul className="space-y-2">
            {AGENT_SCRIPTS.map((s) => {
              const st = data.scripts.find((x) => x.id === s.id);
              if (!st) return null;
              return (
                <li key={s.id}>
                  <ScriptCard
                    script={s}
                    state={st}
                    recent={data.recent.filter((r) => r.scriptId === s.id).slice(0, 5)}
                    open={openId === s.id}
                    onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                    onChanged={load}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        {/* ------------------------------------------------------ computers */}
        <section className="space-y-2">
          <SectionHeading>Computers</SectionHeading>
          {data.machines.length === 0 ? (
            <p className="text-sm text-neutral-500">No Mac has checked in yet. Run a script&apos;s install.sh on the Mac.</p>
          ) : (
            <Card pad={false} className="divide-y divide-line-soft">
              {data.machines.map((m) => {
                const online = mins(m.lastSeenAt) < 15 || !!m.busy;
                return (
                  <div key={m.name} className="px-3 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className={`h-2 w-2 rounded-full ${online ? "bg-ok" : "bg-neutral-400"}`} />
                      <span className="font-semibold">{m.name}</span>
                    </div>
                    <MetaLine
                      items={[
                        m.busy ? `Running: ${m.busy}` : online ? "Idle" : "Not checking in",
                        `last check ${ago(m.lastSeenAt)}`,
                        Object.keys(m.scripts)
                          .map((id) => scriptById(id)?.name ?? id)
                          .join(", "),
                      ]}
                    />
                    <CodeLine m={m} deployed={data.deployedVersion} />
                  </div>
                );
              })}
            </Card>
          )}
        </section>

        {/* ---------------------------------------------------- recent runs */}
        <section className="space-y-2">
          <SectionHeading>Recent runs</SectionHeading>
          {data.recent.length === 0 ? (
            <p className="text-sm text-neutral-500">No runs yet.</p>
          ) : (
            <Card pad={false} className="divide-y divide-line-soft">
              {data.recent.map((r) => (
                <PastRun key={r.id} run={r} />
              ))}
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}

/** Which code the Mac's scripts run, from its updater (scripts/mac-update/). */
function CodeLine({ m, deployed }: { m: Dashboard["machines"][number]; deployed: string }) {
  if (!m.codeVersion) {
    return <p className="mt-0.5 text-xs text-warn">The updater is not installed. Run scripts/mac-update/install.sh on this Mac.</p>;
  }
  const same = !!deployed && deployed.startsWith(m.codeVersion);
  const stale = mins(m.codeCheckedAt) > 30;
  return (
    <MetaLine
      className="mt-0.5"
      items={[
        <span key="v" className={same ? "" : "text-warn"}>
          Code {m.codeVersion.slice(0, 7)}
          {deployed ? (same ? " (matches the live app)" : ` (live app is ${deployed.slice(0, 7)})`) : ""}
        </span>,
        m.codeNote,
        <span key="c" className={stale ? "text-warn" : ""}>updater ran {ago(m.codeCheckedAt)}</span>,
      ]}
    />
  );
}

/* ------------------------------------------------------------- a live run */

function LiveRun({ run, onChanged }: { run: RunView & { events: EventView[] }; onChanged: () => void }) {
  const [all, setAll] = useState<EventView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const script = scriptById(run.scriptId);
  const events = all ?? run.events;
  const shown = all ? events : events.slice(-12);

  async function stop() {
    if (!confirm(`Stop "${run.title}" on ${run.machine}? Claude Code ends at its next report (within a few seconds).`)) return;
    setBusy(true);
    try {
      await post({ action: "stop", runId: run.id });
      toast("Stop sent");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function showAll() {
    const res = await fetch(`/api/ai-scripts?run=${encodeURIComponent(run.id)}`);
    const d = await res.json();
    if (res.ok) setAll(d.run.events);
  }

  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{run.title}</span>
            <StatusChip run={run} />
          </div>
          <MetaLine items={[script?.name, run.machine, modelLabel(run.model), `${duration(run.startedAt, "")} so far`, `${run.steps} steps`]} />
        </div>
        <Button size="sm" variant="danger" disabled={busy || run.stopRequested} onClick={stop}>
          {run.stopRequested ? "Stopping…" : "Stop"}
        </Button>
      </div>
      <p className="text-sm">
        <span className="text-neutral-500">Now: </span>
        <span className="font-medium">{run.lastStep || "Starting"}</span>
        <span className="text-xs text-neutral-500"> · {ago(run.lastEventAt)}</span>
      </p>
      {mins(run.lastEventAt) > STALL_MINUTES && (
        <Banner tone="warning">No new step for {Math.round(mins(run.lastEventAt))} minutes. The Mac may be asleep, or Claude is on a long step.</Banner>
      )}
      <ol className="max-h-72 space-y-0.5 overflow-y-auto rounded-control bg-neutral-50 p-2 font-mono text-[11px] leading-relaxed dark:bg-white/5">
        {shown.map((e) => (
          <li key={e.id} className={e.kind === "error" ? "text-danger" : e.kind === "note" ? "text-neutral-500" : ""}>
            <span className="text-neutral-400">{clock(e.at)}</span> {e.text}
          </li>
        ))}
      </ol>
      {!all && run.steps > 12 && (
        <Button size="xs" variant="ghost" onClick={showAll}>
          Show every step
        </Button>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- a past run */

function PastRun({ run }: { run: RunView }) {
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [open, setOpen] = useState(false);
  const script = scriptById(run.scriptId);

  async function toggle() {
    setOpen(!open);
    if (!events) {
      const res = await fetch(`/api/ai-scripts?run=${encodeURIComponent(run.id)}`);
      const d = await res.json();
      if (res.ok) setEvents(d.run.events);
    }
  }

  return (
    <div className="text-sm">
      <button type="button" onClick={toggle} aria-expanded={open} className="w-full px-3 py-2.5 text-left">
        <div className="flex items-center gap-2">
          <span className="font-medium">{run.title}</span>
          <StatusChip run={run} />
        </div>
        <MetaLine
          items={[ago(run.startedAt), script?.name !== run.title && script?.name, run.machine, modelLabel(run.model), duration(run.startedAt, run.endedAt), `${run.steps} steps`, cost(run.costUsd)]}
        />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {run.result && <p className="whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">{run.result}</p>}
          <ol className="max-h-80 space-y-0.5 overflow-y-auto rounded-control bg-neutral-50 p-2 font-mono text-[11px] leading-relaxed dark:bg-white/5">
            {(events ?? []).map((e) => (
              <li key={e.id} className={e.kind === "error" ? "text-danger" : e.kind === "note" ? "text-neutral-500" : ""}>
                <span className="text-neutral-400">{clock(e.at)}</span> {e.text}
              </li>
            ))}
            {events && events.length === 0 && <li className="text-neutral-500">No steps kept (steps are kept 30 days).</li>}
            {!events && <li className="text-neutral-500">Loading…</li>}
          </ol>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- a script's card */

function ScriptCard({
  script,
  state,
  recent,
  open,
  onToggle,
  onChanged,
}: {
  script: AgentScript;
  state: Dashboard["scripts"][number];
  recent: RunView[];
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const s = state.settings;
  const hand = script.trigger === "hand";
  const last = state.lastRun;
  return (
    <Card pad={false} className={open ? "ring-2 ring-inset ring-accent/50" : ""}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="w-full px-3 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{script.name}</span>
          {s.paused && !hand && <Chip tone="warning">paused</Chip>}
          {last && <StatusChip run={last} />}
        </div>
        <div className="text-xs text-neutral-500">{script.summary}</div>
        <MetaLine
          className="mt-0.5"
          items={[
            hand ? "Runs by hand" : modelLabel(s.model),
            last ? `last run ${ago(last.startedAt)}` : "no runs yet",
            !hand && (state.installedOn.length ? state.installedOn.map((i) => i.machine).join(", ") : "not installed on a Mac yet"),
            s.runRequestedAt && "Run now waiting for a Mac",
          ]}
        />
      </button>
      {open && <ScriptDetail script={script} state={state} recent={recent} onChanged={onChanged} />}
    </Card>
  );
}

function ScriptDetail({
  script,
  state,
  recent,
  onChanged,
}: {
  script: AgentScript;
  state: Dashboard["scripts"][number];
  recent: RunView[];
  onChanged: () => void;
}) {
  const s = state.settings;
  const hand = script.trigger === "hand";
  const [model, setModel] = useState<AgentModel>(s.model);
  const [extra, setExtra] = useState(s.extraPrompt);
  const [maxTurns, setMaxTurns] = useState(String(s.maxTurns || ""));
  const [arg, setArg] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = model !== s.model || extra !== s.extraPrompt || (Number(maxTurns) || 0) !== s.maxTurns;

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await post({ scriptId: script.id, ...body });
      toast(done);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-line px-3 pb-4 pt-3 text-sm">
      <section className="space-y-1">
        <SectionHeading>What it does</SectionHeading>
        <ol className="list-decimal space-y-0.5 pl-5 text-neutral-700 dark:text-neutral-300">
          {script.process.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        <MetaLine
          items={[
            script.schedule,
            <span key="f" className="font-mono">{script.folder}</span>,
            <Link key="r" href={script.resultHref} className="text-accent hover:underline">
              Results: {script.resultLabel}
            </Link>,
          ]}
        />
      </section>

      <section className="space-y-2">
        <SectionHeading>Start</SectionHeading>
        {hand ? (
          <p className="text-neutral-600 dark:text-neutral-400">
            Type <span className="font-mono">{script.skill}</span> in a Claude Code session. It ships code, so a person starts it and watches it. The settings below do not apply to it.
          </p>
        ) : (
          <div className="space-y-2">
            {script.trigger === "page" && script.startHref && (
              <p className="text-neutral-600 dark:text-neutral-400">
                It starts from{" "}
                <Link href={script.startHref} className="text-accent hover:underline">
                  {script.startLabel}
                </Link>
                . Run now only makes the Mac look for waiting work at once.
              </p>
            )}
            {script.runArg && (
              <div>
                <Label htmlFor={`arg-${script.id}`}>{script.runArg.label}</Label>
                <Input id={`arg-${script.id}`} value={arg} onChange={(e) => setArg(e.target.value)} placeholder={script.runArg.placeholder} />
                <p className="mt-1 text-xs text-neutral-500">{script.runArg.hint}</p>
              </div>
            )}
            {s.runRequestedAt ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-neutral-600 dark:text-neutral-400">
                  Waiting for a Mac{script.checkEveryMinutes ? ` (checks every ${script.checkEveryMinutes} min)` : ""}
                  {s.runArg ? ` — ${s.runArg}` : ""}. Asked by {s.runRequestedBy || "someone"} {ago(s.runRequestedAt)}.
                </span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ action: "cancel-run" }, "Run now withdrawn")}>
                  Withdraw
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy || s.paused || state.installedOn.length === 0} onClick={() => act({ action: "run", arg }, "A Mac starts it on its next check")}>
                  Run now
                </Button>
                <span className="text-xs text-neutral-500">
                  {s.paused
                    ? "Unpause it first."
                    : state.installedOn.length === 0
                      ? "No Mac has this installed yet."
                      : `Starts within ${script.checkEveryMinutes ?? "a few"} minutes.`}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {!hand && (
        <section className="space-y-3">
          <SectionHeading>Settings</SectionHeading>
          <Toggle
            checked={s.paused}
            disabled={busy}
            onChange={(paused) => act({ action: "settings", paused }, paused ? "Paused" : "Running again")}
            label={s.paused ? "Paused: the Macs skip it, including its own schedule" : "Active: runs on its schedule"}
          />
          <div>
            <Label>Model</Label>
            <Segmented label="Model" value={model} onChange={setModel} options={MODELS.map((m) => ({ value: m.id, label: m.label }))} />
            <p className="mt-1 text-xs text-neutral-500">
              {MODELS.find((m) => m.id === model)?.note}. Default: {modelLabel(script.defaultModel)}.
            </p>
          </div>
          <div>
            <Label htmlFor={`extra-${script.id}`}>Extra instructions</Label>
            <Textarea
              id={`extra-${script.id}`}
              rows={4}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={`Added to ${script.skill} on every run. E.g. "Skip the listing sites." Blank: the skill as written.`}
            />
          </div>
          <div>
            <Label htmlFor={`turns-${script.id}`}>Max turns</Label>
            <div className="w-32">
              <Input
                id={`turns-${script.id}`}
                inputMode="numeric"
                value={maxTurns}
                onChange={(e) => setMaxTurns(e.target.value.replace(/\D/g, ""))}
                placeholder="No limit"
              />
            </div>
            <p className="mt-1 text-xs text-neutral-500">Ends a run after this many steps, to cap its cost. Blank: no limit.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy || !dirty} onClick={() => act({ action: "settings", model, extraPrompt: extra, maxTurns: Number(maxTurns) || 0 }, "Saved")}>
              Save settings
            </Button>
            {s.updatedAt && <span className="text-xs text-neutral-500">Last changed by {s.updatedBy || "someone"} {ago(s.updatedAt)}</span>}
          </div>
        </section>
      )}

      {!hand && (
        <section className="space-y-1">
          <SectionHeading>Recent runs</SectionHeading>
          {recent.length === 0 ? (
            <p className="text-neutral-500">None yet.</p>
          ) : (
            <ul className="space-y-1">
              {recent.map((r) => (
                <li key={r.id}>
                  <MetaLine items={[<StatusChip key="c" run={r} />, r.title, ago(r.startedAt), r.machine, modelLabel(r.model), duration(r.startedAt, r.endedAt), cost(r.costUsd)]} />
                </li>
              ))}
            </ul>
          )}
          <Link href={script.resultHref} className={btn("ghost", "xs")}>
            Open {script.resultLabel} ›
          </Link>
        </section>
      )}
    </div>
  );
}
