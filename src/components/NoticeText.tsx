"use client";

import Link from "next/link";
import { parseNoticeBody } from "@/lib/noticeLinks";

/**
 * A notice's message, with its links made tappable. The split rule lives in
 * `src/lib/noticeLinks.ts`.
 *
 * An app link opens in the same tab, through the router. An outside link opens
 * a new tab, so the app stays where the reader left it. Links inherit the
 * surrounding colour and separate by weight and underline: the banner's tone
 * tint already owns the colour.
 *
 * `onNavigate` runs when a link is tapped — the popup uses it to close itself,
 * so the page the reader asked for is not hidden behind the notice.
 */
export function NoticeText({ body, onNavigate }: { body: string; onNavigate?: () => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const cls = "font-semibold underline underline-offset-2 hover:opacity-80";
  return (
    <>
      {parseNoticeBody(body, origin).map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : p.internal ? (
          <Link key={i} href={p.href} className={cls} onClick={onNavigate}>
            {p.text}
          </Link>
        ) : (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className={cls} onClick={onNavigate}>
            {p.text}
          </a>
        ),
      )}
    </>
  );
}
