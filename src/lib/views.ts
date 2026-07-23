/**
 * The single source of truth for role-gated views.
 *
 * Pure constants + pure functions only — NO DB, Node, or React imports — so this
 * module is safe to import from middleware (edge runtime), server components, and
 * client components alike. Both the home launcher and the tab bar filter their
 * links through `resolveAllowedViews`, and the middleware enforces the same rule
 * server-side via `viewIdForPath`.
 *
 * To add a gateable page: add a VIEW entry (with the route prefixes that belong
 * to it) and, if it shouldn't be admin-only, add its id to the relevant role in
 * ROLE_VIEWS. Nav entries reference views by `id`.
 */

export type Role = "admin" | "office" | "field";
export const ROLES: Role[] = ["admin", "office", "field"];

export type ViewGroup = "Financials" | "Field" | "Assistant" | "Office" | "System";

export interface ViewDef {
  id: string;
  /** Route prefixes that belong to this view (segment-boundary matched). */
  paths: string[];
  group: ViewGroup;
  /** Short human label for the admin override editor. */
  label: string;
}

/**
 * Every gateable view. `paths[0]` is the canonical route; extra paths are child
 * routes that share the same gate (e.g. /bill + /add-bill live under Coding).
 */
export const VIEWS: ViewDef[] = [
  // Financials / billing
  { id: "coding", label: "Coding Review", group: "Financials", paths: ["/coding", "/bill", "/add-bill"] },
  { id: "stage", label: "Invoicing", group: "Financials", paths: ["/stage"] },
  { id: "unbilled", label: "Unbilled", group: "Financials", paths: ["/unbilled"] },
  { id: "email", label: "Email Invoices", group: "Financials", paths: ["/email"] },
  { id: "needs-project", label: "Needs Project", group: "Financials", paths: ["/needs-project"] },
  { id: "payments", label: "Payments", group: "Financials", paths: ["/payments"] },
  // Field
  { id: "safety-meeting", label: "Safety Meeting", group: "Field", paths: ["/safety-meeting"] },
  { id: "mileage", label: "Mileage", group: "Field", paths: ["/mileage-tracker"] },
  { id: "employee-time", label: "Employee Time", group: "Field", paths: ["/employee-time"] },
  { id: "tools", label: "Tools", group: "Field", paths: ["/tools", "/tool-tracker"] },
  { id: "rfis", label: "RFIs", group: "Field", paths: ["/rfis"] },
  // Assistant
  { id: "chat", label: "Assistant", group: "Assistant", paths: ["/chat"] },
  // Office
  { id: "employees", label: "Employees", group: "Office", paths: ["/employees"] },
  { id: "labor-import", label: "Labor Import", group: "Office", paths: ["/labor-import"] },
  // System
  { id: "requests", label: "Requests", group: "System", paths: ["/requests"] },
  { id: "actions", label: "Actions", group: "System", paths: ["/actions"] },
  { id: "admin", label: "Admin", group: "System", paths: ["/admin"] },
  { id: "logs", label: "Logs", group: "System", paths: ["/logs"] },
];

export const ALL_VIEW_IDS: string[] = VIEWS.map((v) => v.id);

/** Base view set granted by each role, before per-user overrides. */
export const ROLE_VIEWS: Record<Role, string[]> = {
  admin: ALL_VIEW_IDS,
  office: ALL_VIEW_IDS.filter((id) => !["actions", "admin", "logs"].includes(id)),
  field: ["safety-meeting", "mileage", "employee-time", "tools", "rfis", "chat", "requests"],
};

function asRole(role: string | null | undefined): Role {
  return role === "admin" || role === "office" || role === "field" ? role : "field";
}

/**
 * The effective set of view ids a user can access:
 *   (role base ∪ per-user grants) \ per-user denials.
 * `allow`/`deny` are the parsed viewsAllow/viewsDeny arrays.
 */
export function resolveAllowedViews(
  role: string | null | undefined,
  allow: string[] = [],
  deny: string[] = [],
): Set<string> {
  const set = new Set<string>(ROLE_VIEWS[asRole(role)]);
  for (const id of allow) set.add(id);
  for (const id of deny) set.delete(id);
  // Never grant a view id that no longer exists.
  return new Set([...set].filter((id) => ALL_VIEW_IDS.includes(id)));
}

/** Segment-boundary prefix match: "/tools" matches "/tools" and "/tools/x". */
function pathMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * Map a pathname to the view id that gates it, or null for ungated routes
 * (home, login, privacy, api/auth, …). Longest matching prefix wins.
 */
export function viewIdForPath(pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const v of VIEWS) {
    for (const p of v.paths) {
      if (pathMatches(pathname, p) && (!best || p.length > best.len)) {
        best = { id: v.id, len: p.length };
      }
    }
  }
  return best?.id ?? null;
}
