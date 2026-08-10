"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard chip. Copies `value`; briefly flips to a "Copied" check so
 * you know the paste is loaded before switching to the TSYS tab. Used on the
 * /payments view for the fields you type by hand (net, account name, reference ID).
 */
export function CopyButton({
  value,
  label,
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for older/insecure contexts where the async clipboard is blocked.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* give up silently */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label ? `Copy ${label}` : "Copy"}
      className={
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition " +
        (copied
          ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
          : "border-neutral-300 text-neutral-600 hover:border-accent hover:text-accent dark:border-neutral-600 dark:text-neutral-300 dark:hover:text-accent-soft") +
        " " +
        className
      }
    >
      <span aria-hidden>{copied ? "✓" : "⧉"}</span>
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}
