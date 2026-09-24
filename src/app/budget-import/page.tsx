"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  Select,
  StatementBlock,
} from "@/components/ui";
import JtImport from "./JtImport";

/**
 * Budget Import — a job's tracking-sheet estimate as a CSV that JobTread's
 * Budget → Import reads, so a new budget is never typed in by hand.
 *
 * Apps Script (BudgetImport.js) reads the sheet's Contract Estimate columns and
 * maps each priced bucket to one cost item. The CSV carries COSTS plus the one
 * markup typed here, set on every item. It never carries a price: markups
 * differ by job, so JobTread computes each price from the cost and the markup.
 * The CSV path writes nothing. "Import into JT" (JtImport.tsx) is the path that
 * writes: it updates the job's live budget in place.
 */

interface Job {
  id: string;
  label: string;
}

interface Item {
  costGroup: string;
  name: string;
  description: string;
  quantity: number | "";
  unit: string;
  unitCost: number;
  costType: string;
  costCode: string;
}

interface Result {
  fileName: string;
  csv: string;
  items: Item[];
  total: number;
  sheetTotal: number | null;
  problems: string[];
  /** The markup percent this CSV was built with. */
  markup: number;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const cost = (it: Item) => (it.quantity === "" ? 1 : it.quantity) * it.unitCost;

async function readJson(r: Response) {
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.ok === false || b.error) throw new Error(b.error || `HTTP ${r.status}`);
  return b;
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BudgetImportPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [markup, setMarkup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    fetch("/api/budget-import")
      .then(readJson)
      .then((b) => setJobs(b.jobs || []))
      .catch((e) => {
        setError(e.message);
        setJobs([]);
      });
  }, []);

  async function build() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/budget-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, markup: Number(markup) }),
      });
      setResult({ ...(await readJson(r)), markup: Number(markup) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Items in sheet order, one section per cost group.
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of result?.items || []) m.set(it.costGroup, [...(m.get(it.costGroup) || []), it]);
    return [...m];
  }, [result]);

  const markupOk = markup.trim() !== "" && Number(markup) >= 0 && Number(markup) < 1000;
  const matches = result?.sheetTotal != null && Math.abs(result.total - result.sheetTotal) < 0.005;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Budget Import"
        description="Turn a job's tracking-sheet estimate into a CSV for JobTread's Budget → Import."
      />

      {error && <Banner tone="error" className="mb-4">{error}</Banner>}

      {jobs === null ? (
        <Loading label="Loading tracking sheets…" />
      ) : jobs.length === 0 ? (
        <EmptyState>
          No project is wired to a tracking sheet. Put the sheet&apos;s URL in the Tracking Sheet
          column of the job&apos;s Projects row.
        </EmptyState>
      ) : (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div>
              <Label htmlFor="bi-job">Job</Label>
              <Select id="bi-job" value={projectId} onChange={(e) => { setProjectId(e.target.value); setResult(null); }}>
                <option value="">Choose a job…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="bi-markup">Markup %</Label>
              <Input
                id="bi-markup"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                placeholder="18"
                value={markup}
                onChange={(e) => { setMarkup(e.target.value); setResult(null); }}
              />
            </div>
          </div>
          <Button onClick={build} disabled={!projectId || !markupOk || busy}>
            {busy ? "Reading the sheet…" : "Build CSV"}
          </Button>
        </Card>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <StatementBlock
            label="Budget cost"
            value={money(result.total)}
            sub={
              <MetaLine
                items={[
                  `${result.items.length} items`,
                  `${result.markup}% markup`,
                  result.sheetTotal == null
                    ? "no sheet Subtotal to check against"
                    : matches
                      ? "✓ matches the sheet's Subtotal"
                      : `sheet Subtotal ${money(result.sheetTotal)}`,
                ]}
              />
            }
            footnote={`Costs from the sheet, with ${result.markup}% markup on every item. JobTread computes each price when you import it on the job's Budget tab.`}
          />

          {result.problems.length > 0 && (
            <Banner tone="warning">
              <p className="font-semibold">
                {result.problems.length === 1 ? "1 problem" : `${result.problems.length} problems`} on the sheet
              </p>
              <ul className="mt-1 list-inside list-disc">
                {result.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </Banner>
          )}

          <Button onClick={() => download(result.fileName, result.csv)} disabled={result.items.length === 0}>
            Download CSV
          </Button>

          {/* Changing the job or the markup clears `result`, which unmounts this
              and drops any preview built for the old pair. */}
          <JtImport projectId={projectId} markup={result.markup} />

          {groups.map(([group, items]) => (
            <section key={group} className="space-y-2">
              <SectionHeading>{group}</SectionHeading>
              <ListCard>
                {items.map((it) => (
                  <ListRow
                    key={it.name + it.costType}
                    label={it.name}
                    desc={
                      <MetaLine
                        items={[
                          it.costType,
                          it.quantity === ""
                            ? it.unit
                            : `${it.quantity.toLocaleString()} ${it.unit} × ${money(it.unitCost)}`,
                        ]}
                      />
                    }
                    trailing={<span className="shrink-0 text-sm tabular-nums">{money(cost(it))}</span>}
                  />
                ))}
              </ListCard>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
