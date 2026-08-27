"use client";

import { usePathname } from "next/navigation";
import { GlobalJobBar } from "@/components/GlobalJobBar";
import { GlobalSearch } from "@/components/GlobalSearch";

/**
 * Sticky top chrome: the job picker row, and under it the app's one search box.
 *
 * The two together are "what am I working on" and "take me to a thing" — the
 * questions you ask before any page can help you, so they belong to the chrome
 * rather than to any one page. Search used to live only on the home launcher
 * (pages + vendors) with a second box on Bill Search (bills + line items); it is
 * now one field here that answers all of it from anywhere.
 */
export function AppHeader() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/privacy") return null;

  return (
    <div className="sticky top-0 z-20 border-b border-black/10 bg-cream/95 backdrop-blur dark:border-white/10 dark:bg-ink/95 print:hidden">
      {/* Ochre marquee hairline — the brand's gold highlight, carried across
          every page as the app's top rule. */}
      <div className="h-0.5 bg-brand" aria-hidden />
      <GlobalJobBar />
      <GlobalSearch />
    </div>
  );
}
