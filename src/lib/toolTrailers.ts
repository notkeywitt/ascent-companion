import { revalidateTag } from "next/cache";

import { callAppsScript } from "@/lib/appsScript";
import { trailerLoads } from "@/lib/toolScheduleStore";

/**
 * A trailer's load goes where the trailer goes (TOOL_SCHEDULE_PLAN.md). The
 * load lives in the companion table `tool_trailer_items`; the location lives in
 * the Tools sheet. When a trailer moves (a scan, or a Location edit on the
 * Tools page), this writes the same ProjectID to every tool it holds, through
 * the same Apps Script action a scan uses. Server only.
 */

/** The tools riding in `trailerId`, by Tools-list id. */
export async function loadOf(trailerId: string): Promise<string[]> {
  const loads = await trailerLoads();
  return Object.entries(loads)
    .filter(([toolId, t]) => t === trailerId && toolId !== trailerId)
    .map(([toolId]) => toolId);
}

/**
 * Move every tool riding in `trailerId` to `projectId`. One call at a time:
 * Apps Script takes a lock per write, so parallel calls only queue. Returns
 * the ids it could not move. Drops the Tools cache when anything moved.
 */
export async function moveLoadWith(trailerId: string, projectId: string, email: string): Promise<{ moved: number; failed: string[] }> {
  if (!trailerId || !projectId) return { moved: 0, failed: [] };
  const ids = await loadOf(trailerId);
  let moved = 0;
  const failed: string[] = [];
  for (const toolId of ids) {
    const r = await callAppsScript({ action: "updateToolLocation", toolId, projectId, lastScanEmail: email }, { timeoutMs: 20_000 });
    if (r.error) failed.push(toolId);
    else moved++;
  }
  if (moved) revalidateTag("tools");
  return { moved, failed };
}
