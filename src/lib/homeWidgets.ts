/**
 * The desktop Home's widgets and each person's arrangement of them: which show,
 * in what order, and which take the full width. Saved per user in
 * `home_layouts` (lib/homeLayoutStore). Client-safe: no DB import here.
 *
 * No free resize and no grid library (OVERHAUL_PLAN decision 4): two sizes,
 * one column or both.
 */

export const WIDGETS = [
  { id: "today", label: "Today" },
  { id: "todos", label: "To-dos" },
  { id: "invoicing", label: "Monthly invoicing", view: "invoicing-summary" },
  { id: "leads", label: "Newest leads", view: "leads" },
] as const;

export type WidgetId = (typeof WIDGETS)[number]["id"];

export interface HomeLayout {
  order: WidgetId[];
  hidden: WidgetId[];
  wide: WidgetId[];
}

const IDS = WIDGETS.map((w) => w.id) as WidgetId[];

export const DEFAULT_LAYOUT: HomeLayout = { order: IDS, hidden: [], wide: ["invoicing"] };

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
  return { order, hidden: ids(r.hidden), wide: Array.isArray(r.wide) ? ids(r.wide) : DEFAULT_LAYOUT.wide };
}
