import { Suspense } from "react";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { PREVIEW_COOKIE, parsePreviewRole } from "@/lib/preview";
import { getCachedJobs } from "@/lib/jobsCache";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getOrgTimeEntryTypeNames, getOrgUsers } from "@/lib/jobtread";
import { readAppJtUserIds, readJtUserLink } from "@/lib/jtUserLink";
import { rosterForRole } from "@/lib/payRates";
import { listCostCodeDefaults, listPayTypeRules } from "@/lib/payTypeRules";
import { LaborClient } from "./LaborClient";

export const metadata = { title: "Labor" };

// Suspense because LaborClient reads ?period, ?date, ?ym and ?jobId.
// The calendar view is the Time page's Split View calendar, so this page loads
// the same inputs (employee-time/page.tsx). Admin + office only, as there.
export default async function LaborPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "";
  const preview = role === "admin" ? parsePreviewRole((await cookies()).get(PREVIEW_COOKIE)?.value) : null;
  const viewRole = preview ?? role;
  const cfg = hasGrant() ? getPaveConfig() : null;
  let calendar = null;
  if ((viewRole === "admin" || viewRole === "office") && cfg) {
    const email = session?.user?.email ?? "";
    const link = await readJtUserLink(email);
    const myId = (session?.user?.jtUserId || link?.jtUserId || "").trim();
    const [jobs, users, orgTypes, appUserIds, payRules, codeDefaults] = await Promise.all([
      getCachedJobs().catch(() => []),
      getOrgUsers(cfg).catch(() => []),
      getOrgTimeEntryTypeNames(cfg).catch(() => [] as string[]),
      readAppJtUserIds(),
      myId ? listPayTypeRules(myId).catch(() => []) : [],
      myId ? listCostCodeDefaults(myId).catch(() => []) : [],
    ]);
    calendar = { users: rosterForRole(users, role), appUserIds, myId, jobs, orgTypes, payRules, codeDefaults };
  }
  return (
    <Suspense fallback={null}>
      <LaborClient calendar={calendar} />
    </Suspense>
  );
}
