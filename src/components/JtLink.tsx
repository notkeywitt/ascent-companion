"use client";

/**
 * A link to JobTread — always opens in a new tab/window, so following it
 * never navigates the office away from what they were doing here. Also the
 * only way out of the Chrome side panel (this app is iframed by a
 * chrome-extension page there, where target=_top/_self can't navigate out to
 * a web URL at all).
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
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}
