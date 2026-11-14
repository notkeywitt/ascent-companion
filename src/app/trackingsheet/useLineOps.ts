"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * STAGED STRUCTURAL EDITS — the money-moving writes that used to fire on one
 * tap: delete a line, add a line, buy a line back to the Shop bill, void a
 * bill. Under the one save rule (OVERHAUL_PLAN Phase 6) an edit that changes
 * money stages behind Save Changes, so these now sit here until the host's
 * Save runs `run()`. Anything that changes no money (a date, a number, an
 * approval) still writes at once, with a toast.
 *
 * One hook for both hosts of the coding card — the board (saveCoding.ts) and
 * the draft queue (useBillEditor in DraftWorkbench.tsx). The card draws the
 * staged state off `view`. `run()` posts the same routes the taps used to:
 * /api/buyback, /api/delete-line, /api/add-line, /api/bill-void — in that
 * order, after every line write, because the first three remove lines those
 * writes target and the void ends the bill. An op is dropped as soon as its
 * write lands, so a partly failed Save keeps exactly what failed.
 *
 * ponytail: not held in the durable coding draft (codingDraft.ts) — a reload
 * drops staged ops, which the staged count makes visible. Add them to the
 * draft if the office loses one.
 */

export interface StagedAdd {
  key: string;
  docId: string;
  name: string;
  quantity: number;
  /** Pre-tax, as typed — what the card shows. */
  preTaxUnit: number;
  /** Grossed up against the bill's tax, as /api/add-line wants it. */
  unitCost: number;
  jobCostItemId?: string;
  description?: string;
}
export interface StagedBuyback {
  lineId: string;
  docId: string;
  name: string;
  unitCost: number;
  description?: string;
}
export interface StagedDelete {
  docId: string;
  label: string;
}

/** What the coding card draws: which rows are going, what is coming, the void. */
export interface LineOpsView {
  deleted: Map<string, StagedDelete>;
  bought: Map<string, StagedBuyback>;
  adds: StagedAdd[];
  /** docId → bill label */
  voids: Map<string, string>;
  unstageAdd: (key: string) => void;
}

export interface LineOps {
  view: LineOpsView;
  count: number;
  toggleDelete: (lineId: string, docId: string, label: string) => void;
  stageAdd: (add: Omit<StagedAdd, "key">) => void;
  unstageAdd: (key: string) => void;
  stageBuyback: (b: StagedBuyback) => void;
  unstageBuyback: (lineId: string) => void;
  toggleVoid: (docId: string, label: string) => void;
  clear: () => void;
  /** Post everything, in order. Resolves with what landed and what failed. */
  run: () => Promise<{ done: string[]; failures: string[]; voided: string[] }>;
}

async function post(url: string, body: unknown): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j?.error) return j?.error ?? `Request failed (${res.status})`;
    if (j?.previewed) return "Writes are OFF — nothing changed in JobTread.";
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : "Network error";
  }
}

export function useLineOps(): LineOps {
  const [deleted, setDeleted] = useState<Map<string, StagedDelete>>(new Map());
  const [bought, setBought] = useState<Map<string, StagedBuyback>>(new Map());
  const [adds, setAdds] = useState<StagedAdd[]>([]);
  const [voids, setVoids] = useState<Map<string, string>>(new Map());

  const toggleDelete = useCallback((lineId: string, docId: string, label: string) => {
    setDeleted((prev) => {
      const next = new Map(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.set(lineId, { docId, label });
      return next;
    });
    // A line cannot both go to the Shop and be deleted.
    setBought((prev) => {
      if (!prev.has(lineId)) return prev;
      const next = new Map(prev);
      next.delete(lineId);
      return next;
    });
  }, []);

  const stageAdd = useCallback((add: Omit<StagedAdd, "key">) => {
    setAdds((prev) => [...prev, { ...add, key: `${add.docId}:${Date.now()}:${prev.length}` }]);
  }, []);
  const unstageAdd = useCallback((key: string) => {
    setAdds((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const stageBuyback = useCallback((b: StagedBuyback) => {
    setBought((prev) => new Map(prev).set(b.lineId, b));
    setDeleted((prev) => {
      if (!prev.has(b.lineId)) return prev;
      const next = new Map(prev);
      next.delete(b.lineId);
      return next;
    });
  }, []);
  const unstageBuyback = useCallback((lineId: string) => {
    setBought((prev) => {
      const next = new Map(prev);
      next.delete(lineId);
      return next;
    });
  }, []);

  const toggleVoid = useCallback((docId: string, label: string) => {
    setVoids((prev) => {
      const next = new Map(prev);
      if (next.has(docId)) next.delete(docId);
      else next.set(docId, label);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setDeleted(new Map());
    setBought(new Map());
    setAdds([]);
    setVoids(new Map());
  }, []);

  const run = useCallback(async () => {
    const done: string[] = [];
    const failures: string[] = [];
    const voided: string[] = [];

    for (const [lineId, b] of bought) {
      const err = await post("/api/buyback", {
        sourceDocId: b.docId,
        costItemId: lineId,
        name: b.name,
        unitCost: b.unitCost,
        description: b.description,
      });
      if (err) failures.push(`Buy back ${b.name}: ${err}`);
      else {
        done.push(`bought back ${b.name}`);
        unstageBuyback(lineId);
      }
    }
    for (const [lineId, d] of deleted) {
      const err = await post("/api/delete-line", { docId: d.docId, costItemId: lineId });
      if (err) failures.push(`Delete ${d.label}: ${err}`);
      else {
        done.push(`deleted ${d.label}`);
        setDeleted((prev) => {
          const next = new Map(prev);
          next.delete(lineId);
          return next;
        });
      }
    }
    for (const a of adds) {
      const err = await post("/api/add-line", {
        docId: a.docId,
        name: a.name,
        quantity: a.quantity,
        unitCost: a.unitCost,
        jobCostItemId: a.jobCostItemId,
        description: a.description,
      });
      if (err) failures.push(`Add ${a.name}: ${err}`);
      else {
        done.push(`added ${a.name}`);
        unstageAdd(a.key);
      }
    }
    for (const [docId, label] of voids) {
      const err = await post("/api/bill-void", { docId });
      if (err) failures.push(`Void ${label}: ${err}`);
      else {
        done.push(`voided ${label}`);
        voided.push(docId);
        setVoids((prev) => {
          const next = new Map(prev);
          next.delete(docId);
          return next;
        });
      }
    }
    return { done, failures, voided };
  }, [bought, deleted, adds, voids, unstageBuyback, unstageAdd]);

  const view = useMemo<LineOpsView>(
    () => ({ deleted, bought, adds, voids, unstageAdd }),
    [deleted, bought, adds, voids, unstageAdd],
  );

  return {
    view,
    count: deleted.size + bought.size + adds.length + voids.size,
    toggleDelete,
    stageAdd,
    unstageAdd,
    stageBuyback,
    unstageBuyback,
    toggleVoid,
    clear,
    run,
  };
}
