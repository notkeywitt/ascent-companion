import type { UserRef } from "@/lib/jobtread";

/**
 * Pay RATES are office information. Every role picks a pay type by name, but
 * only admin and office may see the dollars behind it. The rate is removed on
 * the server, before the roster leaves it, so a field phone never holds it —
 * hiding it in the UI alone would still ship every employee's rate in the
 * page payload.
 */
export function canSeePayRates(role: string | undefined | null): boolean {
  return role === "admin" || role === "office";
}

/** The roster as `role` may see it: pay-type names always, rates only for office/admin.
 *  Returns new objects — the input is a shared cache entry and must not be mutated. */
export function rosterForRole(users: UserRef[], role: string | undefined | null): UserRef[] {
  if (canSeePayRates(role)) return users;
  return users.map((u) => (u.types ? { ...u, types: u.types.map((t) => ({ name: t.name })) } : u));
}
