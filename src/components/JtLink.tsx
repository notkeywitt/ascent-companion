"use client";

import { useEffect, useState } from "react";

/**
 * A link to JobTread that behaves correctly in both contexts:
 * - In the Chrome side panel (this app is iframed by a chrome-extension page),
 *   target=_top/_self can't navigate out to a web URL, so we open a real browser
 *   tab with _blank.
 * - As the full web/mobile app (not framed), we navigate the same window.
 */
export function JtLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    try {
      setFramed(window.top !== window.self);
    } catch {
      setFramed(true); // cross-origin top => we're framed
    }
  }, []);

  return (
    <a
      href={href}
      target={framed ? "_blank" : "_self"}
      rel={framed ? "noreferrer" : undefined}
      className={className}
    >
      {children}
    </a>
  );
}
