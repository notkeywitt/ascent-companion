"use client";

import { useEffect, useState } from "react";
import { Button, Chip, Dialog, MetaLine } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { COMPANY_TZ, billingMonthStale } from "@/lib/billing";
import { billingMonths, monthLabel } from "@/lib/billingMonths";
import { MonthPicker } from "@/components/MonthPicker";
import { MonthCloseChip } from "@/components/MonthClose";
import { closedMonthWarning } from "@/lib/monthClose";

/**
 * The head of the iPad home console — a dateline, and where the billing month
 * stands.
 *
 * THE DATELINE EXISTS ONLY AT `pad` AND UP. The billing month shows at every
 * width (phones since 2026-09-29: before that nobody on a phone could set it).
 * The home page deliberately carries no <h1> on a phone: a title plus its
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
 * Office and admin change it; anyone else with `recode` sees it read-only. It
 * decides where money lands
 * org-wide, so the write is role-checked at /api/billing-month too — this is
 * only which control renders. Gated on `recode` overall: a role that never
 * codes a bill has no decision to make here.
 *
 * The date is read in an effect, not at render. This component is server-
 * rendered too, and a server in UTC would disagree with an iPad in Pacific
 * about which day it is — a hydration mismatch that throws away the whole tree.
 * The band keeps its height while that resolves, so nothing shifts.
 */
/** The billing month as the server read it (src/app/page.tsx). */
export interface MastheadMonth {
  ym: string;
  /** "" while the 10th cutoff is deciding. */
  override: string;
}

/** `notices`: Home's banners, drawn compact in the band between the date and the
 *  billing month (owner, 2026-11-02). `month`: the server's read, which saves
 *  the fetch; without it (the /widget page) the masthead reads it itself.
 *  `backdrop`: drawn behind the whole line — the office Home's year ribbon
 *  (owner, 2026-11-15). It fills the band and takes no taps. */
export function HomeMasthead({
  notices,
  month,
  backdrop,
}: { notices?: React.ReactNode; month?: MastheadMonth; backdrop?: React.ReactNode } = {}) {
  const access = useAccess();
  const [today, setToday] = useState<Date | null>(null);
  const [ym, setYm] = useState(month?.ym ?? "");
  /** True until someone picks a month: the 10th cutoff is still deciding. */
  const [auto, setAuto] = useState(month ? !month.override : false);
  const [saving, setSaving] = useState(false);
  /** Why the last save bounced. The month snaps back, so say why it did. */
  const [err, setErr] = useState("");
  /** The tracking sheets' month, from the month-close chip. "" until it reads. */
  const [sheetsYm, setSheetsYm] = useState("");
  /** A pick into a closed month, waiting on the warning. */
  const [confirmYm, setConfirmYm] = useState("");

  useEffect(() => setToday(new Date()), []);

  const shows = access.can("recode");
  const given = !!month;
  useEffect(() => {
    if (!shows || given) return;
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
  }, [shows, given]);

  // BOTH halves read the COMPANY timezone, not the device's. The billing month
  // has to (a bill uploaded at 11 PM Pacific on the 10th must not count as the
  // 11th — see billing.ts), and a date beside it that used the device's zone
  // would disagree with it for part of every day.
  // "Wednesday the 30th": no month, because the billing month is on the right.
  const dateLine = (() => {
    if (!today) return "";
    const zone = { timeZone: COMPANY_TZ };
    const weekday = today.toLocaleDateString("en-US", { ...zone, weekday: "long" });
    const day = Number(today.toLocaleDateString("en-US", { ...zone, day: "numeric" }));
    const tail = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
    return `${weekday} the ${day}${tail}`;
  })();

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
  //
  // A month the tracking sheets have closed asks first (warn, not block):
  // bills filed into it miss that month's record block (src/lib/monthClose.ts).
  function pick(next: string) {
    if (next === ym) return;
    if (closedMonthWarning(next, sheetsYm)) return setConfirmYm(next);
    void set(next);
  }

  async function set(next: string) {
    if (next === ym) return;
    setConfirmYm("");
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
    // On a phone only the billing month shows, and only to a role that has one.
    <header
      className={`relative mb-3 items-end justify-between gap-6 border-b border-line pb-2 pad:mb-6 pad:pb-4 ${
        shows ? "flex" : "hidden pad:flex"
      } ${backdrop ? "min-h-14 pad:min-h-20" : ""}`}
    >
      {backdrop}
      {/* The office Home (the one with the ribbon behind it) shows the day on a
          phone too, smaller (owner, 2026-11-15). Every other Home keeps its
          no-title phone layout. */}
      <div className={`relative order-1 min-w-0 ${backdrop ? "" : "hidden pad:block"}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          {/* min-h keeps the band's height across the one frame before the
              effect above knows what day it is. */}
          <h1 className="min-h-[26px] truncate text-[17px] font-bold leading-tight tracking-tight pad:text-[21px]">
            {dateLine}
          </h1>
        </div>
      </div>

      {notices && (
        // Empty when every banner is quiet: each one renders nothing then.
        <div className="relative order-3 flex min-w-0 flex-1 flex-col items-center gap-1.5 self-center empty:hidden">{notices}</div>
      )}

      {shows && (
        <div className="relative order-2 shrink-0">
          {/* A quiet native select: it reads as the heading it replaced until
              you touch it, and on a tablet it opens the OS month wheel. */}
          {canSet ? (
            <div className="flex min-h-[26px] items-center justify-end">
              <MonthPicker
                value={ym}
                options={months}
                onChange={pick}
                disabled={saving}
                ariaLabel="Billing month — every non-Sunset bill files into this month"
                className={stale ? "text-danger" : ""}
              />
            </div>
          ) : (
            <p
              className={`min-h-[26px] text-[21px] font-bold leading-tight tracking-tight ${
                stale ? "text-danger" : ""
              }`}
            >
              {ym ? monthLabel(ym) : ""}
            </p>
          )}
          {(err || stale || auto) && (
            <div className="mt-1 flex items-center justify-end gap-2">
              {err ? (
                <span role="alert" className="text-[12px] text-danger">
                  {err}
                </span>
              ) : stale ? (
                <Chip tone="danger">
                  Switch to {monthLabel(nextMonth(ym)).replace(/ \d{4}$/, "")}
                </Chip>
              ) : (
                // "Automatic" is the state before anyone picks a month: the 10th
                // still rolls it over on its own. Picking one ends that for good.
                <MetaLine items={["Automatic — rolls on the 10th"]} />
              )}
            </div>
          )}
          {/* Where the tracking sheets' month close stands (src/components/MonthClose.tsx). */}
          {ym && access.can("tracking-sheet") && (
            <div className="mt-1 flex justify-end">
              <MonthCloseChip homeYm={ym} onSheetsYm={setSheetsYm} />
            </div>
          )}
          {closedMonthWarning(ym, sheetsYm) && (
            <p className="mt-1 max-w-xs text-[12px] text-warn">{closedMonthWarning(ym, sheetsYm)}</p>
          )}
          {confirmYm && (
            <Dialog
              onClose={() => setConfirmYm("")}
              title={`Move to ${monthLabel(confirmYm)}?`}
              description={closedMonthWarning(confirmYm, sheetsYm)}
              footer={
                <div className="grid w-full grid-cols-2 gap-2">
                  <Button variant="secondary" className="min-h-11 w-full" onClick={() => setConfirmYm("")}>
                    Cancel
                  </Button>
                  <Button className="min-h-11 w-full" onClick={() => void set(confirmYm)}>
                    Move anyway
                  </Button>
                </div>
              }
            />
          )}
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
