import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Overridable so a build can be run without stomping on `.next`. Two Next
  // builds (or a build and a running `next dev`) share `.next` and wipe each
  // other's manifests, which surfaces as ENOENT on pages-manifest.json during
  // "Collecting page data". `.githooks/pre-push` sets this for that reason.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  eslint: {
    // Lint runs in CI (.github/workflows/ci.yml), NOT in the deploy path.
    //
    // By default `next build` fails on any ESLint error, which would mean a
    // stray unescaped apostrophe blocks a Vercel production deploy — including
    // the mobile build loop, where the owner is shipping a fix from a phone and
    // cannot reasonably drop into an editor to appease a style rule. Type errors
    // still fail the build (tsc is not affected by this); only lint is decoupled.
    ignoreDuringBuilds: true,
  },
};

// Source maps are uploaded to Sentry only when an auth token is present. Without
// one — every local build, every CI run, and any clone without a Sentry account
// — upload is disabled and the build proceeds normally. Error reporting itself
// is gated separately on the DSN (src/lib/sentry.shared.ts); readable stack
// traces in Sentry are the only thing the token buys.
const hasSentryAuth = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Don't add Sentry's build noise to an already-chatty Vercel log.
  silent: true,
  sourcemaps: { disable: !hasSentryAuth },

  // NOT using tunnelRoute. It would proxy the browser SDK through our own domain
  // to dodge ad/tracker blockers, but it produced no route and no rewrite in this
  // setup — and src/middleware.ts matches every path except _next/static, so an
  // untunneled /monitoring would be redirected to /login anyway. A tunnel that
  // 404s silently discards EVERY client-side report, which is strictly worse than
  // sending direct. If it's wanted later, it needs its own PUBLIC entry in the
  // middleware and a verified route in the build output.

  // Strip Sentry's own debug logging from the client bundle.
  webpack: { treeshake: { removeDebugLogging: true } },
});
