"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Banner, Button, type BannerTone } from "@/components/ui";

/**
 * The two reader surfaces for a notice — the BANNER stack and the POPUP.
 *
 * `NoticeCenter` is mounted once in the root layout, directly under the header,
 * and owns both. It fetches the reader's own scoped feed (`/api/notices`, which
 * resolves identity, targeting and the schedule window server-side) ONE time per
 * load and splits it by each notice's `display`:
 *
 *  - **banner** — a tinted strip in the page flow, under the header, on whatever
 *    page the reader has open. The default, and what a scheduled announcement
 *    should be: it says its piece without standing between the reader and their
 *    work. A standing banner (`dismissible` off) has no ✕ and stays for its
 *    whole window.
 *  - **popup** — the interrupting modal, kept for the announcement that must be
 *    acknowledged before anything else. Always dismissible; one at a time,
 *    newest first.
 *
 * Both surfaces live in one component because they share one feed. Two
 * components would mean two requests for the same answer on every page load.
 *
 * The popup renders as `fixed inset-0`, so its position on screen does not
 * depend on where in the tree this sits — only the banner stack does.
 *
 * WHY IT RE-FETCHES: a scheduled notice starts while the app is already open,
 * and this app is installed to home screens and left open for days. So the feed
 * is re-read when the tab becomes visible again and every five minutes it stays
 * visible. Anything already dismissed on this device is held back locally too,
 * so a re-fetch that races the dismiss write can't flash it back.
 */

interface Notice {
  id: number;
  title: string;
  body: string;
  tone: "info" | "warning" | "success" | string;
  display: "banner" | "popup" | string;
  dismissible: boolean;
  createdAt: string;
}

const REFETCH_MS = 5 * 60 * 1000;

/** Notice tone → the design system's banner tone. */
const TONE: Record<string, BannerTone> = {
  info: "info",
  warning: "warning",
  success: "success",
};

/** The tone mark, as inline SVG paths — monochrome, painted in `currentColor`. */
const TONE_ICON: Record<string, ReactNode> = {
  info: <path d="M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" />,
  warning: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  success: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
};

function ToneMark({ tone, className = "h-5 w-5" }: { tone: string; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {TONE_ICON[tone] ?? TONE_ICON.info}
    </svg>
  );
}

export function NoticeCenter() {
  const [feed, setFeed] = useState<Notice[]>([]);
  // Dismissed on THIS device, this load — the local half of the read mark, so a
  // re-fetch in flight beside the dismiss write can't bring one back.
  const dismissed = useRef<Set<number>>(new Set());
  const mounted = useRef(true);

  const load = useCallback(() => {
    fetch("/api/notices")
      .then((r) => r.json())
      .then((j) => {
        if (!mounted.current || !Array.isArray(j.notices)) return;
        setFeed((j.notices as Notice[]).filter((n) => !dismissed.current.has(n.id)));
      })
      // A failed fetch must never break the page this is mounted on — both
      // surfaces are additive. Stay silent and show nothing.
      .catch(() => {});
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, REFETCH_MS);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [load]);

  const dismiss = useCallback((id: number) => {
    dismissed.current.add(id);
    // Clear it immediately; record the read in the background.
    setFeed((f) => f.filter((n) => n.id !== id));
    fetch("/api/notices/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, []);

  const banners = useMemo(() => feed.filter((n) => n.display !== "popup"), [feed]);
  const popups = useMemo(() => feed.filter((n) => n.display === "popup"), [feed]);

  return (
    <>
      <NoticeBanners notices={banners} onDismiss={dismiss} />
      <NoticePopup queue={popups} onDismiss={dismiss} />
    </>
  );
}

/** The banner stack: one tinted strip per live notice, in the page flow. */
function NoticeBanners({
  notices,
  onDismiss,
}: {
  notices: Notice[];
  onDismiss: (id: number) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-2 px-4 pt-3">
      {notices.map((n) => (
        <Banner key={n.id} tone={TONE[n.tone] ?? "info"}>
          <div className="flex items-start gap-2.5">
            <ToneMark tone={n.tone} className="mt-px h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold tracking-tight">{n.title}</p>
              {n.body && <p className="mt-0.5 whitespace-pre-wrap opacity-90">{n.body}</p>}
            </div>
            {n.dismissible && (
              <button
                type="button"
                onClick={() => onDismiss(n.id)}
                aria-label={`Dismiss: ${n.title}`}
                title="Dismiss"
                // Inherits the banner's own tone colour rather than the icon
                // button's neutral/accent hover, which would fight the tint.
                className="-my-1.5 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-base leading-none opacity-60 transition hover:bg-black/5 hover:opacity-100 active:scale-95 dark:hover:bg-white/10"
              >
                ✕
              </button>
            )}
          </div>
        </Banner>
      ))}
    </div>
  );
}

/** The interrupting modal — one notice at a time, newest first. */
function NoticePopup({
  queue,
  onDismiss,
}: {
  queue: Notice[];
  onDismiss: (id: number) => void;
}) {
  const current = queue[0];
  const dismiss = useCallback(() => {
    if (current) onDismiss(current.id);
  }, [current, onDismiss]);

  // Escape closes the current notice, matching the backdrop click.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, dismiss]);

  if (!current) return null;
  const remaining = queue.length - 1;
  const badge =
    current.tone === "warning"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
      : current.tone === "success"
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
        : "bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent-soft";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={dismiss}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="notice-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl dark:bg-ink-raised"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${badge}`}
          >
            <ToneMark tone={current.tone} />
          </span>
          <div className="min-w-0">
            <h2 id="notice-title" className="text-base font-bold tracking-tight">
              {current.title}
            </h2>
            {current.body && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-500">{current.body}</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-400">
            {remaining > 0 ? `${remaining} more notice${remaining === 1 ? "" : "s"}` : ""}
          </span>
          <Button onClick={dismiss}>{remaining > 0 ? "Next" : "Got it"}</Button>
        </div>
      </div>
    </div>
  );
}
