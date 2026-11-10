"use client";

import { useRef, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { Banner, Button, Dialog, Textarea } from "@/components/ui";

/**
 * "Draft invoicing email" — POST /api/invoicing-summary/email, which saves the
 * month's Invoicing Package email as a Gmail draft with each job's tracking
 * sheet and JobTread invoice attached. A second run replaces that month's draft with the latest,
 * overwriting edits made in Gmail. One run at a time; the result stays until
 * the next run.
 */
export function usePackageEmail(ym: string) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{
    draftUrl: string;
    updated: boolean;
    attached: number;
    expected: number;
    warnings: string[];
  } | null>(null);

  const run = async () => {
    setRunning(true);
    setError("");
    setDone(null);
    try {
      const res = await fetch("/api/invoicing-summary/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ym }),
      });
      const j = await res.json();
      if (!res.ok || j.error) setError(j.error || `HTTP ${res.status}`);
      else setDone(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  };

  return { run, running, error, done };
}

/** The button, on the Package tab's action bar (moved from Tracking Sheets'
 *  all-jobs row 2026-10-18, so the package and its email sit together). */
export function PackageEmailButton({
  email,
  ym,
  onOpen,
}: {
  email: ReturnType<typeof usePackageEmail>;
  ym: string;
  /** Opens the notes card; the card's own button runs the draft. */
  onOpen: () => void;
}) {
  return (
    <Button
      variant="secondary"
      onClick={onOpen}
      disabled={email.running || !ym}
      title="Opens the notes for each job. Save the notes, or draft the Invoicing Package email as a Gmail draft with each job's tracking sheet and JobTread invoice attached as PDFs. A new draft replaces this month's draft."
    >
      {email.running ? "Drafting email…" : "Invoicing email"}
    </Button>
  );
}

export function PackageEmailResult({ email }: { email: ReturnType<typeof usePackageEmail> }) {
  if (!email.error && !email.done) return null;
  return (
    <div className="mb-3">
      {email.error && (
        <Banner tone="error" className="">
          Invoicing email: {email.error}
        </Banner>
      )}
      {email.done && (
        <Banner tone={email.done.warnings.length ? "warning" : "success"} className="">
          <a href={email.done.draftUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
            Open the draft in Gmail ↗
          </a>{" "}
          · {email.done.updated ? "Updated this month's draft with the latest" : "New draft"} ·{" "}
          {email.done.attached} of {email.done.expected} PDFs attached (tracking sheets and JobTread invoices).
          Nothing is sent until you send it.
          {email.done.warnings.map((w) => (
            <div key={w} className="mt-1 text-[12px]">
              {w}
            </div>
          ))}
        </Banner>
      )}
    </div>
  );
}

export interface NoteJob {
  jtJobId: string;
  jobLabel: string;
  customerLabel: string;
  invoiceNumber: string;
  /** Every invoice for the month (a $0 warranty record can sit beside the
   *  normal one). Absent on an older payload; `invoiceNumber` stands in. */
  invoices?: { number: string; warranty?: boolean }[];
  note: string;
}

/** "invoice #134 + warranty #130", or the primary's number on an older payload. */
function invoiceLabel(j: NoteJob): string {
  const list = j.invoices?.length ? j.invoices : j.invoiceNumber ? [{ number: j.invoiceNumber }] : [];
  return list
    .map((i) => `${"warranty" in i && i.warranty ? "warranty" : "invoice"} #${i.number}`)
    .join(" + ");
}

/**
 * The notes card: one text box per job in the email. A note is the line under
 * that job in the email, and it is the same note the job's "Edit for the email"
 * panel holds — saved to the month's sheet, so it stays for the next edit and
 * the next draft. Each box saves on blur. "Save" waits for every save to land,
 * then closes. "Draft email" waits the same way first, because Apps Script
 * reads the notes when it builds the draft. `jobs` is null while the caller
 * still reads the month, so the card opens at once.
 */
export function PackageEmailNotes({
  jobs,
  running,
  onPatch,
  onSave,
  onDraft,
  onClose,
  loadError,
}: {
  jobs: NoteJob[] | null;
  running: boolean;
  /** Set when the caller could not read the month's jobs. */
  loadError?: string;
  onPatch: (jobId: string, note: string) => void;
  /** Saves one job's note; resolves false when the save failed. */
  onSave: (jobId: string, note: string) => Promise<boolean>;
  onDraft: () => Promise<void> | void;
  onClose: () => void;
}) {
  const pending = useRef(new Set<Promise<boolean>>());
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "draft">("");

  const saveNote = (jobId: string, note: string) => {
    const p = onSave(jobId, note);
    pending.current.add(p);
    void p.finally(() => pending.current.delete(p));
  };

  /** Waits for every note save in flight; false when one failed. */
  const settle = async (kind: "save" | "draft") => {
    setBusy(kind);
    setFailed(false);
    const results = await Promise.all([...pending.current]);
    if (results.includes(false)) {
      setFailed(true);
      setBusy("");
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!(await settle("save"))) return;
    setBusy("");
    onClose();
  };

  const draft = async () => {
    if (!(await settle("draft"))) return;
    await onDraft();
    setBusy("");
  };

  const locked = !!busy || running;
  const ready = jobs !== null;

  // Invoiced jobs first, the order the email lists them in.
  const ordered = jobs ? [...jobs.filter((j) => invoiceLabel(j)), ...jobs.filter((j) => !invoiceLabel(j))] : [];

  return (
    <Dialog
      onClose={onClose}
      busy={locked}
      size="lg"
      title="Notes for the invoicing email"
      description="A note prints as the last line under its job. Leave a box empty for no note. Save keeps the notes without drafting."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={locked}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={save} disabled={locked || !ready}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button onClick={draft} disabled={locked || !ready}>
            {busy === "draft" || running ? "Drafting email…" : "Draft email"}
          </Button>
        </>
      }
    >
      {failed && (
        <Banner tone="error" className="mb-3">
          A note did not save. Fix it and press Save or Draft email again.
        </Banner>
      )}
      {loadError && (
        <Banner tone="error" className="mb-3">
          {loadError}
        </Banner>
      )}
      {!ready && !loadError && <p className="text-[13px] text-neutral-500">Loading the month&apos;s jobs…</p>}
      {ready && ordered.length === 0 && (
        <p className="text-[13px] text-neutral-500">No jobs are included this month.</p>
      )}
      <div className="space-y-3">
        {ordered.map((j) => (
          <label key={j.jtJobId} className="block">
            <span className="text-[13px] font-semibold">
              {j.jobLabel} - {j.customerLabel}
              {invoiceLabel(j) ? <span className="font-normal text-neutral-500"> · {invoiceLabel(j)}</span> : null}
            </span>
            <Textarea
              rows={2}
              value={j.note}
              placeholder="Note"
              onChange={(e) => onPatch(j.jtJobId, e.target.value)}
              onBlur={(e) => saveNote(j.jtJobId, e.target.value)}
              disabled={locked}
            />
          </label>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * "Invoicing email" on its own — the same action as Invoice Status's button,
 * for a page that does not hold the month's job list. It opens the notes card
 * at once and reads the month inside it. Renders nothing without the
 * "invoicing-summary" view.
 */
export function DraftInvoicingEmail({ ym, className }: { ym: string; className?: string }) {
  const { can } = useAccess();
  const email = usePackageEmail(ym);
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<NoteJob[] | null>(null);
  const [loadError, setLoadError] = useState("");

  if (!can("invoicing-summary")) return null;

  const close = () => {
    setOpen(false);
    setJobs(null);
  };

  const show = async () => {
    setOpen(true);
    setJobs(null);
    setLoadError("");
    try {
      const res = await fetch(`/api/invoicing-summary?ym=${encodeURIComponent(ym)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setJobs(((body.jobs ?? []) as (NoteJob & { include: boolean })[]).filter((j) => j.include));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not read the month.");
    }
  };

  return (
    <div className={className}>
      <Button
        variant="secondary"
        className="min-h-11"
        onClick={() => void show()}
        disabled={email.running || !ym}
        title="Opens the notes for each job. Save the notes, or draft the Invoicing Package email as a Gmail draft with each job's tracking sheet and JobTread invoice attached as PDFs."
      >
        {email.running ? "Drafting email…" : "Invoicing Email"}
      </Button>
      <PackageEmailResult email={email} />
      {open && (
        <PackageEmailNotes
          jobs={jobs}
          loadError={loadError}
          running={email.running}
          onPatch={(id, note) => setJobs((js) => js && js.map((j) => (j.jtJobId === id ? { ...j, note } : j)))}
          onSave={async (id, note) => {
            try {
              const res = await fetch("/api/invoicing-summary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ op: "save", ym, jobId: id, note }),
              });
              return res.ok;
            } catch {
              return false;
            }
          }}
          onDraft={async () => {
            await email.run();
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
