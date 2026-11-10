/**
 * Who may see whose logged miles, by companion role.
 *
 * Apps Script `listMileage` decides "admin" from its own hardcoded email list
 * (MLG_ADMIN_EMAILS in ascent-appscript/Mileage.js), not from the companion
 * role. So a person on that list whose role here is `field` got every trip.
 * This applies the companion role on top: only `admin` and `office` see every
 * driver; everyone else sees only their own trips and no driver list.
 */
import type { Role } from "@/lib/views";

export interface MileageList {
  ok?: boolean;
  isAdmin?: boolean;
  users?: string[];
  trips?: Record<string, unknown>[];
  [k: string]: unknown;
}

/** True when this role may see every driver's trips. */
export function seesAllMileage(role: Role | undefined | null): boolean {
  return role === "admin" || role === "office";
}

/**
 * Narrow a `listMileage` reply to what this person may see. `myName` is their
 * roster name (the sheet's Driver column); a trip is theirs when its Driver is
 * that name or its Logged By is their email.
 */
export function scopeMileageList(
  data: MileageList,
  who: { role: Role | undefined | null; email: string; myName?: string },
): MileageList {
  if (seesAllMileage(who.role)) return data;
  const email = who.email.trim().toLowerCase();
  const name = (who.myName ?? "").trim().toLowerCase();
  // Apps Script already scoped a non-admin to their own trips. Re-filter only
  // when it answered as admin, so a roster-name match it made is not lost.
  const trips = data.isAdmin
    ? (data.trips ?? []).filter((t) => {
        const driver = String(t["Driver"] ?? "").trim().toLowerCase();
        const loggedBy = String(t["Logged By"] ?? "").trim().toLowerCase();
        return (!!email && loggedBy === email) || (!!name && driver === name);
      })
    : (data.trips ?? []);
  return { ...data, isAdmin: false, users: [], trips };
}
