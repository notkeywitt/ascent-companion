/**
 * Next.js instrumentation hook — loads the right Sentry config per runtime and
 * reports server-side errors.
 *
 * `onRequestError` is what actually catches a throwing route handler or server
 * component. Without it, a 500 in an API route is reported by nothing.
 */
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  // Import lazily so the SDK stays out of the graph when reporting is off.
  const { sentryEnabled } = await import("@/lib/sentry.shared");
  if (!sentryEnabled) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
