# Chrome Web Store — submission kit

Everything to paste into the Web Store developer dashboard. Recommended
visibility: **Unlisted** (installable only via direct link; the app's own Google
allowlist is the real access gate, so unlisted is safe).

Privacy policy URL: **https://ascent-companion.vercel.app/privacy**

---

## Product name
Ascent Companion

## Summary (max 132 chars)
Side panel for JobTread: see a job's vendor bills and billing info, and follow along as you move between jobs.

## Category
Workflow & Planning

## Language
English (United States)

---

## Description
Ascent Companion is an internal tool for Ascent Building Co. staff. It adds a
side panel next to JobTread that shows the currently-open job's vendor bills,
unbilled expenses, and billing information from the Ascent companion app.

Features:
- Follows the job you have open in JobTread and shows its bills in the side panel.
- Review draft vendor bills waiting to be coded.
- View unbilled expenses and stage monthly customer invoices.
- The same app works on your phone at ascent-companion.vercel.app.

Access is restricted to Ascent Building Co. staff via Google Sign-In.

---

## Single purpose (required)
Ascent Companion displays a side panel beside JobTread showing the
currently-open job's vendor bills and billing information from Ascent Building
Co.'s companion app, and keeps that panel in sync with the job the user is
viewing in JobTread.

## Permission justifications (required)

- **sidePanel** — To show the companion app in Chrome's side panel next to
  JobTread.
- **storage** — To remember the user's "follow the open job" toggle and the id
  of the job currently open in JobTread, so the panel stays in sync. Stored
  locally in the browser only.
- **tabs** — The side panel locates the user's open JobTread tab so that
  (1) clicking a bill in the panel opens that bill in the main JobTread window,
  and (2) after the user saves a change in the panel, the JobTread tab is
  reloaded to show the updated data. The extension only queries for and acts on
  tabs at https://app.jobtread.com/*; it does not read browsing history or act
  on any other site.
- **Host permission: https://app.jobtread.com/\*** — The extension runs only on
  JobTread. Its content script reads the job and document id from the JobTread
  page URL so the side panel can display the matching job. It reads no other
  page content and runs on no other site.

## Remote code
No. All executable code is included in the package. The side panel embeds the
Ascent companion web app in an iframe (its own origin); the extension itself
runs no remotely-hosted code.

## Data usage (dashboard checkboxes)
- Does it collect user data? The extension stores the open JobTread job id
  locally to sync the panel; it does not transmit personal data to a remote
  server itself. The embedded web app uses your Google email solely to check the
  staff allowlist (see privacy policy).
- Not sold to third parties: yes (confirm).
- Not used for purposes unrelated to the single purpose: yes (confirm).
- Not used to determine creditworthiness / for lending: yes (confirm).

---

## Screenshots (required — at least 1, size 1280×800 or 640×400)
Take these from a Chrome window with the panel open on a JobTread job:
1. The side panel open next to a JobTread job, showing the coding queue.
2. A bill detail view in the panel.
3. (optional) The Invoicing / stage view.

macOS screenshot of a region: Shift-Cmd-4. Crop/pad to exactly 1280×800 if the
uploader complains about dimensions.

## Store icon
128×128 — reuse extension/icons/icon128.png.
