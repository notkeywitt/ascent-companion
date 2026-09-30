"use client";

import { useCallback, useMemo, useState } from "react";
import { isCommitted } from "./headroom";
import type { TimeEntryRow } from "@/components/TimeEntryList";
import type { BoardPayload, BudgetItem, DrillBillRow, JobBillLine, JobCostContributors } from "./Board";

/**
 * The Tracking Sheets board's cost-code drill-down: which bills and time
 * entries make up one code's total, for the rail's drill-down modal and the
 * cost rings' hover cards. Read-only. The whole job's contributors come back
 * in one fetch (/api/trackingsheet/contributors), cached per job.
 *
 * Staged-aware: a line dragged to another code in this session is listed
 * under the code the rail now counts it toward, not its stored one.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * code is the board's, unchanged.
 */
export function useCodeDrill({
  codeOf,
  data,
  jobId,
  leafById,
  staged,
  timeCodeOf,
}: {
  codeOf: (l: JobBillLine) => string;
  data: BoardPayload | null;
  jobId: string;
  leafById: Map<string, BudgetItem>;
  staged: Map<string, string>;
  timeCodeOf: (t: TimeEntryRow) => string;
}) {
  // ---- cost-code drill-down: which bills/time entries make up a total -----
  /** The rail code currently open in the drill-down modal, or null when closed. */
  const [codeDrill, setCodeDrill] = useState<string | null>(null);
  // The whole job's contributors come back in one fetch (see
  // getJobCostContributors) and are cached here so opening a second code is
  // instant; tagged with the jobId they belong to so switching jobs can't
  // serve a stale job's bills under the new job's codes.
  const [contributors, setContributors] = useState<{
    jobId: string;
    data: JobCostContributors;
  } | null>(null);
  const [contributorsLoading, setContributorsLoading] = useState(false);
  const [contributorsError, setContributorsError] = useState("");

  /** One fetch per job, cached — the drill-down and the cost rings both want it. */
  const ensureContributors = useCallback(() => {
    if (!jobId || contributorsLoading || contributors?.jobId === jobId) return;
    setContributorsLoading(true);
    setContributorsError("");
    fetch(`/api/trackingsheet/contributors?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setContributors({ jobId, data: j as JobCostContributors });
      })
      .catch((e) => setContributorsError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setContributorsLoading(false));
  }, [jobId, contributors, contributorsLoading]);

  const openCodeDrill = useCallback(
    (code: string) => {
      setCodeDrill(code);
      ensureContributors();
    },
    [ensureContributors],
  );

  const billsById = useMemo(() => new Map((data?.bills ?? []).map((b) => [b.id, b])), [data]);

  /**
   * Committed bills, reconciled against any staged-but-not-synced recode: a
   * contributor row is JobTread's TRUE current code (`b.code`), but if its line
   * has been dragged elsewhere in this session, `staged` already moved it in
   * the rail's own numbers (see the `headroom` memo) — so the drill-down must
   * follow the same staged code, or it would list a bill under a code the rail
   * no longer counts it toward.
   */
  const billsForCode = useCallback(
    (code: string): DrillBillRow[] => {
      const committed = (contributors?.data.bills ?? [])
        .filter((b) => {
          const leaf = staged.get(b.id);
          const effective = leaf ? (leafById.get(leaf)?.number ?? b.code) : b.code;
          return effective === code;
        })
        .map((b): DrillBillRow => ({
          key: b.id,
          docId: b.docId,
          vendor: b.vendor,
          lineName: b.lineName,
          issueDate: b.issueDate,
          status: b.status,
          cost: b.cost,
          draft: false,
        }));
      const drafts = (data?.lines ?? [])
        .filter((l) => !isCommitted(l.billStatus) && codeOf(l) === code)
        .map((l): DrillBillRow => ({
          key: l.id,
          docId: l.docId,
          vendor: billsById.get(l.docId)?.vendor ?? l.name,
          lineName: l.name,
          issueDate: billsById.get(l.docId)?.issueDate ?? null,
          status: l.billStatus,
          cost: l.cost,
          draft: true,
        }));
      return [...committed, ...drafts].sort(
        (a, b) =>
          String(b.issueDate ?? "").localeCompare(String(a.issueDate ?? "")) || b.cost - a.cost,
      );
    },
    [contributors, staged, leafById, data, billsById, codeOf],
  );

  const drillBills = useMemo(
    () => (codeDrill ? billsForCode(codeDrill) : []),
    [codeDrill, billsForCode],
  );

  // Labor is coded independently of any bill and never moves with a staged
  // recode (see the `usedOf` note above), so this needs no staged reconciliation.
  // Every entry counts, approved or not — the same set the rail's labor figure
  // sums — and each row carries its own approval tag.
  const drillTime = useMemo(
    () => (contributors?.data.time ?? []).filter((t) => t.code === codeDrill),
    [contributors, codeDrill],
  );

  /**
   * What one ring slice is made of, for its hover card — the biggest vendors
   * (bills) or people (labor) behind that cost code, rolled to one row each so
   * a bill with four lines is one line of the card.
   *
   * Scope matters: the MONTH ring reads the month's own lines and time entries,
   * which are already loaded, so its card opens instantly. The JOB ring needs
   * the same whole-job contributors the drill-down uses, so it returns null
   * until that fetch lands and the card says "Loading…" meanwhile.
   */
  const donutDetail = useCallback(
    (
      code: string,
      field: "bills" | "labor",
      scope: "month" | "job",
    ): { key: string; label: string; value: number }[] | null => {
      const rolled = new Map<string, { label: string; value: number }>();
      const add = (key: string, label: string, value: number) => {
        const e = rolled.get(key) ?? { label, value: 0 };
        e.value += value;
        rolled.set(key, e);
      };

      if (scope === "month") {
        if (field === "bills") {
          for (const l of data?.lines ?? []) {
            if (codeOf(l) !== code) continue;
            add(l.docId, billsById.get(l.docId)?.vendor || l.name, l.cost);
          }
        } else {
          for (const t of data?.timeEntries ?? []) {
            if (timeCodeOf(t) !== code) continue;
            add(t.employee || t.id, t.employee || "—", t.cost);
          }
        }
      } else {
        if (contributors?.jobId !== jobId) return null;
        if (field === "bills") {
          for (const b of billsForCode(code)) add(b.docId, b.vendor || b.lineName, b.cost);
        } else {
          for (const t of contributors.data.time) {
            if (t.code !== code) continue;
            add(t.employee || t.id, t.employee || "—", t.cost);
          }
        }
      }

      return [...rolled.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value);
    },
    [data, codeOf, timeCodeOf, billsById, contributors, jobId, billsForCode],
  );

  return {
    codeDrill,
    contributorsError,
    contributorsLoading,
    donutDetail,
    drillBills,
    drillTime,
    ensureContributors,
    openCodeDrill,
    setCodeDrill,
  };
}
