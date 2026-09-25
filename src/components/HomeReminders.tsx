"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccess } from "@/components/AccessProvider";
import { monthLabel } from "@/lib/billingMonths";
import { lastAmazonMonth, lastLswddMonth, previousMonth } from "@/lib/homeFacts";

/**
 * The short list of dated to-dos under "Today" on the home masthead — the jobs
 * that come round on the calendar and nothing else announces, like a month's
 * Amazon import.
 *
 * TO ADD ONE, add an entry to REMINDERS. `view` gates it (nobody is reminded of
 * a page they can't open) and `due` answers "is it due now?" with the line to
 * show, or null. `due` gets the month before today, since most of these are a
 * month-end job done in the following month. A reminder whose check fails is
 * left off, never shown as due.
 */
interface Reminder {
  id: string;
  view: string;
  href: string;
  due: (ctx: { prevYm: string }) => Promise<string | null>;
}

/** Due while the last month handled is older than last month. "" means never handled. */
const behind = (last: string, prevYm: string) => last < prevYm;

const REMINDERS: Reminder[] = [
  {
    id: "amazon",
    view: "amazon-import",
    href: "/amazon-import",
    due: async ({ prevYm }) =>
      behind(await lastAmazonMonth(), prevYm) ? `Import Amazon for ${monthLabel(prevYm)}` : null,
  },
  {
    id: "lswdd",
    view: "lswdd",
    href: "/lswdd",
    due: async ({ prevYm }) =>
      behind(await lastLswddMonth(), prevYm) ? `Import LSWDD for ${monthLabel(prevYm)}` : null,
  },
];

export function HomeReminders() {
  const access = useAccess();
  const [due, setDue] = useState<{ id: string; href: string; text: string }[]>([]);

  useEffect(() => {
    let alive = true;
    const ctx = { prevYm: previousMonth() };
    Promise.all(
      REMINDERS.filter((r) => access.can(r.view)).map((r) =>
        r
          .due(ctx)
          .then((text) => (text ? { id: r.id, href: r.href, text } : null))
          .catch(() => null),
      ),
    ).then((rows) => {
      if (alive) setDue(rows.filter((x): x is NonNullable<typeof x> => x !== null));
    });
    return () => {
      alive = false;
    };
  }, [access]);

  if (due.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5">
      {due.map((d) => (
        <li key={d.id}>
          <Link
            href={d.href}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700 transition hover:text-accent dark:text-neutral-300"
          >
            <span aria-hidden className="text-accent">
              →
            </span>
            {d.text}
          </Link>
        </li>
      ))}
    </ul>
  );
}
