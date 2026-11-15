"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { Dialog } from "@/components/Dialog";
import { Button, btn } from "@/components/ui";
import { cached, forgetFact } from "@/lib/homeFacts";
import { lswddDayLabel } from "@/lib/lswddPay";
import { money } from "@/lib/money";

const FACT = "lswdd-reminder";

interface Reminder {
  lastPayDay: string;
  overdue: boolean;
  unpaid: number;
  total: number;
  today: string;
}

/**
 * The pop-up that says "Pay LSWDD by <day>". Mounted once in the root layout.
 *
 * The statement is due the 10th, and LSWDD is open Friday to Monday only. The
 * pop-up starts the day before the last open day on or before the due date
 * (`lswddPayReminder`, src/lib/lswddPay.ts) and keeps coming back each day
 * until every bill on the newest statement is paid.
 *
 * /api/lswdd/reminder decides, and puts the reminder in the reader's own row
 * of the findings inbox. "Later" snoozes that row until midnight, on every
 * device; a snooze or dismissal in the inbox hides the pop-up too.
 *
 * Shown only to a role with the `lswdd` view, and not on /lswdd itself — that
 * page shows the same bills.
 */
export function LswddPayReminder() {
  const access = useAccess();
  const pathname = usePathname();
  const allowed = access.can("lswdd");
  const [state, setState] = useState<Reminder | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    cached(FACT, 10 * 60_000, async () => {
      const r = await fetch("/api/lswdd/reminder");
      if (!r.ok) throw new Error(String(r.status));
      return ((await r.json()).reminder ?? null) as Reminder | null;
    })
      .then((r) => {
        if (alive) setState(r);
      })
      .catch(() => {
        /* a failed read shows nothing — never a false alarm */
      });
    return () => {
      alive = false;
    };
  }, [allowed]);

  const dismiss = useCallback(() => {
    setState(null);
    forgetFact(FACT);
    fetch("/api/lswdd/reminder", { method: "POST" }).catch(() => {});
  }, []);

  if (!allowed || !state || pathname?.startsWith("/lswdd")) return null;

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
