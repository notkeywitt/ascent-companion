"use client";

import { useState } from "react";
import { Banner, Button, Checkbox, Dialog } from "@/components/ui";
import { matchesAllWords } from "@/lib/searchWords";
import { parseTarget, typeKey, type RuleMatch, type Target } from "@/lib/toolSchedule";

/**
 * The pieces the tool schedule's editor and its booking form share: naming a
 * target (a Tools-list tool, or any tool of a type), the searchable picker
 * that adds one, and the requisition prompt for a type none of is free.
 */

export interface PickTool {
  id: string;
  name: string;
  type: string;
  kindId: string;
  condition: string;
  usable: boolean;
  at: string;
  group?: string;
  groupId?: string;
  isTrailer?: boolean;
  trailerId?: string;
}
/** A ToolGroup: tools that go out together. */
export interface PickGroup {
  id: string;
  name: string;
  toolIds: string[];
}
export interface PickType {
  id: string;
  name: string;
  owned: number;
  total: number;
  addedRowId?: string;
}

/** "Makita MAC2400" for a tool, "Any Compressor" for a type, "Suction Cups (group of 4)" for a group. */
export function targetLabel(target: Target, tools: PickTool[], types: PickType[], groups: PickGroup[] = []): string {
  const p = parseTarget(target);
  if (!p) return target;
  if ("tool" in p) return tools.find((t) => t.id === p.tool)?.name ?? "Tool no longer in the Tools list";
  if ("type" in p) return `Any ${types.find((t) => t.id === p.type)?.name ?? p.type}`;
  const g = groups.find((x) => x.id === p.group);
  return g ? `${g.name} (group of ${g.toolIds.length})` : "Group no longer in the Tools list";
}

/** How many tools ride in each trailer. */
export function loadCounts(tools: PickTool[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tools) if (t.trailerId) m.set(t.trailerId, (m.get(t.trailerId) ?? 0) + 1);
  return m;
}

/**
 * Pick one target: any tool of a type, or one specific tool, grouped by type
 * and searchable. Typing a type the Tools list has none of offers to add it
 * (`onAddType`). The list opens in the page flow, so a clipped card cannot hide it.
 */
