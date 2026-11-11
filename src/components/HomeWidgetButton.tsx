"use client";

import { useRef, useState } from "react";

/**
 * "Open desktop widget" — Home's button for the Mac panel in `desktop-widget/`.
 *
 * The tap opens `ascentwidget://show`, which the panel app registers with
 * macOS. The app starts if it is closed, or comes forward if it is open.
 *
 * A page cannot ask macOS whether the app is installed. So the tap watches
 * whether the browser loses focus (it does when macOS hands the link to an
 * app). No focus loss in 1.5 s means nothing opened, and the button shows the
 * install steps instead and puts the install line on the clipboard. A page
 * cannot open Terminal or run a command, so the person pastes it themselves.
 * The line is `curl`, which macOS does not block the way it blocks a download
 * made in a browser. Files: public/widget-install.sh, public/AscentWidget.zip.
 *
 * Desktop only (a mouse as the main pointer): a phone cannot run the panel.
 */
const INSTALL = "curl -fsSL https://ascent-companion.vercel.app/widget-install.sh | zsh";

export function HomeWidgetButton() {
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(INSTALL);
      setCopied(true);
    } catch {
      setCopied(false); // blocked — the line is on screen to copy by hand
    }
  }

  function open() {
    setMissing(false);
    setCopied(false);
    let left = false;
    const onBlur = () => {
      left = true;
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onBlur);

    // A hidden frame, not window.location: Safari alerts on an unknown scheme
    // in the window but stays quiet in a frame.
    const f = document.createElement("iframe");
    f.style.display = "none";
    f.src = "ascentwidget://show";
    document.body.appendChild(f);

    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onBlur);
      f.remove();
      if (!left) {
        setMissing(true);
        void copy();
      }
    }, 1500);
  }

  return (
    <section className="mt-4 hidden [@media(pointer:fine)]:block">
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold transition hover:border-line-strong dark:bg-ink-raised"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2.5" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
        Open desktop widget
      </button>

      {missing && (
        <div className="mt-3 max-w-xl rounded-xl border border-line bg-white p-3 text-sm dark:bg-ink-raised">
          <p className="font-semibold">The widget is not on this Mac yet. Install it:</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Press ⌘ Space. Type Terminal. Press Return.</li>
            <li>
              Press ⌘ V, then Return. {copied ? "The line is copied." : "Copy the line below first."}
            </li>
            <li>Sign in with Google in the panel that opens.</li>
          </ol>
          <code className="mt-2 block select-all break-all rounded-lg bg-neutral-100 px-2 py-1.5 text-xs dark:bg-black/30">
            {INSTALL}
          </code>
          <div className="mt-2 flex gap-3 text-xs">
            <button type="button" onClick={copy} className="font-semibold underline">
              {copied ? "Copied" : "Copy the line"}
            </button>
            <button type="button" onClick={open} className="underline">
              It is installed — try again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
