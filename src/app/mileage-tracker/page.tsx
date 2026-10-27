import { auth } from "@/auth";
import { hasGrant } from "@/lib/config";
import { getCachedJobs } from "@/lib/jobsCache";
import { readJtUserLink } from "@/lib/jtUserLink";
import { MileageClient } from "./MileageClient";

/**
 * Miles — the shell gathers what the Start button waits on BEFORE the HTML
 * leaves the server, so a field worker can tap Start on first paint.
 *
 * WHY: the page used to boot empty, then ask /api/auth/session and
 * /api/employees who the driver is. The roster read ends at Apps Script, which
 * costs ~3 s of Google overhead per round trip (measured 2026-08-26), and Start
 * stayed disabled the whole time. The driver's roster name is already cached in
 * `jt_user_links` (lib/jtUserLink), so one DB read answers it; the jobs come out
 * of the Data Cache. Nothing here waits on Apps Script. A person with no cached
 * link gets an empty driver and the client falls back to the roster read.
 */
export default async function MileageTrackerPage() {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const [link, jobs] = await Promise.all([
    readJtUserLink(email),
    hasGrant() ? getCachedJobs().catch(() => []) : [],
  ]);

  return (
    <MileageClient
      sessionUser={{ name: session?.user?.name ?? "", email }}
      initialDriver={link?.name ?? ""}
      initialJobs={jobs}
    />
  );
}
