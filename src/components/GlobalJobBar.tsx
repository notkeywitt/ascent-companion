"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { JobPicker, jobAddress, type JobRef } from "@/components/JobPicker";
import { AscentLogo } from "@/components/AscentLogo";
import { useAccess } from "@/components/AccessProvider";
import { SyncNowButton } from "@/components/SyncNowButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { btn } from "@/components/ui";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";

// The app's entire top chrome, on one line: home logo, job picker, Add bill,
// Sync, theme. The picker writes the chosen job to the URL's ?jobId=, which the
// job-scoped pages (/coding, /unbilled, /stage, /bill, /add-bill) read as their
// source of truth; other pages simply ignore it. Everything but the logo and
// picker is view-gated, so a field user sees just picker + theme.
export function GlobalJobBar() {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const access = useAccess();
  const jobId = search.get("jobId") ?? "";
  // The resolved job behind ?jobId, so the header can show WHERE it is. The
  // picker resolves this itself and reports it via onResolved — including on
  // mount, when the id comes from the URL and nobody has "picked" anything.
  const [job, setJob] = useState<JobRef | null>(null);

  function onChange(id: string) {
    // Programmatic nav (not an anchor click), so ask the unsaved-changes guard
    // before leaving a bill mid-edit.
    if (!confirmLeaveIfDirty()) return;
    // Picking a job from the launcher means "work this job" — the home page has
    // nothing job-scoped to show, so go straight to Client Invoicing. It's a
    // real move to another page, so push (back returns to the launcher) rather
    // than the in-place replace used when switching jobs on a job-scoped page.
    if (pathname === "/" && access.can("recode")) {
      router.push(`/recode?jobId=${encodeURIComponent(id)}`);
      return;
    }
    // Switching jobs from a specific bill returns to Client Invoicing on the new
    // job — the old bill belongs to the previous job.
    const base = pathname.startsWith("/bill") ? "/recode" : pathname;
    router.replace(`${base}?jobId=${encodeURIComponent(id)}`);
  }

  const addHref = jobId ? `/add-bill?jobId=${encodeURIComponent(jobId)}` : "/add-bill";

  const address = job ? jobAddress(job) : "";

  return (
    <>
    <div className="flex items-center gap-1.5 px-2 py-2 sm:gap-2">
      <Link
        href="/"
        aria-label="Ascent Assistant home"
        className="relative shrink-0 rounded-lg p-1 transition active:bg-accent/10"
      >
        {/* Wordmark hidden on narrow / side-panel widths; icon always shows. */}
        <AscentLogo className="hidden sm:inline-flex" />
        <AscentLogo wordmark={false} className="sm:hidden" />
        {/* Tapping the logo navigates home — show a spinner over it while that
            load is in flight so the tap visibly registers. */}
        <LinkPendingOverlay spinnerClassName="h-5 w-5" />
      </Link>
      {/* The only flexible item — it absorbs whatever the buttons leave. */}
      <div className="min-w-0 flex-1">
        <JobPicker value={jobId} onChange={onChange} onResolved={setJob} showPhaseFilter />
      </div>
      {/* /add-bill is part of the (admin-only) Coding Review view — without the
          gate the middleware would just bounce a non-admin back to home. */}
      {access.can("coding") && (
        <Link
          href={addHref}
          className={btn("primary", "md", "relative shrink-0 whitespace-nowrap")}
        >
          ＋ Add bill
          <LinkPendingOverlay spinnerClassName="h-4 w-4" />
        </Link>
      )}
      {/* Gated — this one drives the backend mirror, not a local reload. It
          takes the Refresh button's old slot: a manual kick of the JT →
          Sheets/Drive full sync is what's actually wanted from the top bar. */}
      {access.can("sync") && <SyncNowButton />}
      <ThemeToggle />
    </div>
    {/* Where the selected job IS, on its own line under the picker.
        The picker can only ever show a truncated "Customer - Job" on a phone,
        and the address was previously repeated by individual pages (the recode
        board printed its own copy above the title). Carrying it in the chrome
        means every job-scoped page gets it, in one place, and none of them has
        to spend a line on it. Self-hiding: no job selected, or a job with no
        address on file, and the header stays exactly as it was. */}
    {address && (
      <p className="truncate px-3 pb-1.5 text-xs text-neutral-500 dark:text-neutral-400">
        {address}
      </p>
    )}
    </>
  );
}
