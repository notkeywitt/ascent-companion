# Deploying Ascent Assistant

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
| `ANTHROPIC_API_KEY` | Anthropic API key (powers the **Chat** assistant) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` (or leave unset for Opus 4.8) |

Set them for the Production environment, then deploy (Vercel builds automatically).

## 4. Use it

- Open the Vercel URL on your phone → you’ll get the **Sign in** screen → enter
  `APP_PASSWORD`. Add it to your home screen for an app-like icon (it’s a PWA-ready
  responsive app).
- Point the Chrome side-panel at the deployed URL: open the panel, edit the address
  bar from `http://localhost:3000` to your Vercel URL, hit **Go**.

## Google sign-in (Auth.js)

Google is used once `AUTH_GOOGLE_ID` is set; until then the app falls back to
`APP_PASSWORD`, so this can be added without downtime.

1. **Google Cloud Console** → create/pick a project → **APIs & Services → OAuth
   consent screen** → **Internal** (works because ascentbuildingco.com is a
   Workspace org; no Google verification needed).
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorized redirect URI:
   `https://ascent-companion.vercel.app/api/auth/callback/google`
   (add `http://localhost:3000/api/auth/callback/google` too for local dev).
   Copy the **Client ID** and **Client secret**.
3. **Vercel env vars** (Production):
   | Name | Value |
   |---|---|
   | `AUTH_SECRET` | `openssl rand -base64 32` (a fresh one) |
   | `AUTH_GOOGLE_ID` | the OAuth Client ID |
   | `AUTH_GOOGLE_SECRET` | the OAuth Client secret |
   | `ALLOWED_EMAILS` | comma-separated allowed Google emails |
   Keep `APP_PASSWORD` for now (fallback).
4. **Redeploy** (Vercel → Deployments → Redeploy, so the new env vars load).
5. Test: open the app in a browser tab → **Sign in with Google**. In the side
   panel, sign in once in a normal tab first (Google can't render in the iframe);
   the panel then shares the session.
6. Once it works, **remove `APP_PASSWORD`** to go Google-only.

## Notes

- `APP_PASSWORD` unset ⇒ auth off (local dev convenience). Never leave it unset on a
  public deploy.
- Upgrade path: swap the shared password for Google sign-in (Auth.js) later without
  changing the app’s features.
- Writes to JobTread stay disabled until `COMPANION_WRITES_ENABLED=true` — deploy
  with it off.
