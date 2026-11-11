"use client";

import { useEffect, useRef, useState } from "react";
import { HomeMasthead } from "@/components/HomeMasthead";
import { TodayQueue } from "@/components/TodayQueue";
import { HomeJobBoard } from "@/components/HomeJobBoard";
import { TodayOfficeTodos } from "@/components/TodayOfficeTodos";

/**
 * The widget's body. It covers the whole window (z-[1000]), so the header, the
 * tab bar and the app-wide popups from the root layout sit under it unseen —
 * the root layout needs no special case for this route.
 *
 * A link opens in a new window, not in the widget. The Mac panel turns every
 * new-window request into the default browser, so a tap on "Bills to code"
 * opens the full app there and the widget stays on this page.
 */
export function WidgetView() {
  const root = useRef<HTMLDivElement>(null);
  const [stamp, setStamp] = useState("");

  useEffect(() => {
    setStamp(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    const el = root.current;
    if (!el) return;
    // Capture phase, so this runs before Next's <Link> turns the click into
    // an in-widget navigation.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.getAttribute("href")?.startsWith("#")) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(a.href, "_blank");
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, []);

  return (
    <div
      ref={root}
      className="no-scrollbar fixed inset-0 z-[1000] overflow-y-auto px-3 pb-6 pt-3"
      style={{ background: "rgb(var(--page))", color: "rgb(var(--page-fg))" }}
    >
      {/* No scroll bars, on the page behind the cover too. The panel still
          scrolls by trackpad or wheel. */}
      <style>{`html,body{scrollbar-width:none}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}`}</style>
      <HomeMasthead />
      <TodayQueue />
      <HomeJobBoard />
      <TodayOfficeTodos />
      <p className="mt-4 text-center text-xs text-neutral-500">Updated {stamp}</p>
    </div>
  );
}
