/** @type {import('next').NextConfig} */
const nextConfig = {
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

export default nextConfig;
