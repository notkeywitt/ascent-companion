// Sentry init for the browser. Catches the errors that never reach the server —
// a component crashing on a phone mid-form, for instance.
// No-ops entirely when NEXT_PUBLIC_SENTRY_DSN is unset.
import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions, sentryEnabled } from "@/lib/sentry.shared";

if (sentryEnabled) {
  Sentry.init({
    ...sentryBaseOptions,
    // No session replay: it records what is on screen, which here means job
    // financials and employee data. Not worth the exposure for this app.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = sentryEnabled
  ? Sentry.captureRouterTransitionStart
  : undefined;
