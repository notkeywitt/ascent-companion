"use client";

import { useEffect, useState } from "react";
import { Chip, MetaLine, SectionLabel } from "@/components/ui";
import { PeakMark } from "@/components/PageTitle";
import { useAccess } from "@/components/AccessProvider";
import { COMPANY_TZ, billingMonthStale } from "@/lib/billing";
import { billingMonths, monthLabel } from "@/lib/billingMonths";

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
 * THAT FACT IS THE BILLING MONTH, and here it is a CONTROL, not a readout.
 * Bills used to code 10th-to-10th on their own; now the month picked here is
 * the month every non-Sunset bill files into, for as long as it is set (see
 * src/lib/billingMonth.ts — Sunset still bills in its arrival month). That
 * covers BOTH systems that file bills: this app's /api/add-bill, and the
 * ascent-appscript Gmail capture, which the route pushes the month across to.
 * Nothing turns over on its own, so the reminder is the colour: once the 10th
 * has passed and the month is still behind the calendar, it goes RED and a chip
 * names the month to switch to.
 *
 * Office and admin change it; a lead reads it. It decides where money lands
 * org-wide, so the write is role-checked at /api/billing-month too — this is
 * only which control renders. Gated on `recode` overall: a role that never
 * codes a bill has no decision to make here.
 *
 * The date is read in an effect, not at render. This component is server-
 * rendered too, and a server in UTC would disagree with an iPad in Pacific
 * about which day it is — a hydration mismatch that throws away the whole tree.
 * The band keeps its height while that resolves, so nothing shifts.
 */
export function HomeMasthead() {
  const access = useAccess();
  const [today, setToday] = useState<Date | null>(null);
  const [ym, setYm] = useState("");
  /** True until someone picks a month: the 10th cutoff is still deciding. */
  const [auto, setAuto] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Why the last save bounced. The month snaps back, so say why it did. */
  const [err, setErr] = useState("");

  useEffect(() => setToday(new Date()), []);

  const shows = access.can("recode");
  useEffect(() => {
    if (!shows) return;
    let cancelled = false;
    fetch("/api/billing-month")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || j?.error) return;
        setYm(j.ym ?? "");
        setAuto(!j.override);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shows]);

  // BOTH halves read the COMPANY timezone, not the device's. The billing month
  // has to (a bill uploaded at 11 PM Pacific on the 10th must not count as the
  // 11th — see billing.ts), and a date beside it that used the device's zone
  // would disagree with it for part of every day.
  const dateLine = today
    ? today.toLocaleDateString(undefined, {
        timeZone: COMPANY_TZ,
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";

  /** Past the 10th with the month still behind the calendar — time to switch. */
  const stale = !!today && !!ym && billingMonthStale(today, ym);
  const months = billingMonths(15);
  const canSet = access.role === "admin" || access.role === "office";

  // A reload, not a state update: the to-be-invoiced figures on this page and
  // in the header's job picker are all keyed to this month, and each fetched
  // once. Re-reading the page is the honest way to move them together.
  //
  // The route sets this month in the Apps Script project too, and refuses the
  // whole change if that push fails — so a rejection means NOTHING moved, and
  // showing the old month back is the truth rather than a lost edit.
  async function set(next: string) {
    if (next === ym) return;
    setSaving(true);
    setErr("");
    const prev = ym;
    setYm(next);
    setAuto(false);
    const r = await fetch("/api/billing-month", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ym: next }),
    }).catch(() => null);
    if (!r || !r.ok) {
      const why = r ? await r.json().catch(() => null) : null;
      setYm(prev);
      setErr(String(why?.error ?? "Couldn't save the billing month. Try again."));
      setSaving(false);
      return;
    }
    window.location.reload();
  }

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

      {shows && (
        <div className="shrink-0 text-right">
          <SectionLabel>Billing period</SectionLabel>
          {/* A quiet native select: it reads as the heading it replaced until
              you touch it, and on a tablet it opens the OS month wheel. */}
          {canSet ? (
            <div className="mt-1 flex min-h-[26px] items-center justify-end gap-1.5">
              {/* The caret sits LEFT of the month so the month's last character
                  still lines up with the label above it and the chip below —
                  a native select's own chevron would inset the text instead. */}
              <span aria-hidden className="text-[10px] text-neutral-400 dark:text-neutral-500">
                ▾
              </span>
              <select
                value={ym}
                disabled={saving || !ym}
                onChange={(e) => set(e.target.value)}
                aria-label="Billing month — every non-Sunset bill files into this month"
                className={`cursor-pointer appearance-none rounded bg-transparent p-0 text-right text-[21px] font-bold leading-tight tracking-tight focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-default ${
                  stale ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {/* The month in force first, so a set month that has scrolled off
                  the 15-month list still shows what it is. */}
                {ym && !months.some((m) => m.value === ym) && (
                  <option value={ym}>{monthLabel(ym)}</option>
                )}
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p
              className={`mt-1 min-h-[26px] text-[21px] font-bold leading-tight tracking-tight ${
                stale ? "text-red-600 dark:text-red-400" : ""
              }`}
            >
              {ym ? monthLabel(ym) : ""}
            </p>
          )}
          <div className="mt-1 flex items-center justify-end gap-2">
            {err ? (
              <span role="alert" className="text-[11.5px] text-red-600 dark:text-red-400">
                {err}
              </span>
            ) : stale ? (
              <Chip tone="danger">
                Switch to {monthLabel(nextMonth(ym)).replace(/ \d{4}$/, "")}
              </Chip>
            ) : (
              // "Automatic" is the state before anyone picks a month: the 10th
              // still rolls it over on its own. Picking one ends that for good.
              <MetaLine items={[auto ? "Automatic — rolls on the 10th" : "Bills arriving today"]} />
            )}
          </div>
        </div>
      )}
    </header>
  );
}

/** "2026-09" → "2026-10". The month the stale chip points at. */
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
