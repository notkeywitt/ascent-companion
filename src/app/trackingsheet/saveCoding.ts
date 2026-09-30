import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { billLineMath, recodeLog, round2, type LineChange, type LineEdit, type RecodeEntry } from "@/lib/billLineMath";
import { discardDraft, type TimeEntryEdit } from "@/lib/codingDraft";
import { postCombine, type CombineRequest } from "@/lib/combineLines";
import type { BoardPayload, JobBillLine } from "./Board";

type Setter<T> = Dispatch<SetStateAction<T>>;

/** Everything Save reads off the board, at the moment it is pressed. */
export interface SaveCodingInput {
  data: BoardPayload | null;
  dirty: boolean;
  setSyncing: Setter<boolean>;
  setSyncMsg: Setter<{ tone: "success" | "error"; text: string } | null>;
  staged: Map<string, string>;
  edits: Record<string, LineEdit | undefined>;
  linesByDoc: Map<string, JobBillLine[]>;
  billTax: (b: { id: string; nonRecoverableTax?: number } | undefined | null) => number;
  timeStaged: Map<string, string>;
  timeEdits: Record<string, TimeEntryEdit>;
  typeEdits: Record<string, "Bill" | "Expense">;
  taxEdits: Record<string, string>;
  combinePending: CombineRequest | null;
  setCombining: Setter<boolean>;
  setCombineMsg: Setter<string>;
  setCombinePending: Setter<CombineRequest | null>;
  setRestoreMsg: Setter<{ kept: number; dropped: number; savedAt: string } | null>;
  draftKey: string;
  load: (opts?: { preserveStaged?: boolean }) => Promise<void>;
  restoreStartedRef: MutableRefObject<string>;
  autosaveArmedRef: MutableRefObject<string>;
}

/**
 * SAVE on the Tracking Sheets board — every staged change, written to
 * JobTread in a fixed order: each touched bill's whole set of lines
 * (/api/code), labor recodes (/api/labor-review), entry corrections
 * (/api/time-entry), Bill/Expense types (/api/bill-fields), tax
 * (/api/bill-tax), and the staged merge LAST (it deletes lines). Then the
 * month is re-read; a fully good Save drops the draft, a partly failed one
 * re-arms it so only what failed comes back.
 *
 * This is the board's JobTread write loop. Moved out of Board.tsx on
 * 2026-09-29 (SIMPLICITY_AUDIT.md finding 01) with the owner's ok; the body
 * is the board's, unchanged — it reads the same names, unpacked below.
 */
