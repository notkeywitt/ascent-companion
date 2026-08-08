// Sentry init for the Node.js runtime (route handlers, server components).
// No-ops entirely when NEXT_PUBLIC_SENTRY_DSN is unset — see src/lib/sentry.shared.ts.
import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions, sentryEnabled } from "@/lib/sentry.shared";

if (sentryEnabled) {
  Sentry.init(sentryBaseOptions);
}
