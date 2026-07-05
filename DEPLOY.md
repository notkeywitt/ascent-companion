# Deploying Ascent Companion

Target: **Vercel** (host) + **Turso** (hosted libSQL database). ~15 minutes.

The app talks to JobTread with your org grant key, so the deployed instance **must**
be password-protected (`APP_PASSWORD`). Auth is enforced automatically whenever
`APP_PASSWORD` is set.

## 1. Database — Turso (free tier)

1. Create an account at https://turso.tech and install the CLI (or use the web UI).
2. Create a database, then get its URL and an auth token:
   ```
   turso db create ascent-companion
   turso db show ascent-companion --url          # -> libsql://...
   turso db tokens create ascent-companion       # -> the auth token
   ```
   (The app creates the `rfis` table automatically on first request.)

## 2. Get the code to Vercel

Two options:

- **A — GitHub import (nicer):** push this repo to GitHub first (currently blocked
  by the fine-grained token's scope — add `ascent-companion` to the token or use a
  broader one), then in Vercel “Add New → Project → Import” it.
- **B — CLI (no GitHub needed):** `npm i -g vercel`, then from this folder run
  `vercel` (first run links/creates the project) and `vercel --prod` to deploy.

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `JT_GRANT_KEY` | your JobTread grant key |
| `JT_ORG_ID` | `22PXG7QcMaQ2` |
| `DATABASE_URL` | the `libsql://…` URL from Turso |
| `DATABASE_AUTH_TOKEN` | the Turso token |
| `APP_PASSWORD` | a strong shared password (required on deploy) |
| `COMPANION_WRITES_ENABLED` | leave unset (writes stay off) |

Set them for the Production environment, then deploy (Vercel builds automatically).

## 4. Use it

- Open the Vercel URL on your phone → you’ll get the **Sign in** screen → enter
  `APP_PASSWORD`. Add it to your home screen for an app-like icon (it’s a PWA-ready
  responsive app).
- Point the Chrome side-panel at the deployed URL: open the panel, edit the address
  bar from `http://localhost:3000` to your Vercel URL, hit **Go**.

## Notes

- `APP_PASSWORD` unset ⇒ auth off (local dev convenience). Never leave it unset on a
  public deploy.
- Upgrade path: swap the shared password for Google sign-in (Auth.js) later without
  changing the app’s features.
- Writes to JobTread stay disabled until `COMPANION_WRITES_ENABLED=true` — deploy
  with it off.
