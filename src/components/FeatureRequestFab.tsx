"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAccess } from "@/components/AccessProvider";
import { useUsed } from "@/components/HomeActions";
import { toast } from "@/components/Toast";

/**
 * Admin's Feature Request circle (owner, 2026-11-14), on every page
 * (owner, 2026-11-21). It opens the request form in a sheet. Mounted once in
 * `app/layout.tsx`. The /requests page has its own form, so the circle hides there.
 */

// Loaded on first use, like the Home sheet it came from.
const Sheet = dynamic(() => import("@/components/Sheet").then((m) => m.Sheet), { ssr: false });
const FeatureRequestForm = dynamic(
  () => import("@/components/FeatureRequestForm").then((m) => m.FeatureRequestForm),
  { ssr: false },
);

export function FeatureRequestFab() {
  const { can, role } = useAccess();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const used = useUsed(open);

  if (role !== "admin" || !can("requests") || path === "/requests") return null;

  return (
    <>
      <button
        type="button"
        aria-label="New feature request"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(var(--tabbar-h)+1rem)] right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg transition hover:bg-accent-hover active:scale-95"
      >
        <RequestMark />
      </button>

      {used && (
        <Sheet open={open} onClose={() => setOpen(false)} title="New feature request">
          {open && (
            <FeatureRequestForm
              onDone={() => {
                setOpen(false);
                toast("Request sent");
              }}
            />
          )}
          <Link
            href="/requests"
            onClick={() => setOpen(false)}
            className="mt-3 block min-h-11 py-2 text-[12px] font-semibold text-accent"
          >
            See all requests
          </Link>
        </Sheet>
      )}
    </>
  );
}

/** A speech bubble with a plus — ask for a feature. */
function RequestMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      <path d="M12 9v6M9 12h6" />
    </svg>
  );
}
