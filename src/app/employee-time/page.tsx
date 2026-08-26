import { auth } from "@/auth";
import { getCachedJobs } from "@/lib/jobsCache";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getOrgTimeEntryTypeNames, getOrgUsers } from "@/lib/jobtread";
import { readJtUserLink } from "@/lib/jtUserLink";
import { readLastUsed, readOpenClock, type LastUsed, type OpenClock } from "@/lib/employeeClock";
import { EmployeeTimeClient } from "./EmployeeTimeClient";

/**
 * Employee Time — the crew's time clock. The screen is the client component;
 * this shell gathers everything it needs BEFORE the HTML leaves the server.
 *
 * WHY: the page used to boot empty and then make four calls — its bootstrap,
 * its clock check, the leave balances and the job list. Three of those ended at
 * the Apps Script web app, where one round trip costs ~3 s of Google overhead
 * before the script runs (measured 2026-08-26). All three asked the same
 * question: "who is this person?".
 *
 * That answer now rides in the sign-in token and in the `jt_user_links` table
 * (see lib/jtUserLink), so the shell resolves it with one DB read, and can then
 * ask JobTread itself — which answers in about 0.1 s — for the running clock and
 * the last job worked. The jobs come out of the Data Cache (~0.01 s warm).
 *
 * Nothing here waits on Apps Script. A person whose link is not cached yet
 * (first sign-in, or an expired link) gets `identityResolved: false` and the
 * client resolves it in the background — the screen still paints at once.
 */
export default async function EmployeeTimePage() {
  const session = await auth();
  const email = session?.user?.email ?? "";

  // The identity: the token first (stamped at sign-in), then the DB link. Both
  // are cheap; neither touches Apps Script.
  const link = await readJtUserLink(email);
  const jtUserId = (session?.user?.jtUserId || link?.jtUserId || "").trim();
  const me =
    link || jtUserId
      ? {
          name: link?.name || session?.user?.name || "",
          email: link?.email || email,
          jtUserId,
          jtUserName: link?.jtUserName ?? "",
        }
      : null;

  const grant = hasGrant();
  const cfg = grant ? getPaveConfig() : null;
  const employeeName = me?.name || me?.jtUserName || "";

  const [jobs, jtUsers, orgTypes, clock, lastUsed] = await Promise.all([
    grant ? getCachedJobs().catch(() => []) : [],
    cfg ? getOrgUsers(cfg).catch(() => []) : [],
    cfg ? getOrgTimeEntryTypeNames(cfg).catch(() => [] as string[]) : [],
    cfg && jtUserId
      ? readOpenClock(jtUserId, employeeName).catch(
          () => null as { openEntry: OpenClock | null; openCount: number } | null,
        )
      : null,
    cfg && jtUserId ? readLastUsed(jtUserId).catch(() => null as LastUsed | null) : null,
  ]);

  return (
    <EmployeeTimeClient
      initialJobs={jobs}
      initialMe={me}
      initialJtUsers={jtUsers}
      initialOrgTypes={orgTypes}
      initialOpenEntry={clock?.openEntry ?? null}
      // Only a resolved identity can say "JobTread has no clock for you", which
      // is what lets the client clear a stale local one.
      initialLinked={!!jtUserId && !!clock}
      identityResolved={!!me}
      lastUsed={lastUsed}
    />
  );
}
