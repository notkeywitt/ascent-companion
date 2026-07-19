"use client";

import { usePathname } from "next/navigation";
import { GlobalJobBar } from "@/components/GlobalJobBar";
import { TabBar } from "@/components/TabBar";

/** Sticky top chrome: the global job picker above the tab bar. */
export function AppHeader() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/privacy") return null;

  return (
    <div className="sticky top-0 z-20 border-b border-black/10 bg-cream/95 backdrop-blur dark:border-white/10 dark:bg-ink/95 print:hidden">
      {/* Ochre marquee hairline — the brand's gold highlight, carried across
          every page as the app's top rule. */}
      <div className="h-0.5 bg-ochre" aria-hidden />
      <GlobalJobBar />
      <TabBar />
    </div>
  );
}
