"use client";

/**
 * A file picker that looks like the app: a dashed drop zone with a label, in
 * place of the browser's own "Choose file / No file chosen" control, which
 * drew differently on every page and could not follow the theme.
 *
 * It takes the same props as an `<input type="file">` and passes them to a
 * real one, so a caller's `onChange`, `accept`, `multiple` and `ref` work
 * unchanged. A file dropped on the zone is handed to that same input and
 * fires the same `onChange`, so there is one code path for both.
 */

import { useRef, useState } from "react";

export function FileDrop({
  label,
  hint,
  className = "",
  onChange,
  ref,
  ...input
}: Omit<React.ComponentProps<"input">, "type" | "className"> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  const own = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [picked, setPicked] = useState("");

  const setRef = (el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const el = own.current;
    if (!el || input.disabled || !e.dataTransfer.files.length) return;
    el.files = e.dataTransfer.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        if (!input.disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed px-4 py-3 text-center transition focus-within:border-accent ${
        over ? "border-accent bg-accent/10" : "border-line-strong hover:border-accent"
      } ${input.disabled ? "cursor-not-allowed opacity-40" : ""} ${className}`}
    >
      <input
        {...input}
        ref={setRef}
        type="file"
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          setPicked(files.map((f) => f.name).join(", "));
          onChange?.(e);
        }}
      />
      <span className="text-sm font-semibold">{label}</span>
      <span className="max-w-full truncate text-xs text-neutral-500">
        {picked || hint || "Drop a file here, or click to choose"}
      </span>
    </label>
  );
}
