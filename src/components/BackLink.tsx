"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "‹ Back" for a page that has no place on the menu (OVERHAUL_PLAN 3.3). It
 * returns to the page the user came from; opened cold (a shared link, a new
 * tab) it goes to `href`, which also keeps open-in-new-tab useful.
 */
export function BackLink({ href, className = "" }: { href: string; className?: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className={`-ml-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-accent transition hover:bg-accent/10 dark:text-accent-soft ${className}`}
    >
      ‹ Back
    </Link>
  );
}
