"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AscentLogo } from "@/components/AscentLogo";
import { GlobalSearch } from "@/components/GlobalSearch";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAccess } from "@/components/AccessProvider";
import { btn } from "@/components/ui";

/**
 * Sticky top chrome, on one line: the Ascent logo, the app's one search box, and
 * Add bill.
 *
 * THE LOGO IS THE LIGHT/DARK SWITCH. It was a home link beside a separate ☀/☾
 * button; the tab bar's Home tab already carries home from every page, so the
 * mark takes the switch and the row loses a control.
 *
 * SEARCH is the widest item because "take me to a thing" is the question you ask
 * before any page can help you. It used to live on a second line under an
 * app-wide job picker; the picker now sits on Tracking Sheets, as that page's
 * own title, where the job in context actually means something. Job-scoped pages
 * still read `?jobId` from the URL — they just don't carry the control that sets
 * it.
 *
 * EXCEPT for the FIELD role. A crew member's whole app is the four buttons on
 * the launcher (see FieldHome/TileLauncher) — a box that searches pages they
 * cannot open, vendors, and bills is a keyboard in the way of the one thing
 * they came to do. Leads keep it: they reach Tracking Sheets and the bills
 * behind it, so there is something to search for.
 */
export function AppHeader() {
  const pathname = usePathname();
  const search = useSearchParams();
  const access = useAccess();
  const jobId = search.get("jobId") ?? "";

  /* THIS BAR'S HEIGHT IS NOT A CONSTANT — the row's controls are view-gated, and
     the browser's own font settings move it. Anything that has to start below it
     therefore has to be told, so the measurement is published as `--appheader-h`
     and every sticky column reads it (globals.css has the two utility classes).
     A hardcoded offset was under the real height, and sticky panels scrolled up
     under the bar. */
  // A callback ref rather than an effect: the bar is unmounted on /login and
  // remounted on the way out of it, and this fires on exactly those two events.
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--appheader-h",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    observer.current = ro;
  }, []);

  if (pathname === "/login" || pathname === "/privacy") return null;

  // /add-bill keeps the job in context when there is one, so the button lands on
  // the job you are looking at rather than an empty form.
  const addHref = jobId ? `/add-bill?jobId=${encodeURIComponent(jobId)}` : "/add-bill";

  return (
    <div
      ref={measure}
      className="sticky top-0 z-20 border-b border-black/10 bg-cream/95 backdrop-blur dark:border-white/10 dark:bg-ink/95 print:hidden"
    >
      {/* Ochre marquee hairline — the brand's gold highlight, carried across
          every page as the app's top rule. */}
      <div className="h-0.5 bg-brand" aria-hidden />
      <div className="flex items-center gap-1.5 px-2 py-2 sm:gap-2">
        {/* `inline-flex` on the BUTTON, not just the logo: a <button> lays its
            child out in a line box, and an inline-level logo then sits on that
            box's text baseline. The line-height strut adds its descender space
            BELOW the mark, which pushed the lockup 3.5px above centre. A flex
            container makes no line box, so the mark centres on its own height. */}
        <ThemeToggle className="inline-flex shrink-0 items-center rounded-lg p-1 transition active:bg-accent/10">
          {/* Wordmark hidden on narrow / side-panel widths; icon always shows. */}
          <AscentLogo className="hidden sm:inline-flex" />
          <AscentLogo wordmark={false} className="sm:hidden" />
        </ThemeToggle>
        {/* The only flexible item — it absorbs whatever the buttons leave. The
            spacer keeps the rest right-aligned for the field role, which has no
            search box. */}
        {access.role === "field" ? <div className="min-w-0 flex-1" /> : <GlobalSearch />}
        {/* /add-bill is part of the (admin-only) Coding Review view — without the
            gate the middleware would just bounce a non-admin back to home. */}
        {access.can("coding") && (
          <Link
            href={addHref}
            aria-label="Add bill"
            className={btn("primary", "md", "relative shrink-0 whitespace-nowrap")}
          >
            {/* The words cost the search box a third of its width on a phone;
                the plus alone carries it there. */}
            ＋<span className="hidden sm:inline"> Add bill</span>
            <LinkPendingOverlay spinnerClassName="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
