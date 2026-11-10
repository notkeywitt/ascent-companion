"use client";

import { useState } from "react";

import { useAccess } from "@/components/AccessProvider";
import { Banner, Button, Label, Loading, inputCls } from "@/components/ui";
import { isTrailerType, typeKey } from "@/lib/toolSchedule";
import { AssignedTasks, useTaskRules } from "../tool-schedule/TaskAssign";
import { RequisitionPrompt } from "../tool-schedule/ToolPickers";

/**
 * The Tools page's edit dialog, below the sheet fields: what ties this tool to
 * the Tool Schedule (TOOL_SCHEDULE_PLAN.md).
 * - A trailer lists what rides in it; any other tool says which trailer it
 *   rides in. A tool in a trailer goes where the trailer goes.
 * - Tasks: the phases and task names this tool, and its Tool group, are
 *   assigned to (office only — the `tool-schedule-edit` view).
 * Every change here saves at once; the dialog's Save is for the sheet fields.
 */

export interface LinkTool {
  id: string;
  name: string;
  type: string;
  toolGroup: string;
  location: string;
  locationLabel: string;
}

export async function putTrailer(toolId: string, trailerId: string): Promise<{ moved: boolean }> {
  const r = await fetch("/api/tools/trailer", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toolId, trailerId }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as { moved: boolean };
}

export function ToolLinks({
  tool,
  tools,
  loads,
  onLoadsChange,
  onMoved,
}: {
  tool: LinkTool;
  tools: LinkTool[];
  /** Tool id → the trailer it rides in. */
  loads: Record<string, string>;
  onLoadsChange: (next: Record<string, string>) => void;
  /** A tool put in a trailer now sits where the trailer is. */
  onMoved: (toolId: string, location: string, locationLabel: string) => void;
}) {
  const access = useAccess();
  const canPlan = access.can("tool-schedule-edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState("");
  const isTrailer = isTrailerType(tool.type);
  const trailers = tools.filter((t) => isTrailerType(t.type) && t.id !== tool.id);
  const riding = tools.filter((t) => loads[t.id] === tool.id);
  const name = (t: LinkTool) => t.name || t.id;

  async function setTrailer(toolId: string, trailerId: string) {
    setBusy(true);
    setError("");
    try {
      const r = await putTrailer(toolId, trailerId);
      const next = { ...loads };
      if (trailerId) next[toolId] = trailerId;
      else delete next[toolId];
      onLoadsChange(next);
      const trailer = tools.find((t) => t.id === trailerId);
      if (r.moved && trailer) onMoved(toolId, trailer.location, trailer.locationLabel);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 grid gap-4 border-t border-line pt-4">
      {error && <Banner tone="error">{error}</Banner>}
      {isTrailer ? (
        <div className="grid gap-2">
          <Label>Riding in this trailer</Label>
          <p className="-mt-1 text-xs text-neutral-500">They go where the trailer goes, and are booked with it. Saves at once.</p>
          {riding.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {riding.map((t) => (
                <li key={t.id} className="inline-flex items-center gap-1 rounded-full border border-line-strong py-0.5 pl-2.5 text-[12px]">
                  {name(t)}
                  <button type="button" aria-label={`Take ${name(t)} out`} disabled={busy} onClick={() => void setTrailer(t.id, "")} className="min-h-7 min-w-7 text-neutral-500">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <select aria-label="Add a tool to this trailer" value={adding} onChange={(e) => setAdding(e.target.value)} className={inputCls + " flex-1"}>
              <option value="">Add a tool…</option>
              {tools
                .filter((t) => t.id !== tool.id && !isTrailerType(t.type) && loads[t.id] !== tool.id)
                .sort((a, b) => name(a).localeCompare(name(b)))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {name(t)}
                    {loads[t.id] ? ` (now in ${name(tools.find((x) => x.id === loads[t.id]) ?? t)})` : ""}
                  </option>
                ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !adding}
              onClick={async () => {
                await setTrailer(adding, tool.id);
                setAdding("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      ) : trailers.length > 0 ? (
        <div className="grid gap-1">
          <Label>Rides in</Label>
          <select aria-label="Rides in" value={loads[tool.id] ?? ""} disabled={busy} onChange={(e) => void setTrailer(tool.id, e.target.value)} className={inputCls}>
            <option value="">— No trailer —</option>
            {trailers.map((t) => (
              <option key={t.id} value={t.id}>
                {name(t)}
                {t.locationLabel ? ` · ${t.locationLabel}` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">In a trailer, it goes where the trailer goes. Saves at once.</p>
        </div>
      ) : null}
      {canPlan && <ToolTasks tool={tool} />}
    </div>
  );
}

/** The tasks this tool — and its Tool group — are assigned to. Office only. */
function ToolTasks({ tool }: { tool: LinkTool }) {
  const { editing, error, prompt, clearPrompt } = useTaskRules();
  const group = tool.toolGroup.trim();
  return (
    <div className="grid gap-3">
      <div>
        <Label>Tasks</Label>
        <p className="text-xs text-neutral-500">Which schedule tasks need this tool. A phase covers every task under it. Saves at once.</p>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {!editing ? (
        error ? null : <Loading label="Reading the JobTread schedules…" />
      ) : (
        <>
          <AssignedTasks e={editing} target={`tool:${tool.id}`} />
          {group && (
            <div className="grid gap-1">
              <span className="text-[13px] font-semibold">Its group, {group}</span>
              <p className="text-xs text-neutral-500">Assign the group to send every tool in it.</p>
              <AssignedTasks e={editing} target={`group:${typeKey(group)}`} />
            </div>
          )}
        </>
      )}
      {prompt && <RequisitionPrompt shortages={prompt} onClose={clearPrompt} />}
    </div>
  );
}
