"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { useAccess } from "@/components/AccessProvider";
import { ReorderArrows } from "@/components/ReorderArrows";
import { IconButton, SectionHeading } from "@/components/ui";
import { completeOrder, moveAmong } from "@/lib/reorder";

/** Every section on the Office dashboard, in its default order. */
export const OFFICE_SECTIONS = ["details", "vehicles", "bills", "files", "attention", "notices"] as const;
export type OfficeSectionId = (typeof OFFICE_SECTIONS)[number];

const LS_KEY = "office-dash-order-v2";

interface Ctx {
  order: OfficeSectionId[];
  shown: OfficeSectionId[];
  arranging: boolean;
  move: (id: OfficeSectionId, by: -1 | 1) => void;
}
const OrderContext = createContext<Ctx | null>(null);

/**
 * Holds the phone's section order for the Office dashboard. It is a per-device
 * choice (localStorage). The grid is a flex column on a phone, so each section's
 * CSS `order` places it; from `lg` up the columns ignore it.
 */
export function OfficeSections({ children }: { children: React.ReactNode }) {
  const { can } = useAccess();
  const [order, setOrder] = useState<OfficeSectionId[]>([...OFFICE_SECTIONS]);
  const [arranging, setArranging] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setOrder(completeOrder(JSON.parse(raw), OFFICE_SECTIONS));
    } catch {
      /* private window or bad data: keep the default order */
    }
  }, []);

  const shown = order.filter((id) => (id === "attention" || id === "notices" ? can(id) : true));
  const move = (id: OfficeSectionId, by: -1 | 1) => {
    const next = moveAmong(order, shown, id, by);
    setOrder(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* the order still holds for this visit */
    }
  };

  return (
    <OrderContext.Provider value={{ order, shown, arranging, move }}>
      <div className="mb-3 flex justify-end lg:hidden">
        <IconButton
          label={arranging ? "Done arranging" : "Arrange sections"}
          aria-pressed={arranging}
          onClick={() => setArranging((a) => !a)}
          className="!h-9 !w-9 border border-line"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {arranging ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />}
          </svg>
        </IconButton>
      </div>
      <div className="flex flex-col items-stretch gap-x-8 lg:grid lg:grid-cols-2 lg:items-start xl:grid-cols-4">
        {children}
      </div>
    </OrderContext.Provider>
  );
}

/**
 * A dashboard section that folds away on phones and, in Arrange mode, moves
 * up or down. From the `lg` width up the columns sit side by side, so the
 * section is always open and the heading is plain.
 */
export function MobileSection({
  id,
  title,
  trailing,
  className = "mb-6",
  children,
}: {
  id: OfficeSectionId;
  title: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const ctx = useContext(OrderContext);
  const i = ctx ? ctx.shown.indexOf(id) : 0;
  const arrows =
    ctx?.arranging && ctx ? (
      <ReorderArrows
        first={i <= 0}
        last={i === ctx.shown.length - 1}
        onUp={() => ctx.move(id, -1)}
        onDown={() => ctx.move(id, 1)}
      />
    ) : null;
  return (
    <section
      className={`min-w-0 lg:!order-none ${className}`}
      style={{ order: ctx ? ctx.order.indexOf(id) : 0 }}
    >
      <div className="lg:hidden">
        <SectionHeading
          trailing={
            <>
              {trailing}
              {arrows}
            </>
          }
          open={open}
          onToggle={() => setOpen((o) => !o)}
        >
          {title}
        </SectionHeading>
      </div>
      <div className="hidden lg:block">
        <SectionHeading trailing={trailing}>{title}</SectionHeading>
      </div>
      <div className={open ? "" : "hidden lg:block"}>{children}</div>
    </section>
  );
}
