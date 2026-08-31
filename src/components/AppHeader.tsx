"use client";

import { usePathname } from "next/navigation";
import { GlobalJobBar } from "@/components/GlobalJobBar";
import { GlobalSearch } from "@/components/GlobalSearch";
import { useAccess } from "@/components/AccessProvider";

/**
 * Sticky top chrome: the job picker row, and under it the app's one search box.
 *
 * The two together are "what am I working on" and "take me to a thing" — the
 * questions you ask before any page can help you, so they belong to the chrome
 * rather than to any one page. Search used to live only on the home launcher
 * (pages + vendors) with a second box on Bill Search (bills + line items); it is
 * now one field here that answers all of it from anywhere.
 *
 * EXCEPT for the FIELD role. A crew member's whole app is the four buttons on
 * the launcher (see FieldHome/TileLauncher) — a box that searches pages they
 * cannot open, vendors, and bills is a keyboard in the way of the one thing
 * they came to do. Leads keep it: they reach Tracking Sheets and the bills
 * behind it, so there is something to search for.
 */
export function AppHeader() {
  const pathname = usePathname();
  const access = useAccess();
  if (pathname === "/login" || pathname === "/privacy") return null;

  return (
    <div className="sticky top-0 z-20 border-b border-black/10 bg-cream/95 backdrop-blur dark:border-white/10 dark:bg-ink/95 print:hidden">
      {/* Ochre marquee hairline — the brand's gold highlight, carried across
          every page as the app's top rule. */}
      <div className="h-0.5 bg-brand" aria-hidden />
      <GlobalJobBar />
      {access.role !== "field" && <GlobalSearch />}
    </div>
  );
}
