"use client";

/**
 * The one build for anything that drops down from a button.
 *
 * - `Menu`: a list of actions and links. Arrow keys, typeahead, Escape and
 *   outside taps come from Base UI. Children are `MenuItem`, `MenuLink`,
 *   `MenuSeparator` and `MenuLabel`.
 * - `Popover`: arbitrary content (a picker, a short form, an explanation).
 *
 * `trigger` is the element that opens it — usually a `Button` or `IconButton`.
 * It must forward a ref and spread its props, which every ui.tsx control does.
 * Both render into <body>, so a sticky or overflow-hidden ancestor cannot clip
 * them. Base UI was chosen over the native Popover API; THEME.md says why.
 */

import Link from "next/link";
import { Menu as M } from "@base-ui/react/menu";
import { Popover as P } from "@base-ui/react/popover";

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

const PANEL =
  "z-50 max-h-[var(--available-height)] min-w-[12rem] overflow-y-auto overscroll-contain rounded-xl border border-line bg-white text-sm text-neutral-900 shadow-lg outline-none origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 dark:bg-ink-overlay dark:text-neutral-100 print:hidden";

// 44px tall on a touch screen, denser under a mouse. The highlight fill marks
// the focused item, so the global :focus-visible ring is turned off here.
const ITEM =
  "flex min-h-11 w-full cursor-default select-none items-center gap-2 px-3 text-left outline-none focus-visible:outline-none [@media(pointer:fine)]:min-h-9 data-[highlighted]:bg-neutral-100 data-[disabled]:opacity-40 dark:data-[highlighted]:bg-white/10";

export function Menu({
  trigger,
  side = "bottom",
  align = "end",
  open,
  onOpenChange,
  className = "",
  children,
}: {
  trigger: React.ReactElement;
  side?: Side;
  align?: Align;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <M.Root open={open} onOpenChange={onOpenChange && ((o) => onOpenChange(o))}>
      <M.Trigger render={trigger} />
      <M.Portal>
        <M.Positioner side={side} align={align} sideOffset={6} collisionPadding={8} className="z-50">
          <M.Popup className={`${PANEL} py-1 ${className}`}>{children}</M.Popup>
        </M.Positioner>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({
  onClick,
  tone = "default",
  disabled,
  closeOnClick,
  children,
}: {
  onClick?: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  /** False keeps the menu open (a toggle inside it). */
  closeOnClick?: boolean;
  children: React.ReactNode;
}) {
  return (
    <M.Item
      onClick={onClick}
      disabled={disabled}
      closeOnClick={closeOnClick}
      className={`${ITEM} ${tone === "danger" ? "text-danger" : ""}`}
    >
      {children}
    </M.Item>
  );
}

/** A Next.js link in a menu. `external` opens a new tab with a plain <a>. */
export function MenuLink({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <M.LinkItem
      closeOnClick
      className={ITEM}
      render={external ? <a href={href} target="_blank" rel="noreferrer" /> : <Link href={href} />}
    >
      {children}
    </M.LinkItem>
  );
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line-soft" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
      {children}
    </div>
  );
}

export function Popover({
  trigger,
  side = "bottom",
  align = "center",
  open,
  onOpenChange,
  label,
  className = "",
  children,
}: {
  trigger: React.ReactElement;
  side?: Side;
  align?: Align;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The accessible name of the panel. */
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange && ((o) => onOpenChange(o))}>
      <P.Trigger render={trigger} />
      <P.Portal>
        <P.Positioner side={side} align={align} sideOffset={6} collisionPadding={8} className="z-50">
          <P.Popup aria-label={label} className={`${PANEL} min-w-0 max-w-[calc(100vw-1rem)] p-3 ${className}`}>
            {children}
          </P.Popup>
        </P.Positioner>
      </P.Portal>
    </P.Root>
  );
}
