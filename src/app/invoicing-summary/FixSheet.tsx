"use client";

/**
 * The Fix sheet for one finding on an Invoice Status card: what the check tests,
 * what is wrong, every place to look, and — for the two fixes the owner approved
 * on 2026-11-18 — a "Fix it" button.
 *
 *   void-bills   keep one copy of a duplicated bill, void the others
 *                (/api/bill-void; voids, never deletes).
 *   backup-file  ask Apps Script where a stray backup PDF belongs, then move or
 *                quarantine it (/api/backup-fix). Quarantine moves; nothing is trashed.
 *
 * After a fix the job is re-checked, so the finding goes or stays on evidence.
 */

import { useEffect, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { Banner, Button, Chip, Loading, SectionLabel } from "@/components/ui";
import { toast } from "@/components/Toast";
import { hubHref } from "@/lib/hubUrl";
import { laborFocusHref } from "@/app/trackingsheet/findingFocus";
import { money } from "@/lib/money";
import type { Finding } from "@/lib/invoiceReview/types";

type Doc = { label: string; href: string };

/** Every place the finding points at, most direct first, no repeats. */
export function findingDocs(f: Finding, ym: string): Doc[] {
  const out: Doc[] = [];
  if (f.jobId && f.target?.kind === "bill") {
    out.push({ label: "Open the bill", href: hubHref(f.jobId, ym, { bill: f.target.billId }) });
  }
  if (f.jobId && f.target?.kind === "labor") {
    out.push({ label: "Open the labor list", href: laborFocusHref(f.jobId, ym, f.target) });
  }
  // A bill target's sourceLink is the same bill on the board; skip it.
  if (f.sourceLink && f.target?.kind !== "bill" && f.target?.kind !== "labor") {
    out.push({ label: f.sourceLabel ?? "Open", href: f.sourceLink });
  }
  out.push(...(f.docs ?? []));
  if (f.jobId) out.push({ label: "Open the job", href: hubHref(f.jobId, ym) });
  const seen = new Set<string>();
  return out.filter((d) => !seen.has(d.href) && seen.add(d.href));
}

function DocLink({ doc }: { doc: Doc }) {
  const ext = doc.href.startsWith("http");
  return (
    <a
      href={doc.href}
      {...(ext ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline"
    >
      {doc.label}
      {ext ? " ↗" : ""}
    </a>
  );
}

export function FixSheet({
  finding,
  checkTitle,
  checkDescription,
  ym,
  onClose,
  onFixed,
  onOk,
}: {
  finding: Finding | null;
  checkTitle: string;
  checkDescription: string;
  ym: string;
  onClose: () => void;
  /** Re-check the job after a fix. */
  onFixed: () => void;
  /** "It's OK": rule this one finding OK for everyone. Rejects when it did not save. */
  onOk: (f: Finding) => Promise<void>;
}) {
  const f = finding;
  const [okBusy, setOkBusy] = useState(false);
  const [okError, setOkError] = useState("");
  const ok = async (x: Finding) => {
    setOkBusy(true);
    setOkError("");
    try {
      await onOk(x);
    } catch (e) {
      setOkError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setOkBusy(false);
    }
  };
  return (
    <Sheet open={!!f} onClose={onClose} title={f?.title ?? ""}>
      {f && (
        <div className="space-y-4 pb-2 text-sm">
          <div>
            <SectionLabel>{checkTitle}</SectionLabel>
            <p className="mt-1 text-neutral-500">{checkDescription}</p>
          </div>
          <div>
            <SectionLabel>What is wrong</SectionLabel>
            <p className="mt-1 leading-relaxed">{f.detail}</p>
            {f.amount ? <p className="mt-1 tabular-nums text-neutral-500">At stake: {money(f.amount)}</p> : null}
          </div>
          <div>
            <SectionLabel>Where to look</SectionLabel>
            <div className="mt-1 flex flex-col">
              {findingDocs(f, ym).map((d) => (
                <DocLink key={d.href} doc={d} />
              ))}
            </div>
          </div>
          {f.fix?.action === "void-bills" && <VoidCopies key={f.key} fix={f.fix} jobId={f.jobId} ym={ym} onFixed={onFixed} />}
          {f.fix?.action === "backup-file" && <MoveBackup key={f.key} fileId={f.fix.fileId} onFixed={onFixed} />}
          <div className="border-t border-line-soft pt-3">
            <SectionLabel>Or leave it</SectionLabel>
            <Button className="mt-1" variant="secondary" disabled={okBusy} onClick={() => void ok(f)}>
              {okBusy ? "Saving…" : "It's OK"}
            </Button>
            {okError && <p className="mt-1 text-xs text-danger">{okError}</p>}
            <p className="mt-1 text-xs text-neutral-500">
              Hides this one finding for everyone. It covers this finding only: a different finding of the
              same kind still shows. Each person sees it hidden after their next check. Show again brings it back.
            </p>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Keep one copy, void the rest. The office picks which copy stays. */
function VoidCopies({
  fix,
  jobId,
  ym,
  onFixed,
}: {
  fix: Extract<NonNullable<Finding["fix"]>, { action: "void-bills" }>;
  jobId: string;
  ym: string;
  onFixed: () => void;
}) {
  const [keep, setKeep] = useState(fix.keepId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const toVoid = fix.bills.filter((b) => b.id !== keep && !done.includes(b.id));

  const run = async () => {
    setBusy(true);
    setError("");
    for (const b of toVoid) {
      try {
        const res = await fetch("/api/bill-void", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: b.id }),
        });
        const body = await res.json();
        if (!res.ok || body?.error) throw new Error(body?.error || `HTTP ${res.status}`);
        setDone((d) => [...d, b.id]);
      } catch (e) {
        setError(`${b.label}: ${e instanceof Error ? e.message : "the void failed"}`);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    toast(`Voided ${toVoid.length} cop${toVoid.length === 1 ? "y" : "ies"}`);
    onFixed();
  };

  return (
    <div>
      <SectionLabel>Proposed fix</SectionLabel>
      <p className="mt-1">Keep one copy and void the others. A void keeps the bill&apos;s history; nothing is deleted.</p>
      <ul className="mt-2 divide-y divide-line-soft">
        {fix.bills.map((b) => (
          <li key={b.id} className="flex min-h-11 items-center gap-3">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="radio"
                name="keep"
                checked={keep === b.id}
                disabled={busy || done.length > 0}
                onChange={() => setKeep(b.id)}
              />
              <span className="min-w-0 flex-1 truncate">{b.label}</span>
              <span className="text-xs text-neutral-500">{b.status}</span>
            </label>
            {done.includes(b.id) ? (
              <Chip tone="neutral">Voided</Chip>
            ) : keep === b.id ? (
              <Chip tone="success">Keep</Chip>
            ) : (
              <Chip tone="danger">Void</Chip>
            )}
            <a href={hubHref(jobId, ym, { bill: b.id })} className="text-xs font-semibold text-accent hover:underline">
              Open
            </a>
          </li>
        ))}
      </ul>
      {error && <Banner tone="error" className="mt-2">{error}</Banner>}
      <Button className="mt-3" variant="danger" disabled={busy || !toVoid.length} onClick={() => void run()}>
        {busy ? "Voiding…" : toVoid.length ? `Fix it: void ${toVoid.length} cop${toVoid.length === 1 ? "y" : "ies"}` : "Fixed"}
      </Button>
    </div>
  );
}

interface BackupPlan {
  file: { id: string; name: string; url: string };
  current: { path: string; folderUrl: string };
  bill: {
    expId: string;
    docId: string;
    vendor: string;
    job: string;
    amount: number;
    billingMonth: string;
    billingYear: string;
    jtStatus: string;
  } | null;
  proposal: { action: "move" | "quarantine" | "none"; toPath?: string; toFolderUrl?: string; reason: string };
  applied?: { action: string; to: string };
}

/** Where the stray PDF belongs, read live from Apps Script, then the move. */
function MoveBackup({ fileId, onFixed }: { fileId: string; onFixed: () => void }) {
  const [plan, setPlan] = useState<BackupPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/backup-fix?fileId=${encodeURIComponent(fileId)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok || body?.error) throw new Error(body?.error || `HTTP ${r.status}`);
        if (live) setPlan(body);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "The PDF could not be read."));
    return () => {
      live = false;
    };
  }, [fileId]);

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/backup-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      const body = await res.json();
      if (!res.ok || body?.error) throw new Error(body?.error || `HTTP ${res.status}`);
      setPlan(body);
      toast(body.applied?.action === "quarantine" ? "Moved to quarantine" : "PDF moved");
      onFixed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The PDF was not moved.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !plan) return <Banner tone="error">{error}</Banner>;
  if (!plan) return <Loading label="Finding where this PDF belongs…" />;
  const p = plan.proposal;
  const b = plan.bill;

  return (
    <div>
      <SectionLabel>Proposed fix</SectionLabel>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-neutral-500">File</dt>
        <dd className="min-w-0 break-words">{plan.file.name}</dd>
        <dt className="text-neutral-500">Now in</dt>
        <dd className="min-w-0 break-words">
          {plan.current.folderUrl ? (
            <a href={plan.current.folderUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {plan.current.path || "its folder"} ↗
            </a>
          ) : (
            plan.current.path || "—"
          )}
        </dd>
        <dt className="text-neutral-500">Its bill</dt>
        <dd>
          {b
            ? `${b.vendor} · ${b.job} · ${money(b.amount)} · billed ${b.billingMonth}/${b.billingYear}${b.jtStatus ? ` · ${b.jtStatus}` : ""}`
            : "No bill points at this PDF"}
        </dd>
        {p.action !== "none" && p.toPath && (
          <>
            <dt className="text-neutral-500">{p.action === "quarantine" ? "Goes to" : "Belongs in"}</dt>
            <dd className="min-w-0 break-words">
              {p.toFolderUrl ? (
                <a href={p.toFolderUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {p.toPath} ↗
                </a>
              ) : (
                p.toPath
              )}
            </dd>
          </>
        )}
      </dl>
      <p className="mt-2 leading-relaxed">{p.reason}</p>
      {error && <Banner tone="error" className="mt-2">{error}</Banner>}
      {plan.applied ? (
        <Banner tone="success" className="mt-3">
          Done: {plan.applied.to}
        </Banner>
      ) : (
        p.action !== "none" && (
          <Button className="mt-3" disabled={busy} onClick={() => void run()}>
            {busy ? "Moving…" : p.action === "quarantine" ? "Fix it: move to quarantine" : "Fix it: move the PDF"}
          </Button>
        )
      )}
    </div>
  );
}
