"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { JobPicker } from "@/components/JobPicker";
import { AscentLogo } from "@/components/AscentLogo";
import { useAccess } from "@/components/AccessProvider";
import { SyncNowButton } from "@/components/SyncNowButton";
import { RefreshButton } from "@/components/RefreshButton";
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

  function onChange(id: string) {
    // Programmatic nav (not an anchor click), so ask the unsaved-changes guard
    // before leaving a bill mid-edit.
    if (!confirmLeaveIfDirty()) return;
    // Switching jobs from a specific bill returns to that job's coding queue —
    // the old bill belongs to the previous job.
    const base = pathname.startsWith("/bill") ? "/coding" : pathname;
    router.replace(`${base}?jobId=${encodeURIComponent(id)}`);
  }

  const addHref = jobId ? `/add-bill?jobId=${encodeURIComponent(jobId)}` : "/add-bill";

  return (
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
        <JobPicker value={jobId} onChange={onChange} showPhaseFilter />
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
      {access.can("sync") && <SyncNowButton />}
      {/* Ungated — reloading the current page's data is read-only and useful to
          everyone, unlike Sync (which drives the backend mirror). */}
      <RefreshButton />
      <ThemeToggle />
    </div>
  );
}
