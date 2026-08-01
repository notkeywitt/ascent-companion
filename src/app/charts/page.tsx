"use client";

import { BarChart, PieChart } from "@/components/charts";
import { Card, PageHeader, SectionLabel } from "@/components/ui";

/**
 * Chart-template gallery — a live reference for the brand-styled BarChart and
 * PieChart in components/charts. Not wired into the home launcher; reach it at
 * /charts. Copy any block below as a starting point.
 *
 * Sample numbers are illustrative construction data (budget, spend, draws), not
 * live JobTread reads — these components take whatever `data` you hand them.
 */

// Spend by month — one measure across categories → single-series (accent) bars.
const SPEND_BY_MONTH = [
  { label: "Feb", value: 82_400 },
  { label: "Mar", value: 118_900 },
  { label: "Apr", value: 96_300 },
  { label: "May", value: 141_200 },
  { label: "Jun", value: 127_800 },
  { label: "Jul", value: 154_600 },
];

// Budget by CSI division — distinct categories → categorical bars, horizontal
// so the long names have room.
const BUDGET_BY_DIVISION = [
  { label: "Concrete", value: 68_000 },
  { label: "Framing / Wood", value: 152_000 },
  { label: "Roofing", value: 41_500 },
  { label: "Electrical", value: 58_200 },
  { label: "Plumbing", value: 47_900 },
  { label: "Finishes", value: 93_400 },
];

// Cost breakdown — a composition of a whole → donut.
const COST_MIX = [
  { label: "Labor", value: 214_000 },
  { label: "Materials", value: 176_500 },
  { label: "Subcontractors", value: 132_000 },
  { label: "Equipment", value: 38_400 },
  { label: "Permits & Fees", value: 12_800 },
  { label: "Overhead", value: 21_600 },
  { label: "Misc", value: 6_400 },
  { label: "Bonds", value: 4_100 },
];

export default function ChartsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <PageHeader
        title="Chart templates"
        description="Brand-styled, dependency-free bar and pie/donut charts. Import { BarChart, PieChart } from @/components/charts."
      />

      <div className="space-y-5">
        <Card>
          <SectionLabel className="mb-3">Bar — single series (brand accent)</SectionLabel>
          <BarChart data={SPEND_BY_MONTH} />
        </Card>

        <Card>
          <SectionLabel className="mb-3">Bar — horizontal, categorical</SectionLabel>
          <BarChart data={BUDGET_BY_DIVISION} horizontal categorical />
        </Card>

        <Card>
          <SectionLabel className="mb-3">Donut — cost mix</SectionLabel>
          <PieChart data={COST_MIX} centerLabel="Job cost" />
        </Card>

        <Card>
          <SectionLabel className="mb-3">Pie — solid, legend below</SectionLabel>
          <PieChart data={COST_MIX.slice(0, 4)} solid legend="bottom" centerLabel="" />
        </Card>
      </div>
    </main>
  );
}
