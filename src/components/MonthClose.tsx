"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip, Dialog, MetaLine, Select, btn } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { money } from "@/lib/money";
import { closeProgress, recordsLabel, sheetsCatchUp, shortMonth } from "@/lib/monthClose";
import type { MonthClosePreview, MonthCloseRow } from "@/app/api/month-close/route";

/**
 * The tracking-sheet month close on Home: one chip that says where the sheets
 * stand ("October: 3 of 12 closed"), and the close preview it opens.
 *
 * The sheets' month is the active period Apps Script holds. It is not a user
 * control: the close moves it. The one exception is a stored month that fell
 * behind Home's (July stored while the sheets show October): the chip then
 * offers a one-time catch-up to the month before Home's.
 *
 * The preview (/api/month-close) is read-only: a read of every sheet and a
 * finalize dry run. Rules: src/lib/monthClose.ts.
 */

interface SheetJob {
  id: string;
  label: string;
}

interface ChipState {
  sheetsYm: string;
  paused: boolean;
  jobs: SheetJob[];
  closed: Set<string>;
}

async function readChip(): Promise<ChipState> {
  const list = await fetch("/api/tracking-sheet", { cache: "no-store" }).then((r) => r.json());
  if (list?.error) throw new Error(list.error);
  const sheetsYm = `${list.defaultYear}-${String(list.defaultMonth).padStart(2, "0")}`;
  const acts = await fetch(`/api/month-actions?ym=${sheetsYm}`, { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => ({ runs: [] }));
  const closed = new Set<string>(
    ((acts?.runs as { action: string; scope: string }[]) ?? []).filter((r) => r.action === "finalize").map((r) => r.scope),
  );
  return {
    sheetsYm,
    paused: list?.sync?.paused === true,
    jobs: ((list?.jobs as SheetJob[]) ?? []).filter((j) => j.id),
    closed,
  };
}

export function MonthCloseChip({ homeYm }: { homeYm: string }) {
  const [state, setState] = useState<ChipState | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [catchUp, setCatchUp] = useState(false);

  const load = useCallback(() => {
    setErr("");
    readChip()
      .then(setState)
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't read the tracking sheets."));
  }, []);
  useEffect(load, [load]);

  if (err) return <span className="text-[12px] text-danger">Tracking sheets: {err}</span>;
  if (!state) return null;

  const behind = sheetsCatchUp(state.sheetsYm, homeYm);
  const p = closeProgress(state.jobs.map((j) => j.id), state.closed);
  const name = shortMonth(state.sheetsYm).replace(/ '\d\d$/, "");

  return (
    <>
      {behind ? (
        <button
          type="button"
          onClick={() => setCatchUp(true)}
          className={btn("ghost", "xs", "min-h-8 text-warn")}
        >
          Tracking sheets on {name} · set to {shortMonth(behind).replace(/ '\d\d$/, "")}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={btn("ghost", "xs", "min-h-8")}>
          {p.done ? `${name}: closed` : `${name}: ${p.closed} of ${p.total} closed`}
        </button>
      )}
      {behind && catchUp && (
        <CatchUpDialog
          from={state.sheetsYm}
          to={behind}
          paused={state.paused}
          onClose={() => setCatchUp(false)}
          onDone={() => {
            setCatchUp(false);
            load();
          }}
        />
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={`Close ${shortMonth(state.sheetsYm)}`}>
        {open && <MonthClosePanel ym={state.sheetsYm} jobs={state.jobs} />}
      </Sheet>
    </>
  );
}

/** One-time: move a stored sheets' month that fell behind. setPeriod stores the month; it writes no sheet. */
function CatchUpDialog({
  from,
  to,
  paused,
  onClose,
  onDone,
}: {
  from: string;
  to: string;
  paused: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true);
    setErr("");
    const [year, month] = to.split("-").map(Number);
    const r = await fetch("/api/tracking-sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "setPeriod", month, year }),
    }).catch(() => null);
    const b = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (!r || !r.ok || b?.error) return setErr(String(b?.error ?? "Couldn't set the month. Try again."));
    onDone();
  };
  return (
    <Dialog
      busy={busy}
      onClose={onClose}
      title={`Set the tracking sheets to ${shortMonth(to)}?`}
      description={`The stored month is ${shortMonth(from)}. The sheets show ${shortMonth(to)} figures. After this, only the month close moves it.`}
      footer={
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="secondary" className="min-h-11 w-full" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="min-h-11 w-full" onClick={run} disabled={busy}>
            {busy ? "Setting…" : `Set to ${shortMonth(to)}`}
          </Button>
        </div>
      }
    >
      <p className={`text-sm ${paused ? "text-neutral-500 dark:text-neutral-400" : "text-warn"}`}>
        {paused
          ? "The automatic sync is paused, so this writes nothing to any sheet."
          : `The automatic sync is running. Its next run rewrites every sheet's CURRENT INVOICE with ${shortMonth(to)} bills.`}
      </p>
      {err && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {err}
        </p>
      )}
    </Dialog>
  );
}

const ACTION_CHIP: Record<MonthCloseRow["plan"]["action"], { tone: "info" | "success" | "danger"; text: string }> = {
  copy: { tone: "info", text: "Will file" },
  filed: { tone: "success", text: "Filed" },
  skip: { tone: "danger", text: "Skipped" },
};

/** The preview: what the close would do on every sheet, or on one. Writes nothing. */
export function MonthClosePanel({ ym, jobs }: { ym: string; jobs: SheetJob[] }) {
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<MonthClosePreview | null>(null);

  const run = async () => {
    setBusy(true);
    setErr("");
    setPreview(null);
    const q = new URLSearchParams({ ym, ...(projectId ? { projectId } : {}) });
    const r = await fetch(`/api/month-close?${q}`, { cache: "no-store" }).catch(() => null);
    const b = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (!r || !r.ok || !b || b.error) return setErr(String(b?.error ?? "The preview failed. Try again."));
    setPreview(b as MonthClosePreview);
  };

  const counts = preview
    ? (["copy", "filed", "skip"] as const).map((a) => preview.rows.filter((r) => r.plan.action === a).length)
    : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        The preview reads each sheet and writes nothing. Each job closes from its own Close month. A
        sheet&apos;s close refreshes its bills from JobTread, then files CURRENT INVOICE as &ldquo;{recordsLabel(ym)}
        &rdquo;.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Which sheet to preview"
          className="min-h-11 min-w-0 flex-1"
        >
          <option value="">Every sheet ({jobs.length})</option>
          {[...jobs]
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
        </Select>
        <Button className="min-h-11" onClick={run} disabled={busy}>
          {busy ? "Reading the sheets…" : "Preview"}
        </Button>
      </div>
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      {preview && counts && (
        <>
          <MetaLine
            items={[
              `${counts[0]} to file`,
              `${counts[1]} filed`,
              `${counts[2]} skipped`,
              preview.paused ? "Automatic sync paused" : "Automatic sync running",
            ]}
          />
          <Card pad={false} className="divide-y divide-line-soft overflow-hidden">
            {preview.rows.map((r) => (
              <PreviewRow key={r.projectId} row={r} />
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function PreviewRow({ row }: { row: MonthCloseRow }) {
  const chip = ACTION_CHIP[row.plan.action];
  const billsOff = row.sheet && row.jt && Math.abs(row.sheet.bills - row.jt.bills) >= 0.01;
  const hoursOff = row.sheet && row.jt && Math.abs(row.sheet.laborHours - row.jt.laborHours) >= 0.01;
  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <a href={row.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold hover:underline">
          {row.label} ↗
        </a>
        <Chip tone={chip.tone}>{chip.text}</Chip>
      </div>
      {row.block && row.plan.action !== "skip" && (
        <p className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
          Block &ldquo;{row.block.label}&rdquo; · {row.block.range}
          {row.block.blocksRemaining !== null ? ` · ${row.block.blocksRemaining} free after` : ""}
        </p>
      )}
      {(row.sheet || row.jt) && (
        <dl className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-0.5 text-[12px] tabular-nums">
          <dt className="text-neutral-500 dark:text-neutral-400" />
          <dt className="text-neutral-500 dark:text-neutral-400">Sheet now</dt>
          <dt className="text-neutral-500 dark:text-neutral-400">JobTread</dt>
          <dt>Bills</dt>
          <dd>{row.sheet ? money(row.sheet.bills) : "—"}</dd>
          <dd className={billsOff ? "text-warn" : ""}>{row.jt ? money(row.jt.bills) : "—"}</dd>
          <dt>Labor hours</dt>
          <dd className={hoursOff ? "text-warn" : ""}>{row.sheet ? row.sheet.laborHours : "—"}</dd>
          <dd className={hoursOff ? "text-warn" : ""}>{row.jt ? row.jt.laborHours : "—"}</dd>
          <dt>Labor on sheet</dt>
          <dd>{row.sheet ? money(row.sheet.laborCost) : "—"}</dd>
          <dd />
        </dl>
      )}
      <ul className="mt-1.5 space-y-0.5 text-[12px]">
        {row.plan.reasons.map((r) => (
          <li key={r} className={row.plan.action === "skip" ? "text-danger" : "text-neutral-500 dark:text-neutral-400"}>
            {r}
          </li>
        ))}
        {row.plan.action === "copy" && billsOff && (
          <li className="text-neutral-500 dark:text-neutral-400">The close refreshes the sheet&apos;s bills to JobTread&apos;s first.</li>
        )}
        {row.plan.action === "copy" && hoursOff && (
          <li className="text-warn">
            Labor hours differ from JobTread. Re-run the month&apos;s Labor Report before you close, or close as it stands.
          </li>
        )}
        {row.jt && row.jt.unapprovedHours > 0 && (
          <li className="text-warn">{row.jt.unapprovedHours} hours in JobTread are not approved yet.</li>
        )}
        {row.jt && row.jt.uncoded > 0 && (
          <li className="text-warn">
            {row.jt.uncoded} JobTread line{row.jt.uncoded === 1 ? " has" : "s have"} no cost code and will not reach the sheet.
          </li>
        )}
        {row.closedAt && (
          <li className="text-neutral-500 dark:text-neutral-400">
            Filed {new Date(row.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.
          </li>
        )}
      </ul>
    </div>
  );
}
