"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark switch for the header row. The `dark` class on <html> is the source
 * of truth (set before paint by the inline script in layout.tsx, which reads
 * localStorage); this reads it on mount and writes both back on toggle.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  }
  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="shrink-0 rounded-md px-2 py-1 text-sm text-neutral-500 transition hover:text-accent dark:hover:text-accent-soft"
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}
