import { execSync } from "node:child_process";

import { withSentryConfig } from "@sentry/nextjs";

/**
 * Which commit this bundle came from. Vercel sets the VERCEL_GIT_* system vars
 * on every deploy; a local build falls back to git, and to "" when git can't
 * answer. Never throws — a missing stamp shows as "unknown" in the Admin build
 * footer, which is not worth failing a production build over.
 */
function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// Read once, at config load, so the value is frozen into the bundle. `env`
// entries are string substitutions made at build time — they are what lets the
// footer render the build with no API call.
const BUILD = {
  APP_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse HEAD"),
  APP_BUILD_REF: process.env.VERCEL_GIT_COMMIT_REF || git("rev-parse --abbrev-ref HEAD"),
  APP_BUILD_MESSAGE: (process.env.VERCEL_GIT_COMMIT_MESSAGE || git("log -1 --pretty=%s")).split("\n")[0],
  APP_BUILD_TIME: new Date().toISOString(),
  APP_BUILD_ENV: process.env.VERCEL_ENV || "local",
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: BUILD,
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
