"use client";

import { useId, useMemo, useState } from "react";

import { Input } from "@/components/ui";
import { suggestPlaces, type PlaceJob } from "@/lib/mileagePlace";

/**
 * A From/To field with its own suggestion list. As the driver types, the jobs
 * and known places that fit drop down under the box; a tap fills the field
 * with that name. A browser <datalist> was tried first — iOS Safari shows it as
 * a strip above the keyboard, not a list under the field.
 *
 * Typing anything else still works: the text goes to Google as an address.
 */
export function PlaceInput({
  id,
  value,
  onChange,
  jobs,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  jobs: PlaceJob[];
  placeholder?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const suggestions = useMemo(() => suggestPlaces(value, jobs), [value, jobs]);
  // A field that already holds the one place it suggests needs no list.
  const settled = suggestions.length === 1 && suggestions[0].label === value.trim();
  const show = open && suggestions.length > 0 && !settled;

  function choose(label: string) {
    onChange(label);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!show) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(suggestions[active].label);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
      />
      {show && (
        // z-40: above the tab bar (z-30), below the modals (z-50).
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 divide-y divide-line-soft overflow-y-auto overscroll-contain rounded-lg border border-line bg-white shadow-lg dark:bg-ink-overlay"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.label}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: it lands before the field's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s.label);
              }}
              className={`cursor-pointer px-3 py-2.5 ${
                i === active ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              }`}
            >
              <div className="text-sm font-medium">{s.label}</div>
              <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {s.address || "No address in JobTread"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
