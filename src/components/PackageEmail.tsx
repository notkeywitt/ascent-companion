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
      title="Add a note to each job, then save the Invoicing Package email as a Gmail draft with each job's tracking sheet and JobTread invoice attached as PDFs. Pressed again, it replaces this month's draft with the latest."
    >
      {email.running ? "Drafting email…" : email.done ? "Update invoicing email" : "Draft invoicing email"}
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
  note: string;
}

/**
 * The card that opens before the email is drafted: one text box per job in the
 * email. A note is the line under that job in the email, and it is the same
 * note the job's "Edit for the email" panel holds — saved to the month's sheet,
 * so it stays for the next edit and the next draft. Each box saves on blur;
 * "Draft email" waits for every save to land first, because Apps Script reads
 * the notes when it builds the draft.
 */
export function PackageEmailNotes({
  jobs,
  running,
  onPatch,
  onSave,
  onDraft,
  onClose,
}: {
  jobs: NoteJob[];
  running: boolean;
  onPatch: (jobId: string, note: string) => void;
  /** Saves one job's note; resolves false when the save failed. */
  onSave: (jobId: string, note: string) => Promise<boolean>;
  onDraft: () => Promise<void> | void;
  onClose: () => void;
}) {
  const pending = useRef(new Set<Promise<boolean>>());
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const saveNote = (jobId: string, note: string) => {
    const p = onSave(jobId, note);
    pending.current.add(p);
    void p.finally(() => pending.current.delete(p));
  };

  const draft = async () => {
    setBusy(true);
    setFailed(false);
    const results = await Promise.all([...pending.current]);
    if (results.includes(false)) {
      setFailed(true);
      setBusy(false);
      return;
    }
    await onDraft();
    setBusy(false);
  };

  // Invoiced jobs first, the order the email lists them in.
  const ordered = [...jobs.filter((j) => j.invoiceNumber), ...jobs.filter((j) => !j.invoiceNumber)];

  return (
    <Dialog
      onClose={onClose}
      busy={busy || running}
      size="lg"
      title="Notes for the invoicing email"
      description="A note prints as the last line under its job. Leave a box empty for no note. Notes stay saved."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy || running}>
            Cancel
          </Button>
          <Button onClick={draft} disabled={busy || running}>
            {busy || running ? "Drafting email…" : "Draft email"}
          </Button>
        </>
      }
    >
      {failed && (
        <Banner tone="error" className="mb-3">
          A note did not save. Fix it and press Draft email again.
        </Banner>
      )}
      {ordered.length === 0 && <p className="text-[13px] text-neutral-500">No jobs are included this month.</p>}
      <div className="space-y-3">
        {ordered.map((j) => (
          <label key={j.jtJobId} className="block">
            <span className="text-[13px] font-semibold">
              {j.jobLabel} - {j.customerLabel}
              {j.invoiceNumber ? <span className="font-normal text-neutral-500"> · invoice #{j.invoiceNumber}</span> : null}
            </span>
            <Textarea
              rows={2}
              value={j.note}
              placeholder="Note"
              onChange={(e) => onPatch(j.jtJobId, e.target.value)}
              onBlur={(e) => saveNote(j.jtJobId, e.target.value)}
            />
          </label>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * "Draft Email" on its own — the same action as Invoice Status's button, for a
 * page that does not hold the month's job list. It reads the month, opens the
 * notes card, saves each note, then drafts. Renders nothing without the
 * "invoicing-summary" view.
 */
export function DraftInvoicingEmail({ ym, className }: { ym: string; className?: string }) {
  const { can } = useAccess();
  const email = usePackageEmail(ym);
  const [jobs, setJobs] = useState<NoteJob[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  if (!can("invoicing-summary")) return null;

  const open = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/invoicing-summary?ym=${encodeURIComponent(ym)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setJobs(((body.jobs ?? []) as (NoteJob & { include: boolean })[]).filter((j) => j.include));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not read the month.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <Button
        variant="secondary"
        className="min-h-11"
        onClick={open}
        disabled={email.running || loading || !ym}
        title="Add a note to each job, then save the Invoicing Package email as a Gmail draft with each job's tracking sheet and JobTread invoice attached as PDFs."
      >
        {email.running || loading ? "Drafting email…" : email.done ? "Update Email" : "Draft Email"}
      </Button>
      {loadError && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {loadError}
        </p>
      )}
      <PackageEmailResult email={email} />
      {jobs && (
        <PackageEmailNotes
          jobs={jobs}
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
            setJobs(null);
          }}
          onClose={() => setJobs(null)}
        />
      )}
    </div>
  );
}
