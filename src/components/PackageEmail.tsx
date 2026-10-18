"use client";

import { useState } from "react";
import { Banner, Button } from "@/components/ui";

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
export function PackageEmailButton({ email, ym }: { email: ReturnType<typeof usePackageEmail>; ym: string }) {
  return (
    <Button
      variant="secondary"
      onClick={email.run}
      disabled={email.running || !ym}
      title="Save the Invoicing Package email as a Gmail draft, each job's tracking sheet and JobTread invoice attached as PDFs. Pressed again, it replaces this month's draft with the latest."
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
