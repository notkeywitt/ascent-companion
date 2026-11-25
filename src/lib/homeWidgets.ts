import { completeOrder } from "@/lib/reorder";

/**
 * The desktop Home's widgets and each person's arrangement of them: which show,
 * in what order, and which take the full width. Saved per user in
 * `home_layouts` (lib/homeLayoutStore). Client-safe: no DB import here.
 *
 * No free resize and no grid library (OVERHAUL_PLAN decision 4): two sizes,
 * one column or both.
 */

// "today" was dropped 2026-11-14 (This week replaced it). A saved layout that
// still names it loses it in `normalizeLayout`, which drops unknown ids.
export const WIDGETS = [
  { id: "week", label: "This week" },
  { id: "todos", label: "To-dos" },
  { id: "crew", label: "Clocked in" },
  { id: "invoicing", label: "Monthly invoicing", view: "invoicing-summary" },
  { id: "leads", label: "Newest leads", view: "leads" },
  { id: "bills", label: "Unpaid bills", view: "accounts-payable" },
  { id: "inbox", label: "Inbox", view: "office-inbox" },
] as const;

export type WidgetId = (typeof WIDGETS)[number]["id"];

/** The cards a phone stacks, in the order it shows them by default. */
export const PHONE_CARDS = ["week", "todos", "bills", "inbox", "radio", "attention"] as const;
export type PhoneCard = (typeof PHONE_CARDS)[number];

export interface HomeLayout {
  order: WidgetId[];
  hidden: WidgetId[];
  wide: WidgetId[];
  /** The phone's own card order (separate from the desktop `order`). */
  phone: PhoneCard[];
}

const IDS = WIDGETS.map((w) => w.id) as WidgetId[];

export const DEFAULT_LAYOUT: HomeLayout = { order: IDS, hidden: [], wide: ["invoicing"], phone: [...PHONE_CARDS] };

/** This week always takes both columns: its details panel needs the room. */
export const isWide = (l: HomeLayout, id: WidgetId) => id === "week" || l.wide.includes(id);

const isId = (v: unknown): v is WidgetId => IDS.includes(v as WidgetId);
const ids = (v: unknown): WidgetId[] => (Array.isArray(v) ? [...new Set(v.filter(isId))] : []);

/**
 * Anything stored (or posted) → a layout that names every widget once. An
 * unknown id is dropped; a widget added since the row was saved joins at the
 * end, shown, at its default size.
 */
export function normalizeLayout(raw: unknown): HomeLayout {
  if (!raw || typeof raw !== "object") return DEFAULT_LAYOUT;
  const r = raw as Record<string, unknown>;
  const order = ids(r.order);
  for (const id of IDS) if (!order.includes(id)) order.push(id);
  return {
    order,
    hidden: ids(r.hidden),
    wide: Array.isArray(r.wide) ? ids(r.wide) : DEFAULT_LAYOUT.wide,
    phone: completeOrder(r.phone, PHONE_CARDS),
  };
}
