# Ascent Assistant — Chrome side panel

Docks the assistant web app in Chrome's native side panel, next to JobTread. This
loads the running web app in an iframe — it does **not** inject anything into
JobTread's page, so it can't break when JobTread ships UI changes.

## Load it (unpacked, for local testing)

1. Make sure the app is running: `npm run dev` in the repo root (default
   `http://localhost:3000`).
2. Chrome → `chrome://extensions` → enable **Developer mode** (top right) →
   **Load unpacked** → select this `extension/` folder.
3. Click the puzzle-piece icon in Chrome's toolbar → pin **Ascent Assistant**.
4. Click its icon to open the side panel. It opens on *any* tab (including a
   JobTread job tab), so you can view it right next to JobTread.

## App URL

The panel loads the deployed app, hard-coded as `APP_URL` at the top of
`panel.js` (`https://ascent-companion.vercel.app`). Change that one line if the
deploy URL ever changes, then reload the extension.

## Status

MVP: static iframe, no awareness of which JobTread job is open. A later
iteration can add a content script on `https://app.jobtread.com/*` (already
declared in `host_permissions`) to read the current job id from the URL and
auto-load that job in the panel — confirm JobTread's actual app URL/host first.
