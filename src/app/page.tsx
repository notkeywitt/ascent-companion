import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { currentBillingPeriod } from "@/lib/billingMonth";
import { onboardingOpen } from "@/lib/onboarding/open";
import { PREVIEW_COOKIE, parsePreviewRole } from "@/lib/preview";
import { HomeClient } from "./HomeClient";

/**
 * The Assistant's front page — Today. The page itself is in HomeClient.tsx.
 *
 * This server half does two jobs the browser used to do after it had already
 * downloaded the page (Phase 2 of OVERHAUL_PLAN):
 *
 *   • A crew member opens this app to clock in, so FIELD and LEAD land on
 *     Employee Time (lead added 2026-09-30, owner). A new hire with paperwork
 *     still open lands on it instead. Only an app OPEN redirects: a menu or
 *     bar tap to Today is a client navigation (it carries the RSC header), so
 *     the lead's Today slot and the menu still reach this page. A refresh on
 *     Today lands on Time again.
 *   • The billing month for the office's Jobs Hub, so that page does not fetch
 *     it before it can fetch the month's figures.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  let role = session?.user?.role ?? null;
  if (role === "admin") {
    // An admin previewing as a role sees that role's landing (see layout.tsx).
    role = parsePreviewRole((await cookies()).get(PREVIEW_COOKIE)?.value) ?? role;
  }

  if (role === "field" || role === "lead") {
    const appOpen = !(await headers()).get("rsc");
    // The Chrome side panel opens "/?jobId=…" to follow the JobTread job on
    // screen; that is a request for this page, not an app open.
    const asksForPage = "jobId" in (await searchParams);
    if (appOpen && !asksForPage) {
      const email = (session?.user?.email ?? "").trim().toLowerCase();
      redirect(email && (await onboardingOpen(email)) ? "/onboarding" : "/employee-time");
    }
  }

  const { billingYear, billingMonthNum } = await currentBillingPeriod();
  const billingYm = `${billingYear}-${String(billingMonthNum).padStart(2, "0")}`;
  return <HomeClient billingYm={billingYm} />;
}
