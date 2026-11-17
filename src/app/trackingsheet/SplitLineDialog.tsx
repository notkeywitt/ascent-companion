"use client";

import { useState } from "react";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { Banner, Button, Dialog, Input, Label } from "@/components/ui";
import { money } from "@/lib/money";
import { splitCents, toCents } from "@/lib/splitLine";

/**
 * SPLIT ONE BILL LINE INTO TWO, side by side — the bill-line twin of
 * SplitTimeDialog. The two amounts always add up to the original: the amount
 * box on either side sets that side and the other takes the rest
 * (lib/splitLine.ts).
 *
 * Writes nothing itself. `onConfirm` hands the host both halves and the card
 * STAGES them behind Save Changes: the original line is edited in place and the
 * second half is a staged add (the same two paths the line editor and Add line
 * use), so the one save rule holds.
 */
export interface SplitHalf {
  name: string;
  leafId: string;
  /** Pre-tax dollars. */
  amount: number;
}

function Side({
  title,
  name,
  onName,
  leafId,
  onLeaf,
  amount,
  onAmount,
  options,
}: {
  title: string;
  name: string;
  onName: (v: string) => void;
  leafId: string;
  onLeaf: (id: string) => void;
  amount: string;
  onAmount: (v: string) => void;
  options: Option[];
}) {
  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-line-soft p-3">
      <p className="text-sm font-semibold">{title}</p>
      <div>
        <Label>Description</Label>
        <Input value={name} onChange={(e) => onName(e.target.value)} />
      </div>
      <div>
        <Label>Cost code</Label>
        <CostCodeSelect options={options} value={leafId} onChange={onLeaf} />
      </div>
      <div>
        <Label>Amount</Label>
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          className="tabular-nums"
        />
      </div>
    </div>
  );
}

export function SplitLineDialog({
  name,
  total,
  leafId,
  codeOptions,
  onClose,
  onConfirm,
}: {
  name: string;
  /** The line's pre-tax amount now. */
  total: number;
  leafId: string;
  codeOptions: Option[];
  onClose: () => void;
  onConfirm: (first: SplitHalf, second: SplitHalf) => void;
}) {
  const totalCents = Math.round(total * 100);
  const [firstCents, setFirstCents] = useState(Math.floor(totalCents / 2));
  const [a, setA] = useState({ name, leafId });
  const [b, setB] = useState({ name, leafId });

  const parts = splitCents(totalCents, firstCents);
  const dollars = (c: number) => (c / 100).toFixed(2);
  const setAmount = (isFirst: boolean) => (v: string) => {
    const c = toCents(v);
    if (!Number.isFinite(c)) return;
    setFirstCents(isFirst ? c : totalCents - c);
  };
  const ready = Boolean(parts && a.leafId && b.leafId && a.name.trim() && b.name.trim());

  return (
    <Dialog
      onClose={onClose}
      title="Split this line"
      description={`${money(total)} in total. The two lines always add up to it. Nothing writes until you save.`}
      size="xl"
      footer={
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!ready}
            onClick={() => {
              if (!parts) return;
              onConfirm(
                { name: a.name.trim(), leafId: a.leafId, amount: parts.first / 100 },
                { name: b.name.trim(), leafId: b.leafId, amount: parts.second / 100 },
              );
            }}
          >
            Split
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Side
          title="First line"
          name={a.name}
          onName={(v) => setA({ ...a, name: v })}
          leafId={a.leafId}
          onLeaf={(id) => setA({ ...a, leafId: id })}
          amount={dollars(firstCents)}
          onAmount={setAmount(true)}
          options={codeOptions}
        />
        <Side
          title="Second line"
          name={b.name}
          onName={(v) => setB({ ...b, name: v })}
          leafId={b.leafId}
          onLeaf={(id) => setB({ ...b, leafId: id })}
          amount={dollars(totalCents - firstCents)}
          onAmount={setAmount(false)}
          options={codeOptions}
        />
      </div>
      {!parts && (
        <Banner tone="warning" className="mt-3 !py-1.5 !text-[11px]">
          Each line needs more than $0.00.
        </Banner>
      )}
    </Dialog>
  );
}
