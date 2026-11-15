"use client";

import { useState } from "react";

import type { Option } from "@/components/CostCodeSelect";
import { Banner, Button } from "@/components/ui";
import { toast } from "@/components/Toast";
import type { TimeEntryEdit } from "@/lib/codingDraft";
import { TimeCodingCard, type TimeEntryRow } from "@/app/trackingsheet/TimeCodingCard";

type Patch = TimeEntryEdit & { costItemId?: string };

/**
 * The Labor page's edit panel: the Tracking Sheet's own TimeCodingCard, with a
 * Save of its own. The card stages as you edit (the board saves them in one
 * go); here the staged patch is written at once by POST /api/time-entry, the
 * route the board's Save calls for a time entry. Key it on the entry id.
 */
export function EntryPanel({
  entry,
  jobId,
  codeOptions,
  writes,
  onSaved,
  onClose,
}: {
  entry: TimeEntryRow;
  jobId: string;
  codeOptions: Option[];
  writes: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [patch, setPatch] = useState<Patch>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = Object.keys(patch).length > 0;

  async function save() {
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/time-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, ...patch }),
      });
      const b = await r.json();
      if (b.error) setError(b.error);
      else if (b.previewed) setError(b.message);
      else {
        toast("Saved in JobTread.");
        onSaved();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <TimeCodingCard
        entry={entry}
        jobId={jobId}
        codeOptions={codeOptions}
        writes={writes}
        staged={patch}
        stagedLeafId={patch.costItemId}
        onStage={setPatch}
        onSaved={onSaved}
        onClose={onClose}
      />
      {error && (
        <Banner tone="error" className="!py-1.5 !text-[11px]">
          {error}
        </Banner>
      )}
      <Button className="w-full" onClick={() => void save()} disabled={!writes || !dirty || saving}>
        {saving ? "Saving…" : "Save to JobTread"}
      </Button>
    </div>
  );
}