export function TargetPicker({
  tools,
  types,
  groups = [],
  exclude = [],
  onPick,
  onAddType,
  label = "Add tool…",
}: {
  tools: PickTool[];
  types: PickType[];
  groups?: PickGroup[];
  exclude?: Target[];
  onPick: (target: Target) => void;
  onAddType?: (name: string) => Promise<void>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = (t: Target) => {
    onPick(t);
    setOpen(false);
    setQ("");
  };
  const typeRows = types
    .map((ty) => ({
      ty,
      tools: tools.filter((t) => t.kindId === ty.id && matchesAllWords(`${t.name} ${t.type} ${t.at}`, q)),
      typeHit: matchesAllWords(`any ${ty.name}`, q),
    }))
    .filter((g) => g.typeHit || g.tools.length > 0);
  const names = new Map(tools.map((t) => [t.id, t.name]));
  const groupHits = groups.filter((g) => matchesAllWords(`group ${g.name} ${g.toolIds.map((id) => names.get(id) ?? "").join(" ")}`, q));
  const loads = loadCounts(tools);
  const exact = types.some((t) => t.id === typeKey(q));

  return (
    <div className="grid gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setQ("");
        }}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-line px-2.5 text-left text-[13px] text-neutral-500 hover:border-line-strong sm:w-80"
      >
        {label}
        <span aria-hidden className="text-[10px]">
          ▾
        </span>
      </button>
      {open && (
        <div className="flex max-h-80 w-full flex-col overflow-hidden rounded-xl border border-line bg-white shadow-lg dark:bg-ink-overlay sm:w-96">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            placeholder="Search tools, types or groups…"
            aria-label="Search tools, types or groups"
            className="border-b border-line bg-transparent px-3 py-2 text-sm outline-none"
          />
          <ul className="overflow-auto py-1">
            {groupHits.length > 0 && (
              <li className="border-b border-line-soft pb-1">
                <div className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Groups — every tool in it</div>
                {groupHits.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    disabled={exclude.includes(`group:${g.id}`)}
                    onClick={() => pick(`group:${g.id}`)}
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[13px] font-semibold hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-white/5"
                  >
                    <span>{g.name}</span>
                    <span className="min-w-0 truncate text-[11px] font-normal text-neutral-500">
                      {g.toolIds.map((id) => names.get(id) ?? id).join(", ")}
                    </span>
                  </button>
                ))}
              </li>
            )}
            {typeRows.map(({ ty, tools: list, typeHit }) => (
              <li key={ty.id}>
                {typeHit && (
                  <button
                    type="button"
                    disabled={exclude.includes(`type:${ty.id}`)}
                    onClick={() => pick(`type:${ty.id}`)}
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[13px] font-semibold hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-white/5"
                  >
                    <span>Any {ty.name}</span>
                    <span className={`shrink-0 text-[11px] font-normal ${ty.owned ? "text-neutral-500" : "text-danger"}`}>
                      {ty.owned ? `${ty.owned} owned` : "None owned"}
                    </span>
                  </button>
                )}
                {list.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={exclude.includes(`tool:${t.id}`)}
                    onClick={() => pick(`tool:${t.id}`)}
                    className="flex w-full items-baseline justify-between gap-2 py-1.5 pl-7 pr-3 text-left text-[13px] hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-white/5"
                  >
                    <span className={t.usable ? "" : "text-neutral-400 line-through"}>
                      {t.name}
                      {loads.get(t.id) ? <span className="text-[11px] text-neutral-500"> + {loads.get(t.id)} riding in it</span> : null}
                    </span>
                    <span className="min-w-0 truncate text-[11px] text-neutral-500">{t.usable ? t.at : t.condition}</span>
                  </button>
                ))}
              </li>
            ))}
            {typeRows.length === 0 && groupHits.length === 0 && <li className="px-3 py-2 text-[13px] text-neutral-500">No tool or type matches.</li>}
            {onAddType && q.trim() && !exact && (
              <li className="border-t border-line-soft">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onAddType(q.trim());
                      pick(`type:${typeKey(q)}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="w-full px-3 py-2 text-left text-[13px] text-accent hover:bg-neutral-100 dark:text-accent-soft dark:hover:bg-white/5"
                >
                  + Add “{q.trim()}” as a tool type you don&apos;t own
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A tool type a rule asks for that none of is free, for one job (from `/api/tool-schedule/availability`). */
export interface Shortage {
  kindId: string;
  typeName: string;
  jobId: string;
  jobName: string;
  jobLabel: string;
  from: string;
  to: string;
  taskNames: string[];
  noneOwned: boolean;
}

/** Which of these rule targets are short for some job, newly named types only. */
export async function findShortages(match: RuleMatch, key: string, added: Target[]): Promise<Shortage[]> {
  const types = added.filter((t) => t.startsWith("type:"));
  if (types.length === 0) return [];
  const r = await fetch(`/api/tool-schedule/availability?match=${match}&key=${encodeURIComponent(key)}&targets=${encodeURIComponent(types.join(","))}`);
  const j = await r.json().catch(() => ({}));
  return r.ok && Array.isArray(j?.shortages) ? (j.shortages as Shortage[]) : [];
}

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const newKey = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

/**
 * "No compressor is free for these jobs. Create a requisition?" One
 * requisition per job, filed through `/api/requisitions` (the Requisitions page's
 * own route), type Equipment, needed by the first short day.
 */
export function RequisitionPrompt({ shortages, onClose }: { shortages: Shortage[]; onClose: () => void }) {
  const [chosen, setChosen] = useState<Set<number>>(new Set(shortages.map((_, i) => i)));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState("");
  const typeNames = [...new Set(shortages.map((s) => s.typeName))].join(", ");

  async function file() {
    setBusy(true);
    setError("");
    let ok = 0;
    try {
      for (const [i, s] of shortages.entries()) {
        if (!chosen.has(i)) continue;
        const r = await fetch("/api/requisitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `${s.typeName} for ${s.jobName}`,
            jobId: s.jobId,
            jobLabel: s.jobLabel,
            type: "Equipment",
            priority: "Normal",
            neededBy: s.from,
            description:
              `The tool schedule needs a ${s.typeName.toLowerCase()} on ${s.jobName} from ${fmt(s.from)} to ${fmt(s.to)}` +
              ` (${s.taskNames.join(", ")}). ${s.noneOwned ? "The company owns none." : "Every one owned is booked then."} Buy, rent or borrow one.`,
            clientKey: newKey(),
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        ok++;
      }
      setDone(ok);
    } catch (e) {
      setError(`${ok ? `Filed ${ok}, then: ` : ""}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onClose={onClose}
      busy={busy}
      title={done === null ? `No ${typeNames} free` : "Requisitions filed"}
      description={done === null ? "These tasks need one on days none is free. Create a requisition so the office can buy, rent or borrow one?" : undefined}
      footer={
        done === null ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={file} disabled={busy || chosen.size === 0}>
              {chosen.size === 1 ? "Create requisition" : `Create ${chosen.size} requisitions`}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Not now
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <a href="/requisitions" className="text-sm font-semibold underline">
              Open Requisitions
            </a>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        )
      }
    >
      {error && <Banner tone="error" className="mb-3">{error}</Banner>}
      {done !== null ? (
        <p className="text-sm">
          Filed {done} {done === 1 ? "requisition" : "requisitions"}. The office sees {done === 1 ? "it" : "them"} on the Requisitions page.
        </p>
      ) : (
        <ul className="grid gap-2">
          {shortages.map((s, i) => (
            <li key={`${s.kindId}-${s.jobId}`}>
              <Checkbox
                checked={chosen.has(i)}
                onChange={() => {
                  const next = new Set(chosen);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  setChosen(next);
                }}
                label={
                  <span>
                    <b className="font-semibold">{s.typeName}</b> for {s.jobName}, {fmt(s.from)} – {fmt(s.to)}
                    <span className="block text-[12px] text-neutral-500">
                      {s.taskNames.join(", ")} · {s.noneOwned ? "none owned" : "all booked"}
                    </span>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
