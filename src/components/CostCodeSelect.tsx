"use client";

import { useEffect, useRef, useState } from "react";

export interface Option {
  id: string;
  number: string;
  name: string;
}

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

  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => `${o.number} ${o.name}`.toLowerCase().includes(q))
    : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-2 text-left font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
      >
        <span className={selected ? "" : "text-neutral-400"}>
          {selected ? `${selected.number} — ${selected.name}` : "— uncoded —"}
        </span>
        <span className="text-neutral-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 flex max-h-72 w-full flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code or name…"
            className="border-b border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-neutral-800"
          />
          <ul className="overflow-auto">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-xs text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                — uncoded —
              </button>
            </li>
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="font-mono font-medium">{o.number}</span>{" "}
                  <span className="text-neutral-500">{o.name}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-xs text-neutral-500">No matching cost code</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
