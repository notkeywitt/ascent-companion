"use client";

/**
 * "Open desktop widget" — Home's button for the Mac panel in `desktop-widget/`.
 *
 * It opens the link `ascentwidget://show`, which the panel app registers with
 * macOS. The app starts if it is closed, or comes forward if it is open. On a
 * Mac without the app installed the tap does nothing, so the page that names
 * the install step is one tap away in the README.
 *
 * Desktop only (a mouse as the main pointer): a phone cannot run the panel.
 */
export function HomeWidgetButton() {
  return (
    <section className="mt-4 hidden [@media(pointer:fine)]:block">
      <a
        href="ascentwidget://show"
        className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold transition hover:border-line-strong dark:bg-ink-raised"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2.5" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
        Open desktop widget
      </a>
    </section>
  );
}
