"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { Dialog } from "@/components/Dialog";
import { Button, btn } from "@/components/ui";
import { companyToday, lswddStatementBills } from "@/lib/homeFacts";
import { lswddDayLabel, lswddPayReminder } from "@/lib/lswddPay";
import { money } from "@/lib/money";

const DISMISS_KEY = "lswdd.payReminder.dismissed";

/**
 * The pop-up that says "Pay LSWDD by <day>". Mounted once in the root layout.
 *
 * The statement is due the 10th, and LSWDD is open Friday to Monday only. The
 * pop-up starts the day before the last open day on or before the due date
 * (`lswddPayReminder`, src/lib/lswddPay.ts) and keeps coming back each day
 * until every bill on the newest statement is paid. "Later" hides it for the
 * rest of the day on this device.
 *
 * Shown only to a role with the `lswdd` view, and not on /lswdd itself — that
 * page shows the same bills.
 */
export function LswddPayReminder() {
  const access = useAccess();
  const pathname = usePathname();
  const allowed = access.can("lswdd");
  const [state, setState] = useState<{
    lastPayDay: string;
    overdue: boolean;
    unpaid: number;
    total: number;
    today: string;
  } | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    const today = companyToday();
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === today);
    } catch {
      setDismissed(false);
    }
    lswddStatementBills()
      .then((s) => {
        const open = s.bills.filter((b) => b.payState !== "paid");
        const r = lswddPayReminder({ today, dueDate: s.dueDate, unpaid: open.length });
        if (!alive) return;
        setState(
          r
            ? {
                ...r,
                unpaid: open.length,
                total: open.reduce((n, b) => n + b.cost - b.amountPaid, 0),
                today,
              }
            : null,
        );
      })
      .catch(() => {
        /* a failed read shows nothing — never a false alarm */
      });
    return () => {
      alive = false;
    };
  }, [allowed]);

  const dismiss = useCallback(() => {
    try {
      if (state) localStorage.setItem(DISMISS_KEY, state.today);
    } catch {
      /* storage blocked — hidden until the next load */
    }
    setDismissed(true);
  }, [state]);

  if (!allowed || !state || dismissed || pathname?.startsWith("/lswdd")) return null;

  const day = lswddDayLabel(state.lastPayDay);
  const title = state.overdue
    ? "LSWDD statement is past due"
    : state.lastPayDay === state.today
      ? "Pay LSWDD today"
      : `Pay LSWDD by ${day}`;

  return (
    <Dialog
      onClose={dismiss}
      role="alertdialog"
      label={title}
      footer={
        <>
          <Link href="/lswdd" onClick={dismiss} className={btn("primary", "md", "flex-1")}>
            Open LSWDD bills
          </Link>
          <Button variant="secondary" onClick={dismiss}>
            Later
          </Button>
        </>
      }
    >
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-neutral-500">
        {state.unpaid} bill{state.unpaid === 1 ? "" : "s"} unpaid · {money(state.total)}. The
        statement is due the 10th, and LSWDD is open Friday to Monday only.{" "}
        {state.overdue ? `The last open day was ${day}.` : `The last open day to pay is ${day}.`}
      </p>
    </Dialog>
  );
}
