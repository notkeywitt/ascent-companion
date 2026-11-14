"use client";

import { useState } from "react";
import { Button, Dialog, btn } from "@/components/ui";
import { JtLink } from "@/components/JtLink";
import { money } from "@/lib/money";

/**
 * "Create draft invoice" — the month's client invoice as a DRAFT in JobTread,
 * built from the same data as the invoice preview (POST /api/invoice-draft).
 * It sits beside the "Create Invoice in JobTread ↗" deep link, which stays.
 * The confirm says plainly that this makes a real document in the live org.
 */
export function InvoiceDraftButton({
  jobId,
  ym,
  month,
  jobTitle,
  writes,
  onCreated,
}: {
  jobId: string;
  ym: string;
  /** "October 2026" — what the confirm calls the month. */
  month: string;
  jobTitle: string;
  writes: boolean;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState<{ url?: string; price: number; previewed?: boolean } | null>(null);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/invoice-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, ym }),
      });
      const j = await res.json();
      if (!res.ok || j?.error) throw new Error(j?.error || `Request failed (${res.status})`);
      setMade({ url: j.url, price: j.price, previewed: j.previewed });
      if (j.wrote) onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setOpen(false);
    setMade(null);
    setError("");
  };

  return (
    <>
      <Button variant="secondary" className="min-h-11" onClick={() => setOpen(true)}>
        Create draft invoice
      </Button>
      {open && (
        <Dialog
          busy={busy}
          onClose={close}
          title={made && !made.previewed ? "Draft invoice created" : "Create a draft invoice?"}
          description={
            <>
              {month}
              {jobTitle ? ` · ${jobTitle}` : ""}. A Monthly Invoice dated the last day of the month, holding
              every approved bill and time entry the preview shows. It stays a draft: review and send it in
              JobTread.
            </>
          }
          footer={
            made && !made.previewed ? (
              <div className="grid w-full grid-cols-2 gap-2">
                <Button variant="secondary" className="min-h-11 w-full" onClick={close}>
                  Close
                </Button>
                {made.url && (
                  <JtLink href={made.url} className={btn("primary", "md", "min-h-11 w-full")}>
                    Open in JobTread ↗
                  </JtLink>
                )}
              </div>
            ) : (
              <div className="grid w-full grid-cols-2 gap-2">
                <Button variant="secondary" className="min-h-11 w-full" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button className="min-h-11 w-full" onClick={create} disabled={busy}>
                  {busy ? "Creating…" : "Create draft"}
                </Button>
              </div>
            )
          }
        >
          {made && (
            <p className="text-sm">
              {made.previewed ? "Preview only. " : ""}Total before tax:{" "}
              <span className="font-semibold tabular-nums">{money(made.price)}</span>
            </p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          {!made && !error && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              This creates a real document in the live JobTread org.
            </p>
          )}
          {!writes && (
            <p className="mt-2 text-[11px] text-warn">
              Writes are disabled on this deployment — this will preview only.
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}
