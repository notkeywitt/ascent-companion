"use client";

import { useEffect, useState } from "react";

import { Banner, Button, Card, Chip, CountBadge, Input, Loading, PageHeader, type ChipTone } from "@/components/ui";
import {
  attentionCount,
  daysUntil,
  renewalStatus,
  rollYear,
  sortRenewals,
  type Renewal,
  type RenewalStatus,
} from "@/lib/renewals";

const TONE: Record<RenewalStatus, ChipTone> = { overdue: "danger", soon: "warning", ok: "success", none: "neutral" };
const LABEL: Record<RenewalStatus, string> = { overdue: "Overdue", soon: "Due soon", ok: "OK", none: "No date" };

export function Renewals() {
  const [list, setList] = useState<Renewal[] | null>(null);
  const [error, setError] = useState("");
  const today = new Date().toLocaleDateString("en-CA");

  useEffect(() => {
    fetch("/api/renewals")
      .then((r) => r.json())
      .then((j) => setList(j.renewals))
      .catch(() => setError("Could not load renewals."));
  }, []);

  async function save(next: Renewal[]) {
    setList(next);
    setError("");
    const r = await fetch("/api/renewals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ renewals: next }),
    });
    if (!r.ok) setError("Save failed. Reload and try again.");
  }
  const patch = (id: string, p: Partial<Renewal>) => save((list ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)));

  if (!list) return error ? <Banner tone="error">{error}</Banner> : <Loading />;
  const n = attentionCount(list, today);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Renewals"
        description="Company renewals and their due dates."
        actions={n > 0 ? <CountBadge n={n} /> : undefined}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {n > 0 && (
        <Banner tone="warning">
          {n} renewal{n === 1 ? " is" : "s are"} overdue or due soon.
        </Banner>
      )}
      <div className="space-y-3">
        {sortRenewals(list).map((r) => {
          const st = renewalStatus(r, today);
          const d = r.due ? daysUntil(r.due, today) : 0;
          return (
            <Card key={r.id + r.due} className="grid gap-3 pad:grid-cols-[minmax(0,1.4fr)_auto_auto_minmax(0,1.6fr)_auto] pad:items-center">
              <div className="min-w-0">
                <Input defaultValue={r.name} aria-label="Name" onBlur={(e) => e.target.value !== r.name && patch(r.id, { name: e.target.value })} />
                <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                  <Chip tone={TONE[st]}>{LABEL[st]}</Chip>
                  {r.due && <span>{d < 0 ? `${-d} days ago` : d === 0 ? "today" : `in ${d} days`}</span>}
                  {r.link && (
                    <a href={r.link} target="_blank" rel="noreferrer" className="underline">
                      Link
                    </a>
                  )}
                </div>
              </div>
              <label className="text-xs text-neutral-500">
                Due
                <Input type="date" defaultValue={r.due} onBlur={(e) => e.target.value !== r.due && patch(r.id, { due: e.target.value })} />
              </label>
              <label className="text-xs text-neutral-500">
                Warn days
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  defaultValue={r.warnDays}
                  onBlur={(e) => Number(e.target.value) !== r.warnDays && patch(r.id, { warnDays: Number(e.target.value) })}
                />
              </label>
              <div className="grid gap-2">
                <Input placeholder="Notes" defaultValue={r.notes} onBlur={(e) => e.target.value !== r.notes && patch(r.id, { notes: e.target.value })} />
                <Input placeholder="Link (https://…)" defaultValue={r.link} onBlur={(e) => e.target.value !== r.link && patch(r.id, { link: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!r.due} onClick={() => patch(r.id, { due: rollYear(r.due) })}>
                  Renewed
                </Button>
                <Button size="sm" variant="ghost" onClick={() => confirm(`Remove ${r.name}?`) && save(list.filter((x) => x.id !== r.id))}>
                  Remove
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      <Button variant="secondary" onClick={() => save([...list, { id: `r-${Date.now()}`, name: "New renewal", due: "", warnDays: 30, notes: "", link: "" }])}>
        Add renewal
      </Button>
    </div>
  );
}
