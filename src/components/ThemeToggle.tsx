"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark switch. The `dark` class on <html> is the source of truth (set
 * before paint by the inline script in layout.tsx, which reads localStorage);
 * this reads it on mount and writes both back on toggle.
 *
 * `children` replaces the ☀/☾ glyph with any face. The header passes the Ascent
 * logo: the mark is already the one thing on that row that is not a control, so
 * it carries the switch instead of a second small button beside it. The title
 * and aria-label still say what the button does, whatever it looks like.
 */
export function ThemeToggle({
  children,
  className = "shrink-0 rounded-md px-2 py-1 text-sm text-neutral-500 transition hover:text-accent dark:hover:text-accent-soft",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
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
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button onClick={toggle} title={label} aria-label={label} className={className}>
      {children ?? (dark ? "☀" : "☾")}
    </button>
  );
}