export async function saveCoding(input: SaveCodingInput): Promise<void> {
  const {
    data,
    dirty,
    setSyncing,
    setSyncMsg,
    staged,
    edits,
    linesByDoc,
    billTax,
    timeStaged,
    timeEdits,
    typeEdits,
    taxEdits,
    combinePending,
    setCombining,
    setCombineMsg,
    setCombinePending,
    setRestoreMsg,
    draftKey,
    load,
    restoreStartedRef,
    autosaveArmedRef,
  } = input;
    if (!data || !dirty) return;

    setSyncing(true);
    setSyncMsg(null);

    // WHOLE-BILL PUSH, the same pattern the bill page uses. Every touched bill
    // sends ALL of its lines, not just the edited ones: JobTread stores costs
    // tax-inclusive, so editing one line shifts the bill's shared gross-up
    // factor and the untouched lines would otherwise appear to drift. On a
    // tax-free bill this is idempotent, and /api/code drops lines with nothing
    // to write. One POST per bill keeps that route's per-docId "saved" marker
    // correct without changing it.
    const touched = new Set<string>();
    for (const lineId of staged.keys()) {
      const l = data.lines.find((x) => x.id === lineId);
      if (l) touched.add(l.docId);
    }
    for (const lineId of Object.keys(edits)) {
      const l = data.lines.find((x) => x.id === lineId);
      if (l) touched.add(l.docId);
    }

    const pickedAll = Object.fromEntries(staged);
    const byDoc = new Map<string, { changes: LineChange[]; codingLog: RecodeEntry[] }>();
    for (const docId of touched) {
      const bill = data.bills.find((b) => b.id === docId);
      if (!bill) continue;
      const docLines = linesByDoc.get(docId) ?? [];
      const { wholeBillChanges } = billLineMath({
        lines: docLines,
        storedTax: billTax(bill),
        legacyTaxField: bill.nonRecoverableTax,
        status: bill.status,
        edits,
        picked: pickedAll,
        budget: data.budget,
      });
      byDoc.set(docId, {
        changes: wholeBillChanges,
        codingLog: recodeLog(docLines, pickedAll, data.budget),
      });
    }

    let ok = 0;
    let combineOk = 0;
    const failures: string[] = [];
    for (const [docId, { changes, codingLog }] of byDoc) {
      try {
        const r = await fetch("/api/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, changes, codingLog }),
        });
        const j = await r.json();
        if (j.error) failures.push(j.error);
        else if (j.wrote === false) failures.push(j.message ?? "Writes are disabled.");
        else {
          for (const res of j.results ?? []) {
            if (res.ok) ok++;
            else failures.push(res.error ?? "Unknown error");
          }
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Request failed");
      }
    }

    // Push staged LABOR recodes — one POST for the lot, to the same endpoint
    // Labor Review uses, so a week of hours moved from this board and a week
    // moved from that page write the identical thing.
    let timeOk = 0;
    if (timeStaged.size > 0) {
      const changes = [...timeStaged.entries()].map(([id, costItemId]) => ({ id, costItemId }));
      try {
        const r = await fetch("/api/labor-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
        });
        const j = await r.json();
        if (j.error) failures.push(j.error);
        else if (j.previewed) failures.push(j.message ?? "Writes are disabled.");
        else {
          for (const res of (j.results ?? []) as { ok: boolean; error?: string }[]) {
            if (res.ok) timeOk++;
            else failures.push(res.error ?? "Unknown error");
          }
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Time recode request failed");
      }
    }

    // …and the staged ENTRY CORRECTIONS — hours, day, pay type. One POST each,
    // to the same route the panel used to call on its own. They go after the
    // recodes so a re-timed entry lands on its new code first: /api/time-entry
    // re-rates off the span, and the code it is charged to is settled by then.
    let timeEditOk = 0;
    for (const [id, patch] of Object.entries(timeEdits)) {
      try {
        const r = await fetch("/api/time-entry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...patch }),
        });
        const j = await r.json();
        if (j.error) failures.push(j.error);
        else if (j.previewed) failures.push(j.message ?? "Writes are disabled.");
        else timeEditOk++;
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Time edit request failed");
      }
    }

    // Push tax — a separate loop, since tax is not one of the line changes above.
    //
    // Two reasons a bill lands here. A STAGED EDIT is the obvious one. The other
    // is a bill this Sync just re-coded that still carries its tax in the legacy
    // document field: the line write above sent de-taxed costs, so the tax has to
    // move onto its own 88 80 00 line in the same Sync or the bill's total falls
    // by the tax amount. Re-sending the tax it already has is what migrates it.
    // Bill/Expense type: one /api/bill-fields write per bill, the name AND
    // "Push as" together (and the vendor's default follows it).
    let typeOk = 0;
    for (const [docId, t] of Object.entries(typeEdits)) {
      try {
        const r = await fetch("/api/bill-fields", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, name: t }),
        });
        const j = await r.json();
        if (j.error) failures.push(j.error);
        else if (j.previewed) failures.push("Writes are disabled.");
        else {
          typeOk++;
          if (j.vendorWarning) failures.push(j.vendorWarning);
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Type request failed");
      }
    }

    let taxOk = 0;
    let taxOffCount = 0; // bills whose "Record Tax" toggle this Sync turns back off
    const taxWork = new Map<string, number>();
    for (const [docId, v] of Object.entries(taxEdits)) {
      if (v === "") continue;
      taxWork.set(docId, round2(Number(v) || 0));
    }
    for (const docId of touched) {
      if (taxWork.has(docId)) continue;
      const bill = data.bills.find((b) => b.id === docId);
      // `recordsTax` queues a bill whose "Record Tax" toggle is still on even at
      // 0.00: the empty document tax row it leaves is the one anyone can type
      // into, and a figure typed there counts on top of the 88 80 00 line. The
      // amount pushed is the tax the bill already has, so this changes no money.
      //
      // DRAFT ONLY. The line write above sends costs only on a draft bill, so a
      // non-draft bill has nothing to re-tax — and on a bill already in
      // QuickBooks this write is refused (src/lib/qboLock.ts), which reported a
      // failure for a re-code that had landed.
      if (bill && bill.status === "draft" && ((bill.nonRecoverableTax ?? 0) > 0 || bill.recordsTax))
        taxWork.set(docId, billTax(bill));
    }
    for (const [docId, amount] of taxWork) {
      const bill = data.bills.find((b) => b.id === docId);
      if (!bill) continue;
      const amountChanged = amount !== round2(billTax(bill));
      const migrating = (bill.nonRecoverableTax ?? 0) > 0;
      // Unchanged AND already on the current model AND the toggle already off —
      // nothing to write.
      if (!amountChanged && !migrating && !bill.recordsTax) continue;
      try {
        const r = await fetch("/api/bill-tax", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, taxAmount: amount }),
        });
        const j = await r.json();
        if (j.error) failures.push(j.error);
        else if (j.wrote === false) failures.push(j.message ?? "Writes are disabled.");
        else {
          // Counted apart: a bill can reach here for the toggle alone, and
          // reporting that as a "tax edit" would claim money moved when none did.
          if (amountChanged || migrating) taxOk++;
          if (bill.recordsTax) taxOffCount++;
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Tax request failed");
      }
    }

    // THE STAGED MERGE GOES LAST, after every line write.
    //
    // Ordering matters and this is the safe end. Combining DELETES lines, so
    // running it first would leave the whole-bill push above posting updates
    // against ids that no longer exist — and it could not simply skip them,
    // because `data` in this closure is the list from before the merge. Run
    // last, every write above targets a line that still exists, and the merge
    // then collapses them. The card blocks edits on a line a staged merge
    // touches, so the summed cost it carries cannot go stale in between.
    let combineErr = "";
    if (combinePending) {
      setCombining(true);
      combineErr = await postCombine(combinePending);
      setCombining(false);
      setCombineMsg(combineErr);
      if (!combineErr) {
        setCombinePending(null);
        combineOk = combinePending.deleteIds.length + 1;
      }
    }

    setSyncing(false);
    const parts = [];
    if (ok > 0) parts.push(`${ok} line${ok === 1 ? "" : "s"}`);
    if (timeOk > 0) parts.push(`${timeOk} time ${timeOk === 1 ? "entry" : "entries"}`);
    if (timeEditOk > 0)
      parts.push(`${timeEditOk} entry ${timeEditOk === 1 ? "correction" : "corrections"}`);
    if (taxOk > 0) parts.push(`${taxOk} tax edit${taxOk === 1 ? "" : "s"}`);
    if (typeOk > 0) parts.push(`${typeOk} bill type${typeOk === 1 ? "" : "s"}`);
    if (taxOffCount > 0)
      parts.push(`Record Tax off on ${taxOffCount} bill${taxOffCount === 1 ? "" : "s"}`);
    if (combineOk > 0) parts.push(`${combineOk} lines merged`);
    const summary = parts.length ? parts.join(" + ") : "0 changes";
    if (combineErr) failures.push(`Combine: ${combineErr}`);
    if (failures.length === 0) {
      setSyncMsg({ tone: "success", text: `Saved ${summary} to JobTread.` });
      setRestoreMsg(null);
      if (draftKey) discardDraft(draftKey); // it's in JobTread now — nothing left to hold
      await load(); // load() clears staged
    } else {
      setSyncMsg({
        tone: "error",
        text: `Saved ${summary}, ${failures.length} failed: ${[...new Set(failures)].slice(0, 2).join("; ")}`,
      });
      // A PARTLY failed sync is the worst moment to drop the draft: load() is
      // about to empty the staged state, and the changes that didn't land would
      // go with it. Re-arm the restore instead — reconcileDraft drops everything
      // JobTread has now taken, so what comes back is exactly what failed.
      restoreStartedRef.current = "";
      autosaveArmedRef.current = "";
      setRestoreMsg(null);
      await load();
    }
}
