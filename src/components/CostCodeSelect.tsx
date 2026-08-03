"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface Option {
  id: string;
  number: string;
  name: string; // the cost CODE's name — identical on every row under that code
  detail?: string; // this row's own name ("Wood Decking - Labor", "Punch List")
  costType?: string; // Labor / Materials / Subcontractor / Other
  cost?: number; // this row's estimated amount; 0 = placeholder nobody budgeted
}

/**
 * An estimate routinely splits one cost code into several budget rows, each its
 * own coding target, and every one of them reports the SAME cost-code name — so
 * listing them flat shows the same line two or three times with nothing to tell
 * them apart. Live budgets contain both kinds of split:
 *
 *   - MEANINGFUL — "06 15 00 Wood Decking" as Labor $6,000 / Materials $1,760 /
 *     Allowance $400, or "01 00 00 General Requirements" as three Labor rows named
 *     Permits and Fees, Punch List, Electrical Trim-out. Which one you want is a
 *     real decision, so these stay pickable, gathered under one heading.
 *   - NOT MEANINGFUL — "07 46 23 Wood Siding" as three rows all typed Other, all
 *     named "Wood Siding", differing only in amount (estimate revisions and change
 *     orders piling onto one code). Nothing distinguishes them on screen, so
 *     offering all three is a coin flip; they collapse to one entry.
 *
 * The test is therefore whether the rows are DISTINGUISHABLE, not whether they're
 * funded: rows are labelled by what actually differs (their own name, falling back
 * to cost type), rows sharing a label merge into the best-funded one, and a code
 * left with a single label renders as one plain entry. Placeholder rows budgeted
 * at zero drop out whenever a funded sibling exists. When a collapsed entry stands
 * for several rows it still shows the label it resolved to, so nothing is silent.
 */

const SEPARATORS = /^[\s\-–—:·]+/;
const TRAILING_SEPARATORS = /[\s\-–—:·]+$/;

/** Longest shared leading text across the rows, so it can be trimmed off each label. */
function commonPrefix(values: string[]): string {
  if (values.length < 2) return "";
  let prefix = values[0];
  for (const v of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < v.length && prefix[i].toLowerCase() === v[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix.replace(TRAILING_SEPARATORS, "");
}

/**
 * What visibly distinguishes each row within its cost code. Rows are named as
 * variations on one theme — "Wood Decking - Labor" / "- Material" / "- Allowance"
 * — so the shared part is trimmed and only the distinguishing tail is shown. A row
 * named exactly like its code says nothing, and falls back to its cost type.
 */
function labelsFor(pool: Option[], codeName: string): string[] {
  const code = codeName.trim();
  const leaves = pool.map((r) => (r.detail ?? "").trim());
  const shared = commonPrefix(leaves);
  return pool.map((row, i) => {
    const leaf = leaves[i];
    for (const base of [shared, code]) {
      if (base.length >= 3 && leaf.toLowerCase().startsWith(base.toLowerCase())) {
        const rest = leaf.slice(base.length).replace(SEPARATORS, "").trim();
        if (rest) return rest;
      }
    }
    if (leaf && leaf.toLowerCase() !== code.toLowerCase()) return leaf;
    return (row.costType ?? "").trim() || "Untyped";
  });
}

/** One selectable target: the best-funded row among those that look identical. */
interface Choice {
  id: string;
  label: string;
  cost?: number;
  merged: number; // how many rows this entry stands for
}

interface CodeGroup {
  number: string;
  name: string;
  rowCount: number; // rows before consolidation — drives whether to show the label
  choices: Choice[];
  haystack: string;
}

function groupByCode(options: Option[]): CodeGroup[] {
  const byCode = new Map<string, Option[]>();
  for (const o of options) {
    const list = byCode.get(o.number);
    if (list) list.push(o);
    else byCode.set(o.number, [o]);
  }

  const groups: CodeGroup[] = [];
  for (const [number, all] of byCode) {
    const codeName = all[0].name ?? "";
    // A row budgeted at zero is a placeholder. Where a code has funded rows, the
    // zeros drop out. Where NOTHING under the code is funded there is no budget to
    // split, and what's left is bookkeeping — an empty Labor twin, or the spec
    // notes that collect on catch-all codes ("Danby Designer", "Den Island 1G
    // Outlet"). Those are not coding decisions, so the code becomes one entry.
    const funded = all.filter((r) => (r.cost ?? 0) !== 0);
    const pool = funded.length ? funded : all.slice(0, 1);

    const labels = labelsFor(pool, codeName);
    const buckets = new Map<string, { label: string; rows: Option[] }>();
    pool.forEach((row, i) => {
      const label = labels[i];
      const key = label.toLowerCase();
      const bucket = buckets.get(key);
      if (bucket) bucket.rows.push(row);
      else buckets.set(key, { label, rows: [row] });
    });

    const choices: Choice[] = [];
    for (const { label, rows } of buckets.values()) {
      // Indistinguishable rows: take the biggest budget — the primary line, with
      // the rest being smaller revisions against the same code.
      const best = rows.reduce((a, b) => ((b.cost ?? 0) > (a.cost ?? 0) ? b : a));
      choices.push({ id: best.id, label, cost: best.cost, merged: rows.length });
    }
    choices.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));

    groups.push({
      number,
      name: codeName,
      rowCount: all.length,
      choices,
      haystack: `${number} ${codeName} ${all.map((r) => `${r.name ?? ""} ${r.costType ?? ""}`).join(" ")}`.toLowerCase(),
    });
  }
  return groups.sort((a, b) => a.number.localeCompare(b.number));
}

