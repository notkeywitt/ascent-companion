"use client";

/**
 * Last-resort boundary for a React render crash — the case where the normal UI,
 * including the layout, is already gone. It replaces the browser's blank white
 * page with something a person in the field can act on, and reports the crash so
 * it isn't only discovered when someone mentions it.
 *
 * Deliberately plain: it cannot import the ui.tsx primitives or the layout,
 * because whatever broke may live in them. Inline styles only, so it renders
 * even if the stylesheet never loaded.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Imported lazily and guarded, so a build with no DSN pulls in nothing.
    (async () => {
      const { sentryEnabled } = await import("@/lib/sentry.shared");
      if (!sentryEnabled) return;
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureException(error);
    })().catch(() => {
      /* reporting must never mask the original error */
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#faf9f7",
          color: "#1c1917",
        }}
      >
        <main style={{ maxWidth: "28rem", width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.95rem", lineHeight: 1.5, margin: "0 0 1.25rem" }}>
            This screen hit an error and couldn&apos;t load. Nothing you were viewing
            was changed. Try again, and if it keeps happening, mention it on the
            Requests page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              appearance: "none",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: "#fff",
              background: "#b45309",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ fontSize: "0.75rem", opacity: 0.6, marginTop: "1.25rem" }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
