"use client";

import Link from "next/link";
import { useState } from "react";
import { Banner, Button, Card, Select, btn } from "@/components/ui";
import { TimeEntriesEmailButton } from "@/app/employee-time/TimeEntriesEmailButton";

/**
 * Payroll's PAY PERIOD section (stage 5): pick the half month once, then send
 * its time-entries email and, for the month, the all-drivers miles PDF — the
 * two pay-period outputs that lived on Time and Miles.
 */
function recentMonths(n = 6): { value: string; label: string }[] {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/** The half month just finished, or the one in progress on the 15th/last day. */
function defaultPeriod(): { ym: string; half: "a" | "b" } {
  const d = new Date();
  if (d.getDate() >= 16) {
    return { ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, half: "a" };
  }
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, half: "b" };
}

export function PayPeriod() {
  const months = recentMonths();
  const [{ ym, half }, setPeriod] = useState(defaultPeriod);
  const [pdf, setPdf] = useState<{ busy: boolean; url: string; err: string }>({ busy: false, url: "", err: "" });

  const milesPdf = async () => {
    setPdf({ busy: true, url: "", err: "" });
    try {
      const res = await fetch("/api/mileage/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: ym }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) setPdf({ busy: false, url: "", err: j.error || "Could not create the PDF." });
      else setPdf({ busy: false, url: j.pdfUrl || "", err: "" });
    } catch (e) {
      setPdf({ busy: false, url: "", err: e instanceof Error ? e.message : "Could not create the PDF." });
    }
  };

  return (
    <section className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Month"
          className="w-auto"
          value={ym}
          onChange={(e) => {
            setPeriod((p) => ({ ...p, ym: e.target.value }));
            setPdf({ busy: false, url: "", err: "" });
          }}
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Half of the month"
          className="w-auto"
          value={half}
          onChange={(e) => setPeriod((p) => ({ ...p, half: e.target.value as "a" | "b" }))}
        >
          <option value="a">1st–15th</option>
          <option value="b">16th–end</option>
        </Select>
      </Card>

      <TimeEntriesEmailButton key={`${ym}-${half}`} ym={ym} half={half} />

      <div className="space-y-2">
        <Button variant="secondary" className="min-h-11 w-full" onClick={milesPdf} disabled={pdf.busy}>
          {pdf.busy ? "Creating the miles PDF…" : "Create the month's miles PDF (all drivers)"}
        </Button>
        {pdf.err && <Banner tone="error">Miles PDF: {pdf.err}</Banner>}
        {pdf.url && (
          <Banner tone="success">
            <a href={pdf.url} target="_blank" rel="noreferrer" className="font-semibold underline">
              Open the miles PDF in Drive ↗
            </a>
          </Banner>
        )}
      </div>

      <Link href="/employee-time" className={btn("ghost", "md", "w-full")}>
        Review an employee&apos;s timesheet →
      </Link>
    </section>
  );
}