const amount = (n?: number) =>
  typeof n === "number" && n !== 0
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

/** Lightweight searchable cost-code dropdown (no external deps). */
export function CostCodeSelect({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupByCode(options), [options]);
  const selected = options.find((o) => o.id === value);
  // The label only earns its space on codes that actually had more than one row.
  const selectedLabel = useMemo(() => {
    if (!selected) return "";
    const g = groups.find((x) => x.number === selected.number);
    if (!g || g.rowCount < 2) return "";
    // A line already coded to a row this list consolidated away still names its
    // own row, so what's on the bill is never misreported as something else.
    return g.choices.find((c) => c.id === selected.id)?.label ?? labelsFor([selected], g.name)[0];
  }, [selected, groups]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? groups.filter((g) => g.haystack.includes(q)) : groups;

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-2 text-left font-mono text-xs transition hover:border-accent dark:border-neutral-600 dark:bg-ink"
      >
        <span className={"truncate " + (selected ? "" : "text-neutral-400")}>
          {selected ? `${selected.number} — ${selected.name}` : "— uncoded —"}
          {selectedLabel && <span className="text-neutral-500"> · {selectedLabel}</span>}
        </span>
        <span className="text-neutral-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 flex max-h-72 w-full flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-lg dark:border-neutral-700 dark:bg-ink-overlay">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code or name…"
            className="border-b border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/10"
          />
          <ul className="overflow-auto">
            <li>
              <button
                type="button"
                onClick={() => pick("")}
                className="w-full px-3 py-2 text-left text-xs text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/5"
              >
                — uncoded —
              </button>
            </li>

            {filtered.map((g) =>
              g.choices.length === 1 ? (
                <li key={g.number}>
                  <button
                    type="button"
                    onClick={() => pick(g.choices[0].id)}
                    className={
                      "flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-white/5 " +
                      (g.choices[0].id === value ? "bg-neutral-100 dark:bg-white/5" : "")
                    }
                  >
                    <span className="font-mono font-medium">{g.number}</span>
                    <span className="min-w-0 flex-1 truncate text-neutral-500">{g.name}</span>
                    {/* Several rows behind one entry — name the one it codes to. */}
                    {g.rowCount > 1 && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">
                        {g.choices[0].label}
                      </span>
                    )}
                  </button>
                </li>
              ) : (
                <li key={g.number}>
                  <div className="flex items-baseline gap-2 px-3 pb-1 pt-2">
                    <span className="font-mono text-xs font-medium">{g.number}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">
                      {g.name}
                    </span>
                  </div>
                  {g.choices.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pick(c.id)}
                      className={
                        "flex w-full items-baseline gap-2 py-1.5 pl-8 pr-3 text-left text-xs hover:bg-neutral-100 dark:hover:bg-white/5 " +
                        (c.id === value ? "bg-neutral-100 dark:bg-white/5" : "")
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-neutral-400">
                        {amount(c.cost)}
                      </span>
                    </button>
                  ))}
                </li>
              ),
            )}

            {filtered.length === 0 && (
              <li className="px-3 py-3 text-xs text-neutral-500">No matching cost code</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
