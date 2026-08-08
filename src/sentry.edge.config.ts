// Sentry init for the Edge runtime — this is the one that covers src/middleware.ts,
// where every auth + view-gating decision happens.
// No-ops entirely when NEXT_PUBLIC_SENTRY_DSN is unset.
import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions, sentryEnabled } from "@/lib/sentry.shared";

if (sentryEnabled) {
  Sentry.init(sentryBaseOptions);
}
