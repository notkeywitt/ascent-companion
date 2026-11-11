"use client";

import { useRef, useState } from "react";

/**
 * "Open desktop widget" — the side rail's button, next to the Hide arrow, for the Mac panel in `desktop-widget/`.
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
 * The install steps open as a card beside the rail, not inside it: the rail is
 * 88px wide.
 */
const INSTALL = "curl -fsSL https://ascent-companion.vercel.app/widget-install.sh | zsh";

export function RailWidgetButton() {
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
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Open desktop widget"
        title="Open desktop widget"
        className="flex items-center justify-center rounded-xl px-3 py-2 text-neutral-500 hover:text-accent dark:text-neutral-400 [@media(pointer:coarse)]:hidden"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2.5" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      </button>

      {missing && (
        <div
          role="dialog"
          aria-label="Install the desktop widget"
          className="fixed bottom-4 z-40 w-[22rem] max-w-[calc(100vw-6rem)] rounded-xl border border-line bg-white p-3 text-sm shadow-lg dark:bg-ink-raised print:hidden"
          style={{ left: "calc(var(--rail-w) + 0.5rem)" }}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">The widget is not on this Mac yet. Install it:</p>
            <button type="button" onClick={() => setMissing(false)} aria-label="Close" className="text-neutral-500 hover:text-accent">
              ×
            </button>
          </div>
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
    </>
  );
}
