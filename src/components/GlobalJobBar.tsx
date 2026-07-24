"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { JobPicker } from "@/components/JobPicker";
import { AscentLogo } from "@/components/AscentLogo";
import { useAccess } from "@/components/AccessProvider";
import { btn } from "@/components/ui";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";

// The job picker + Add-bill button live in the sticky chrome at the top of every
// page. The picker writes the chosen job to the URL's ?jobId=, which the
// job-scoped pages (/coding, /unbilled, /stage, /bill, /add-bill) read as their
// source of truth; other pages simply ignore it.
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
    <div className="flex items-center gap-2 px-2 py-2">
      <Link href="/" aria-label="Ascent Assistant home" className="shrink-0">
        {/* Wordmark hidden on narrow / side-panel widths; icon always shows. */}
        <AscentLogo className="hidden sm:inline-flex" />
        <AscentLogo wordmark={false} className="sm:hidden" />
      </Link>
      <div className="min-w-0 flex-1">
        <JobPicker value={jobId} onChange={onChange} />
      </div>
      {/* /add-bill is part of the (admin-only) Coding Review view — without the
          gate the middleware would just bounce a non-admin back to home. */}
      {access.can("coding") && (
        <Link href={addHref} className={btn("primary", "md", "shrink-0")}>
          ＋ Add bill
        </Link>
      )}
    </div>
  );
}
