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
   (The app creates all its tables automatically on first request — `rfis`,
   `feature_requests`, `allowed_users`, `saved_bills`, `sunset_statements`. This
   DB holds only non-JobTread data; nothing financial lives here.)

## 2. Get the code to Vercel

Two options:

- **A — GitHub import (nicer):** push this repo to GitHub first (currently blocked
  by the fine-grained token's scope — add `ascent-companion` to the token or use a
  broader one), then in Vercel “Add New → Project → Import” it.
- **B — CLI (no GitHub needed):** `npm i -g vercel`, then from this folder run
  `vercel` (first run links/creates the project) and `vercel --prod` to deploy.

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)

`.env.example` documents every variable inline — this is the deploy-time subset.

| Name | Value |
|---|---|
| `JT_GRANT_KEY` | your JobTread grant key |
| `JT_ORG_ID` | `22PXG7QcMaQ2` |
| `JT_SUNSET_VENDOR_ID` | Sunset's JT account id (billing-date rule) |
| `DATABASE_URL` | the `libsql://…` URL from Turso |
| `DATABASE_AUTH_TOKEN` | the Turso token |
| `APP_PASSWORD` | a strong shared password (required on deploy) |
| `COMPANION_WRITES_ENABLED` | leave unset (writes stay off) |
| `GEMINI_KEY` | Gemini key — **Add a Bill** extraction + Sunset statement extraction |
| `ANTHROPIC_API_KEY` | Anthropic API key (powers the **Assistant** chat) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` (or leave unset for Opus 4.8) |
| `GOOGLE_MAPS_API_KEY` | Maps key for **Mileage** (enable the **Routes API**; **Geocoding API** for addresses) |
| `APPS_SCRIPT_SYNC_URL` | the Apps Script `/exec` URL (Sheets/Drive features: employees, tools, safety, mileage, email logging, payments) |
| `APPS_SCRIPT_SYNC_SECRET` | must equal Script Property `SYNC_TRIGGER_SECRET` on the Apps Script side |
| `CRON_SECRET` | any long random string — Vercel Cron sends it as `Authorization: Bearer …` to the **Daily Digest** run (`vercel.json` → 13:00 UTC = 6am Pacific). Without it the schedule fires and gets a 401, and the digest only builds when an admin taps **Refresh now**. (`DIGEST_CRON_SECRET` overrides it if you want a separate secret.) |

Set them for the Production environment, then deploy (Vercel builds automatically).
The last few are only needed by the features that use them — the app runs without
them, those screens just won't work.

### Daily Digest — the one extra deploy step

The digest's Gmail, Calendar and Sheet reads run in the **Apps Script** repo
(`DailyDigest.js`), so after deploying this app:

1. Ship the Apps Script side with `./deploy.sh` (not `clasp push` — the Companion
   calls a *versioned* deployment).
2. Open the Apps Script editor once and run any function, then **accept the new
   Google Calendar permission**. `appsscript.json` now requests
   `calendar.readonly` — the READ-ONLY scope, so the script cannot create, edit or
   delete an event on anybody's calendar. Until that prompt is accepted, the
   calendar check reports "couldn't be checked" and the rest of the digest is
   unaffected.
3. The first digest run lists every calendar the account can see. Copy the ids of
   the shared/operational ones into `calendarIds` in
   `src/lib/digest/settings.ts` — the defaults match on name fragments
   ("office", "bills", "projects", "time off") and ids are more durable.

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
