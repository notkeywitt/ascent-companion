"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Banner, Loading, Toggle } from "@/components/ui";
import { CustomerPanel } from "./CustomerPanel";
import type { ClientDirectory, DirectoryJob } from "./types";

/**
 * A job's customer in a pop-up card — the Jobs page's customer name opens it
 * (owner, 2026-11-02). The record is the Clients page's CustomerPanel, so the
 * two cannot disagree. It opens read-only; the Editable switch turns the
 * inputs and Save buttons on. Every save is CustomerPanel's own.
 *
 * The directory read maps the job to its customer and lists the customer's
 * jobs. Picking one of them hands it to `onOpenJob`.
 */
export function CustomerPopup({
  jobId,
  onClose,
  onOpenJob,
}: {
  jobId: string;
  onClose: () => void;
  onOpenJob?: (jobId: string) => void;
}) {
  const [found, setFound] = useState<{ accountId: string; jobs: DirectoryJob[] } | null>(null);
  const [error, setError] = useState("");
  const [editable, setEditable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d: ClientDirectory & { error?: string }) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        const owner = (d.customers ?? []).find((c) => c.jobs.some((j) => j.id === jobId));
        if (!owner) throw new Error("This job has no customer in JobTread.");
        setFound({ accountId: owner.id, jobs: owner.jobs });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network error");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <Dialog onClose={onClose} label="Customer" size="lg">
      <div className="mb-4 flex justify-end">
        <Toggle checked={editable} onChange={setEditable} label="Editable" />
      </div>
      {error ? (
        <Banner tone="error">{error}</Banner>
      ) : !found ? (
        <Loading label="Loading the customer…" />
      ) : (
        <CustomerPanel
          accountId={found.accountId}
          jobs={found.jobs}
          locked={!editable}
          onOpenJob={(id) => {
            onClose();
            onOpenJob?.(id);
          }}
        />
      )}
    </Dialog>
  );
}
