"use client";

/**
 * One modal for the whole app: a bottom sheet on a phone, a centred dialog
 * from `sm` up. Twenty-four pages hand-rolled this overlay, each with its own
 * scrim, radius, width and padding, and most without Escape or a scroll lock.
 *
 * - Escape and a tap on the scrim both close it, unless `busy` (a write is in
 *   flight and closing would hide its outcome).
 * - The page behind it does not scroll while it is open.
 * - It renders into <body>, so a sticky or blurred ancestor cannot trap it.
 * - Focus moves into the panel on open and back to the opener on close.
 *
 * `title` draws the standard heading; leave it out when the content carries its
 * own, and `label` still names the dialog for a screen reader. `footer` docks
 * the actions below a hairline so they stay put while the body scrolls.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Open dialogs, newest last. A dialog can open from inside another (Buy back
// from the bill pop-up), and Escape closes only the top one.
const stack: object[] = [];

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
} as const;

export function Dialog({
  onClose,
  label,
  title,
  description,
  footer,
  size = "md",
  busy = false,
  role = "dialog",
  pad = true,
  bare = false,
  className = "",
  children,
}: {
  onClose: () => void;
  /** The accessible name. Defaults to `title` when that is a string. */
  label?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof SIZES;
  /** True while a write runs: Escape and the scrim stop closing it. */
  busy?: boolean;
  role?: "dialog" | "alertdialog";
  /** False when the body lays out its own edge-to-edge rows. */
  pad?: boolean;
  /** No panel of its own: the child is already a Card and is the surface. */
  bare?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // The latest close and busy, read by the listeners below without re-binding
  // them on every render.
  const live = useRef({ onClose, busy });
  live.current = { onClose, busy };

  useEffect(() => {
    setMounted(true);
    const opener = document.activeElement as HTMLElement | null;
    const me = {};
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === me && !live.current.busy) {
        e.stopPropagation();
        live.current.onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(me), 1);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    // An autoFocus field inside wins; otherwise the panel itself takes focus so
    // Tab starts inside the dialog rather than on the page behind it.
    if (mounted && panel.current && !panel.current.contains(document.activeElement)) {
      panel.current.focus();
    }
  }, [mounted]);

  if (!mounted) return null;
  const name = label ?? (typeof title === "string" ? title : undefined);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4 print:hidden"
      onClick={() => !live.current.busy && onClose()}
    >
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[90dvh] w-full flex-col outline-none ${SIZES[size]} ${
          bare
            ? ""
            : "overflow-hidden rounded-t-2xl border border-line bg-white text-neutral-900 shadow-xl dark:bg-ink-overlay dark:text-neutral-100 sm:rounded-2xl"
        } ${className}`}
      >
        {(title || description) && (
          <div className="shrink-0 px-4 pb-1 pt-4">
            {title && <h2 className="text-base font-semibold leading-snug">{title}</h2>}
            {description && <div className="mt-0.5 text-xs text-neutral-500">{description}</div>}
          </div>
        )}
        <div
          className={`min-h-0 flex-1 overflow-y-auto ${
            pad && !bare ? `px-4 pt-3 ${footer ? "pb-4" : "pb-[max(1rem,env(safe-area-inset-bottom))]"}` : ""
          }`}
        >
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-soft px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
