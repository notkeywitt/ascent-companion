# Ascent Companion — Chrome side panel

Docks the companion web app in Chrome's native side panel, next to JobTread. This
loads the running web app in an iframe — it does **not** inject anything into
JobTread's page, so it can't break when JobTread ships UI changes.

## Load it (unpacked, for local testing)

1. Make sure the app is running: `npm run dev` in the repo root (default
   `http://localhost:3000`).
2. Chrome → `chrome://extensions` → enable **Developer mode** (top right) →
   **Load unpacked** → select this `extension/` folder.
3. Click the puzzle-piece icon in Chrome's toolbar → pin **Ascent Companion**.
4. Click its icon to open the side panel. It opens on *any* tab (including a
   JobTread job tab), so you can view it right next to JobTread.

## Changing the app URL

The panel has a small address bar at the top (defaults to
`http://localhost:3000`) — edit it and hit **Go** to point at a deployed
instance later (Cloud Run / Vercel) instead of localhost. It's remembered via
`chrome.storage.local`.

## Status

MVP: static iframe, no awareness of which JobTread job is open. A later
iteration can add a content script on `https://app.jobtread.com/*` (already
declared in `host_permissions`) to read the current job id from the URL and
auto-load that job in the panel — confirm JobTread's actual app URL/host first.
