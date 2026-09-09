"use client";

import { useEffect, useState } from "react";
import { Chip, MetaLine, SectionLabel } from "@/components/ui";
import { PeakMark } from "@/components/PageTitle";
import { useAccess } from "@/components/AccessProvider";
import { COMPANY_TZ, billingWindow } from "@/lib/billing";
import { monthLabel } from "@/lib/billingMonths";

/**
 * The head of the iPad home console — a dateline, and where the billing month
 * stands.
 *
 * IT EXISTS ONLY AT `pad` AND UP, and that is the whole reason it can exist at
 * all. The home page deliberately carries no <h1> on a phone: a title plus its
 * description costs the top fifth of the screen to say what the header logo
 * already says (see the note in src/app/page.tsx). An iPad in portrait has
 * ~1180px of height, so the same band costs it nothing and buys two things a
 * phone gives up — a real page heading for a screen reader, and a place to
 * stand the ONE fact this office checks before it opens anything.
 *
 * THAT FACT IS THE BILLING WINDOW. Bills code 10th-to-10th: one arriving today
 * lands in August until the 10th passes, then in September. Getting that wrong
 * is the recurring bug this business has (see src/lib/billing.ts), and the two
 * days either side of the 10th are when it happens. So the month is stated
 * plainly all month, and the countdown appears only inside the last five days —
 * as a chip in the final 24 hours, which is the one moment it changes what
 * someone does next. Gated on `recode`: a role that never codes a bill has no
 * decision to make here.
 *
 * The date is read in an effect, not at render. This component is server-
 * rendered too, and a server in UTC would disagree with an iPad in Pacific
 * about which day it is — a hydration mismatch that throws away the whole tree.
 * The band keeps its height while that resolves, so nothing shifts.
 */
export function HomeMasthead() {
  const access = useAccess();
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => setToday(new Date()), []);

  // BOTH halves read the COMPANY timezone, not the device's. The billing window
  // has to (a bill uploaded at 11 PM Pacific on the 10th must not count as the
  // 11th — see billing.ts), and a date beside it that used the device's zone
  // would disagree with it for part of every day: "Wednesday the 9th, 2 days
  // left" is nonsense next to a window that closes on the 10th.
  const dateLine = today
    ? today.toLocaleDateString(undefined, {
        timeZone: COMPANY_TZ,
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";

  const period = today && access.can("recode") ? billingWindow(today) : null;
  const month = period ? monthLabel(period.ym).replace(/ \d{4}$/, "") : "";

  return (
    <header className="mb-6 hidden items-end justify-between gap-6 border-b border-line pb-4 pad:flex">
      <div className="min-w-0">
        <SectionLabel>Today</SectionLabel>
        <div className="mt-1 flex items-center gap-2.5">
          <PeakMark className="h-3.5 w-[22px] shrink-0" />
          {/* min-h keeps the band's height across the one frame before the
              effect above knows what day it is. */}
          <h1 className="min-h-[26px] text-[21px] font-bold leading-tight tracking-tight">
            {dateLine}
          </h1>
        </div>
      </div>

      {period && (
        <div className="shrink-0 text-right">
          <SectionLabel>Billing period</SectionLabel>
          <p className="mt-1 text-[21px] font-bold leading-tight tracking-tight">{month}</p>
          <div className="mt-1 flex items-center justify-end gap-2">
            {period.daysLeft <= 1 ? (
              <Chip tone="warning">
                {period.daysLeft === 0 ? "Closes today" : "1 day left"}
              </Chip>
            ) : (
              <MetaLine
                items={[
                  "Bills arriving today",
                  period.daysLeft <= 5 ? `${period.daysLeft} days left` : null,
                ]}
              />
            )}
          </div>
        </div>
      )}
    </header>
  );
}
