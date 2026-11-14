"use client";

import { useEffect, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { closedMonthWarning } from "@/lib/monthClose";

/** The sheets' month, read once per page (the route caches the list 5 minutes). */
let sheetsYmOnce: Promise<string> | null = null;
function readSheetsYm(): Promise<string> {
  sheetsYmOnce ??= fetch("/api/tracking-sheet")
    .then((r) => r.json())
    .then((b) => (b?.defaultYear ? `${b.defaultYear}-${String(b.defaultMonth).padStart(2, "0")}` : ""))
    .catch(() => "");
  return sheetsYmOnce;
}

/**
 * A warning under a bill's billing month when that month is closed on the
 * tracking sheets (warn, not block; src/lib/monthClose.ts). Renders nothing
 * without the Tracking Sheets view or for an open month.
 */
export function ClosedMonthNote({ ym, className = "" }: { ym: string; className?: string }) {
  const access = useAccess();
  const can = access.can("tracking-sheet");
  const [sheetsYm, setSheetsYm] = useState("");
  useEffect(() => {
    if (can) void readSheetsYm().then(setSheetsYm);
  }, [can]);
  const warn = closedMonthWarning(ym, sheetsYm);
  return warn ? <p className={`mt-1 text-[12px] text-warn ${className}`}>{warn}</p> : null;
}
