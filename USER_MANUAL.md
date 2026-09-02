# Ascent Assistant — User Manual

The Ascent Assistant is Ascent Building Co.'s companion app for JobTread. It does the
things JobTread makes slow or awkward — coding vendor bills, seeing what hasn't been
billed to a customer, staging monthly invoices — and it has grown to cover the field and
office jobs the old AppSheet app used to handle: tools, safety meetings, mileage, time,
the employee roster, and more.

**JobTread is the source of truth.** The Assistant mostly *reads* JobTread and writes
back the specific changes you make (a cost code, a new draft bill, a time entry). It does
not keep its own copy of your job data. When something looks wrong on a bill, you fix it
in JobTread and it flows back — not the other way around.

The app works two ways:

- **On your phone** — a full mobile web app you can install to your home screen (see
  *Install it on your phone* below). This is how field staff use Tools, Safety Meeting,
  Mileage, and Employee Time.
- **On your computer** — in a browser tab, or docked in a **Chrome side panel** right
  next to JobTread (see *The Chrome side panel*).

---

## Safety & security — a note for owners

The Assistant was built to be a *low-risk* addition to the way the office already works. If
you're deciding whether to trust it, here's what matters:

- **Only Ascent staff can get in.** Access is limited to an allowlist. Signing in requires
  a Google account that an administrator has explicitly added — no one outside that list can
  open the app, even with the link — and the app is served only over an encrypted (HTTPS)
  connection.
- **Your JobTread data stays in JobTread.** The Assistant keeps *no* copy of your jobs,
  bills, or budgets. It reads them live from JobTread and writes back only the one change you
  make — a cost code, a draft bill, a time entry. **JobTread stays the single source of
  truth**, so nothing here can quietly drift out of sync with your books. The only things the
  app stores itself are a few app-only items: RFIs, feature requests, the sign-in list, and
  cached Sunset statement figures.
- **Credentials are never exposed.** The keys that let the app talk to JobTread, Google, and
  the invoice reader live only on the server — they're never sent to your phone or browser,
  and never shown on screen.
- **It's built so it can't quietly break things:**
  - It can run in a **preview mode** that shows what *would* happen without writing anything
    to JobTread.
  - Anything that deletes or recreates data **asks you to confirm first** and explains exactly
    what it will do; dismissing or hiding an item never deletes the underlying record or file.
  - If you have unsaved edits, it **warns you before you leave** the page.
  - If a write to JobTread fails — say, logging time in a dead zone — the entry is **still
    saved** to the company record so no work is lost, and the office can retry it.
  - The desktop side panel sits *beside* JobTread in its own frame; it does **not** modify
    JobTread's own screens, so it can't interfere with how JobTread works.
- **Everything is logged.** Every automated action — pushing a bill, syncing, ingesting an
  invoice — is written to an audit trail (the **Logs** page) with a timestamp and result, so
  there's always a record of what happened and when.
- **Minimal data, plainly stated.** The app reads only what it needs: on JobTread pages the
  side panel reads the job number from the address bar and nothing else, and Google sign-in is
  used only to confirm you're on the staff list. It does not touch your Google contacts,
  files, or email beyond the specific invoice-inbox feature you start yourself. The full
  privacy policy lives in the app at **/privacy**.

---

## Contents

1. [Getting started](#getting-started)
2. [Finding your way around](#finding-your-way-around)
3. [Financials](#financials)
4. [Tools](#tools)
5. [Safety & the field](#safety--the-field)
6. [Utilities](#utilities)
7. [Tips, permissions & troubleshooting](#tips-permissions--troubleshooting)

---

## Getting started

### Signing in

Open the app and you'll land on the **Sign in** screen. There are two ways in:

- **Sign in with Google** — the normal way. Use your Ascent Google account. Only emails on
  the staff allowlist can get in (see *Admin* for who manages that).
- **Shared password** — tucked under "or use the shared password." A fallback for when
  Google sign-in isn't convenient.

You stay signed in, so you normally only do this once per device.

### Install it on your phone

The Assistant is a Progressive Web App, which means you can add it to your home screen and
run it like a normal app (full screen, its own icon):

- **iPhone (Safari):** open the app, tap the **Share** button, then **Add to Home Screen**.
- **Android (Chrome):** open the app, tap the **⋮** menu, then **Install app** / **Add to
  Home Screen**.

### The Chrome side panel

On a computer you can dock the Assistant next to JobTread in Chrome's side panel. Click the
**Ascent Assistant** icon in the Chrome toolbar to open it. As you move between jobs in
JobTread, the panel **follows along** and shows the same job automatically.

> **Note:** Google sign-in can't run inside the side panel. If you're asked to sign in
> there, use the **"Open in a new tab to sign in"** button, sign in once in a normal
> browser tab, and the panel will then stay signed in.

---

## Finding your way around

Two things sit at the very top of every screen and follow you everywhere:

### The job picker (important)

At the top is a **searchable job dropdown**. **The job you pick here is the job the
financial pages act on.** Type to search by customer, job number, name, or address, then
choose a job — or choose **"All jobs"** to leave it unscoped.

- Your choice is remembered as you move between tabs.
- Some pages (Coding Review) can show *all* jobs at once; others (Invoicing, Unbilled,
  Add a Bill) need one specific job and will simply prompt you to pick one.
- If you switch jobs while looking at a single bill, the app takes you back to that job's
  Coding Review (the old bill belonged to the previous job), and warns you first if you
  have unsaved edits.

Next to the picker is a green **➕ Add bill** button — a shortcut to add a bill to the
currently selected job from anywhere.

### The tabs and the Home launcher

- **Coding Review** and **Invoicing** are always-visible tabs.
- **More ▾** holds everything else, grouped by purpose (Assistant, Billing, Field,
  Office, System).
- The **Ascent logo** (top-left) opens the **Home** launcher — big, thumb-sized buttons
  for every page, grouped into **Financials, Tools, Safety, Utilities**. This is the
  easiest way to get around on a phone.

### The two little buttons on the right

- **⟳ Sync** — pushes JobTread's latest changes into the Sheets and Drive folders right
  now, instead of waiting for the hourly automatic sync. It confirms the sync was
  *queued*, not that it finished (a full sync takes ~15 minutes). If a sync is already
  running you'll see **"Already running"** in amber — that's normal; nothing new was
  started, so don't keep clicking.
- **☀ / ☾** — switch between light and dark theme.

---

## Financials

The billing workflow, roughly in the order a bill travels: it arrives → gets a job → gets
coded → gets billed to the customer → gets paid.

### Add a Bill — `➕ Add bill`

Manually add a vendor bill by photographing or uploading the invoice. Reached from the
green **➕ Add bill** button (it carries whichever job is selected).

1. Make sure a **job is selected** — the bill is created on that job. (If none is picked
   you'll be told to pick one first.)
2. Choose the invoice **file** (PDF or photo, up to 15 MB).
3. Optionally pick the **Vendor** (the default lets the app match it for you), or tick
   **"Single line — don't itemize"** to collapse a long invoice into one cost item.
4. Tap **Log Bill**. The app reads and codes the invoice automatically, creates a **draft
   bill** in JobTread, and attaches the file.
5. A results card shows the vendor, amount, tax, how many lines it coded (e.g. "3/5"),
   the billing month, and buttons to **Review coding →** or **Add another**.

> **Good to know:**
> - If the vendor can't be matched, you'll be asked to pick one and resubmit.
> - Any line whose cost code isn't in the job's budget lands **uncoded** — a warning tells
>   you to finish it in Coding Review.
> - The billing month comes from the **upload date**, not a date printed on the invoice.
> - Uploading the same invoice twice won't create a duplicate.

### Coding Review — `/coding`

Your inbox of draft vendor bills that still need a cost code. This is the main tab.

- Pick a **job** (or stay on **All jobs**) at the top; the list loads automatically.
- Each card shows the vendor, a status badge, the amount, and the issue date. In All-jobs
  view it also shows which job the bill is on. A **running count** and **dollar total**
  sit above the list.
- Tap any bill to open its **detail page** and code it. (In the desktop side panel,
  tapping also opens that bill in JobTread beside the app.)
- Reviewed bills are hidden by default; use **Show reviewed** to bring them back.

> Amounts already **include tax** — don't add it again in your head.

### The bill detail / coding screen — `/bill/…`

The workhorse editing screen: review one bill, assign cost codes, adjust amounts, mark it
reviewed. You reach it by tapping a bill in Coding Review.

At the top: a **‹ Coding queue** link, **‹ Prev / Next ›** arrows to step through the
job's draft bills (with a "2 / 7" counter), a **Refresh** button, an **Open in JobTread ↗**
button, and a **Mark reviewed** toggle.

To code a bill:

1. Compare the attached invoice image (shown at the bottom) against the line items.
2. Pick a **cost code** for each line. For a many-line bill, use **"Apply one code to all
   lines"** to set them all at once. Under a chosen code, the app shows **cost to
   complete** (budget minus actual, turning red if over budget).
3. Adjust **Qty** and **Unit $** if needed. (Amounts are entered **pre-tax** — the app
   adds the tax back so JobTread shows exactly what you typed.)
4. When you have changes, a **sticky Save bar** slides up from the bottom: **Save changes
   (N)** or **Discard**.

You can also set the **Billing month**, add a line with **+ Add line**, **Move to job**
(draft bills only), or flip **Mark reviewed**.

> **Good to know:**
> - **Unsaved-changes guard:** if you try to leave with pending edits, you'll be warned.
> - **Locked amounts:** once a bill leaves Draft (it's payable or paid), JobTread locks
>   qty/unit-cost/description. You can still change cost codes; to change amounts, set it
>   back to Draft in JobTread.
> - **Move to job** deletes and recreates the bill on the new job (keeping its PDF), so
>   you'll land on the new job's coding queue afterward. It asks you to confirm first.
> - **Mark reviewed** is an Assistant-only flag — it doesn't change anything in JobTread.

### Needs Project — `/needs-project`

Bills that were ingested automatically but the system couldn't tell which job they belong
to. Each row here has its **own** job picker (it doesn't use the top job bar).

1. Tap **View PDF ↗** to see what the bill is.
2. Pick the correct **job** and tap **Assign** — the bill is pushed to that job in
   JobTread and re-filed in Drive, and the row disappears.
3. If it's a duplicate, already handled, or not a bill, tap **Dismiss** (this is
   non-destructive — it keeps the row and PDF and just stops showing it here; it asks you
   to confirm).

### Email Invoices — `/email`

Files invoice emails from the office inbox to a job in one click. Replaces the old Gmail
add-on. Each email row has its own job picker.

1. Tap **Refresh** to pull the latest unprocessed invoice emails.
2. For each email, pick the **job**, optionally tick **PAID**, and tap **Log Invoice**.
   The app grabs the attachment, reads it, files it to Drive, writes the row, and creates a
   JobTread draft. A green "✓ logged" confirms it.
   - **Multi-invoice emails** (several PDFs) get one job picker *per PDF* and a **Log all
     N invoices** button — every PDF must have a job before that button is enabled.
3. If the invoice was already entered into JobTread by hand, pick the job and tap **✓
   Processed**. If it isn't an invoice at all, tap **Not relevant**.
4. Anything you dismiss drops into a **Handled** tray at the bottom, each with an **Undo**.

> Logging runs live and takes roughly **15–45 seconds per invoice**.

### Unbilled — `/unbilled`

A read-only dashboard: how much approved cost on a job has **not yet** been billed to the
customer. **Requires a specific job.**

Pick a job and it computes automatically: a headline **"Unbilled (at cost)"** figure,
broken into approved bill cost, invoiced, draft (staged) invoice, and draft bills still to
code — with a table rolling everything up by type and status. There's a shortcut link back
to the coding queue.

### Invoicing — `/stage`

Builds a preview of what to bill a customer for a chosen month, then hands off to JobTread
to create the actual invoice. **Requires a specific job.**

1. Select the job and the **Invoice date (billing month)** (defaults to last month).
2. Adjust the toggles if needed — **Uninvoiced only**, **Filter by billing month**,
   **Include draft bills**, **Group by CSI code**.
3. Review the line-item table and **Total**.
4. Use **Print / Save PDF** for a clean Ascent-letterhead billing summary.
5. Tap **Create invoice in JobTread ↗**, then in JobTread do **New → Customer Invoice** —
   its builder pulls exactly these uninvoiced bills and time. Date it the last day of the
   month, review, and send.

> This page does **not** create the invoice itself — JobTread does. If nothing shows, it
> means every approved bill on the job is already invoiced.

### Payments — `More ▾ → Payments`

One-click paying of Sunset (fuel/materials) statements at TSYS.

- A filter row (**unpaid / paid / all**) sits at the top; it opens on **unpaid**.
- Each statement card reads its own PDF to show the **account name**, **statement #**,
  **total**, **discount**, and the **net to pay**. ("Reading statements…" appears briefly
  while it does this the first time.)
- **Copy** buttons put the Account, Stmt #, and Net on your clipboard; **Pay at TSYS ↗**
  opens the payment site; **View PDF** opens the statement.
- After paying, tap **Mark paid** (or **Undo paid** if you made a mistake). Paid
  statements drop off the unpaid list and show the date they were paid.

---

## Tools

### Tool Inventory — `/tools`

The master list of every company tool: look one up, edit its details, move it to a job by
scanning its QR sticker, or register a brand-new tool.

- **Search & filter:** a search box (name, ID, type, serial, location) plus **condition**
  and **job site** filters. Tools are grouped by type, each showing a photo, name, current
  location, and a colored **condition badge** (green good / amber fair / red poor).
- **Edit a tool:** tap **Edit** to change name, type, condition, group, serial, accessories,
  and location. **Replace photo** uses the camera; the **📷 Scan** button next to Serial
  photographs the label and reads the serial for you (*always double-check it*). Only the
  fields you change are saved.
- **Scan a tool** (top-right button): point the camera at the QR sticker.
  - *Known tool* → a card shows the tool and a **"Set location to"** dropdown (ordered
    nearest-job-first if location is on). Tap **Update location** to move it.
  - *Unknown sticker* → a **New tool** form opens with that code as the ID. Add a photo,
    fill in the details (Name is required), set a location, and tap **Add tool**.

> **Permissions:** scanning needs **camera** access; **location** is optional but powers
> the nearest-job guess. Phone photos are automatically shrunk before upload.

> The old "Tool Tracker" page is gone — that feature now lives on the Tools page. Any old
> Tool Tracker bookmark just redirects here.

---

## Safety & the field

### Safety Meeting — `/safety-meeting`

Records attendance and signatures for a toolbox/safety talk, then produces a signed roster
PDF. Designed to be filled on one iPad passed around the crew.

1. Set the **Date** (defaults to today), a **Topic**, and the **Meeting lead**.
2. For each person: pick their **name**, have them **sign** on the pad, and tap **Add
   attendee**. The pad clears and the iPad goes to the next person.
3. Tap **Save meeting (N)**. You need a topic, a lead, and at least one signed attendee.
4. On success you get links to **Open roster PDF** and **Open Drive folder**, plus **Start
   another meeting**.

> No camera or GPS needed — just the touch/stylus signature pad.

### Mileage — `/mileage-tracker`

Logs business driving. Because a phone can't track GPS in the background, you tap once when
you leave and once when you arrive; the app fills in the miles and street addresses.

1. On the start screen, confirm the **Driver**, optionally pick a **Job** and **Purpose**,
   and tap **Start trip**. (You can then lock your phone or close the app.)
2. When you arrive, reopen the app and tap **End trip**. It shows the miles, driving time,
   and a from → to summary.
3. **Add miles manually** handles a forgotten trip — just enter the miles and date.
4. **View logged miles** shows your history with a month filter. Admins also get a driver
   filter and a **"Create PDF — all drivers, this month"** export.

> **Location permission is required** for the Start/End flow. Log each stop of a
> multi-stop trip as its own leg. Your driver choice is remembered on the device.

### Employee Time — `/employee-time`

Your time clock. Two tabs at the top: **Time clock** (clock in and out) and **Timesheets**
(what you have already logged). Everything is written to JobTread and to the company record.

The app usually knows who you are (your name shows under the tabs). The first time, you may
need to pick yourself from **"Who are you in JobTread?"** — it's remembered afterward.

**Time clock**

1. The big word at the top says **Clocked out** or **Clocked in**. While you are clocked in,
   the time counts up under it.
2. **Start time** is now. Tap the **Today** chip or the time chip to change it — that is the
   "I forgot to clock in at 7" case.
3. The **Job**, the **Cost code** and the **Pay type** start on what you used last. If they
   are correct, change nothing. To change one, tap its row and pick from the list.
4. Tap the big **Clock in** button at the bottom.
5. When you stop, tap **Clock out**. Write the **Note** (required) and add up to **8 photos**
   if you want, then confirm.
6. If you forgot to clock out on time, change the **Stop time** in that same panel. Tap the
   day chip or the time chip and set the correct time. The panel shows the new length, and
   the button shows it too. A stop time after the current time is not permitted.
7. The **Start time** is in that same panel too, and you can correct it there — that is the
   "I started at 7 but only clocked in at 9" case. Tap the day chip or the time chip. The
   row marks it **edited**, the length updates, and the corrected start is written to
   JobTread with the clock-out. A start time after the current time is not permitted.

> **The last job stays with you.** The page remembers your last job, cost code and pay type
> on the phone. On a new phone it reads them from your most recent JobTread entry.

> **Your clock lives in JobTread, not in the phone.** Open the page on a different phone or
> on the office computer and it still shows you clocked in, with the same job and start time.
> **Cancel this clock-in** throws the clock away without logging time.

**Log a range** — the **+** button beside the Clock in button

For time already worked: pick the job, cost code, start and stop, write the note, add photos,
and tap **Log time**. One entry, no clock.

**Timesheets**

Your own JobTread entries for a pay period. Use the month arrows and the **1–15** / **16–end**
pills to choose the period; **Still clocked in** filters to a clock that is still running.
Days are grouped with the day's total and its state — **Approved** (the office approved every
entry that day), **Pending**, or **Clocked in**. Tap any entry to open your time in JobTread.

> **Nothing is ever lost:** even if the JobTread push is turned off or fails, the entry is
> always saved to the Time Entries record and the office can retry it.

---

## Utilities

### Assistant (Chat) — `More ▾ → Chat`

Ask plain-English questions about jobs, bills, budgets, and unbilled amounts. It looks the
answers up live in JobTread.

- Type a question ("What's unbilled on the Miller job?", "Which cost codes are over budget
  on this job?") and press **Send**. The answer streams in.
- If a job is selected, questions are automatically scoped to it.

> **Read-only.** The Assistant can look things up but **cannot** change, approve, code, or
> create anything. The conversation isn't saved — refreshing starts over.

### RFIs — `/rfis`

View and manage a job's Requests for Information. **Requires a job.**

- The list shows each RFI's number, subject, assignee, dates, and a status pill (**open /
  answered / closed**).
- **+ New RFI** opens a form (subject required; assignee suggests JobTread vendor names).
- Tap an RFI to expand it, type the **Answer**, and flip its status. Text fields save when
  you click away; dates and status save instantly.

> RFIs are stored in the Assistant's own records, not written into JobTread. There's no
> delete and no confirmation prompt — changes save quietly.

### Employees — `/employees`

The company roster (the "Project Database"). Search, filter, sort, edit each person, and
link them to their JobTread user account.

- Search and the status filter narrow the list; column headers sort it.
- The **JobTread** column offers a one-click **Link** when it's confident, or you set it in
  **Edit**.
- **Edit** opens all fields (name, position, status, phone, email, birthday, license, role,
  address) plus the JobTread-user dropdown.

> **This edits the live roster immediately** — there's no confirmation and no undo. Only the
> fields you change are written.

### Labor Import — `/labor-import`

Turns the monthly QuickBooks Time labor CSV into a CSV formatted for JobTread's "Import
Time Entries" tool. **It never sends anything to JobTread** — it only produces a file you
download and import yourself.

1. Export the QuickBooks report as CSV and **drop it in** (it's processed in your browser).
2. Uncheck any **jobs** or **workers** you don't want.
3. Map each **worker** to their JobTread user (exact matches auto-fill).
4. Give each **job** a JobTread Job ID — or load a "Projects map" CSV to auto-fill. A
   customer with more than one job is never auto-filled; you pick the right one.
5. Pick a **pay type** for each worker/job combination.
6. Tap **Download CSV**, then upload that file into JobTread's importer.

> Only rows with all four things — a user, a job, a matching budget cost item, and a pay
> type — are included; the rest are listed as "held back" or "dropped" with reasons. Your
> mappings are remembered on that browser.

### Actions — `More ▾ → Actions`

Run a background script job on demand instead of waiting for its schedule. Each card has a
name, a description, and a **Run** button; the result note appears underneath.

> **These run for real against production** (sync, ingestion, JobTread, the sheets) — no
> preview and no confirmation. If a sync is already running you'll see "Lock busy — nothing
> ran." Every run is also recorded in **Logs**.

### Requests — `/requests`

A suggestion box for fixes and new features. Tap **+ Request**, give it a title (required)
and optional detail, and **Submit**. Anyone can reclassify a request's status (**open /
planned / done / declined**).

### Admin (Team Access) — `More ▾ → Admin`

Controls who can sign in with Google. Type a teammate's email and tap **Add**; tap
**Remove** to revoke. **Founders** are fixed in the hosting config and can't be removed.

> Add/Remove take effect **immediately** and there's no confirmation on Remove.

### Daily Digest — the card at the top of **Home** (admins only)

Your morning review, done for you before you open the app. A scheduled job runs at
**6am Pacific** every day, works through a list of checks, and stores the answer; the
card just shows what it stored, so opening Home is instant. A short plain-English
paragraph sits at the top — that's the one thing to read if you read nothing else —
and under it these collapsible sections:

- **Calendar** — two things. What's on the shared calendars today and for the
  week ahead (the office calendar plus Ty's and Casey's) — when more than one
  calendar has something that day, each line says whose it is; and **JobTread's
  own schedule** — dated job work like a site visit, an inspection, or an
  install date, today or in the week ahead, grouped by who it's assigned to.
- **To-Do** — two things. Open **JobTread to-dos** that are overdue or due in the
  next week, grouped by who they're assigned to; and appointments or action items
  that were **mentioned in an email** ("site visit Thursday at 2", "I'll send the
  quote by Friday"), which a subject line alone would never surface.
- **Follow-ups** — emails from outside that nobody has replied to. Routine
  Sunset Builders Supply bill/payment emails are excluded (nobody replies to
  an invoice, and Sunset's own ingestion already owns them); a Sunset monthly
  **statement** email is not excluded, since that one genuinely needs office
  action.

**Billing is switched off** (as of 31 Aug 2026). The digest used to open with four
billing checks; billing now has its own screens (Tracking Sheets, Unbilled,
Recode), so the digest is a schedule and to-do report instead. The billing checks
still exist and can be turned back on from **Admin → Digest** (see below) — no
need to ask for a code change.

**Tuning the digest — Admin → Digest.** Every check above can be turned on or
off, and its numbers (how many days back, how many days ahead, how many items)
and lists (who to watch, whose email to ignore, which calendars to read) can be
edited from this screen, and take effect on the very next scheduled run — no
redeploy. Adding a brand-new check is still a real code change, same as the
JobTread Schedule check was.

Each section header shows a count and one of: ✅ nothing to report, a plain count
for information (the calendar's events, which are not a problem to be fixed),
⚠️ with a count when something is genuinely waiting on someone, or ❌ if that check
couldn't run (a source being down never breaks the rest of the digest — only that
one line). Tap a section to open it, tap any line to see the detail and a button
through to the Gmail thread or the JobTread record.

> **One thing to know about the email scan.** To find an appointment buried in an
> email's text, that check sends a short slice of recent inbox messages to Google's
> Gemini. It is trimmed and stripped of quoted reply history first, only the
> extracted result is kept, and no other check sends message text anywhere — they
> read sender, subject and date only.

**Refresh now** (top right of the card) rebuilds the digest immediately — useful after
you've fixed something and want to confirm it's cleared.

> **It only ever reads.** Nothing in the digest sends an email, touches a calendar
> event, or changes anything in JobTread or the Sheet.

**Changing what it checks.** All the thresholds live in one file
(`src/lib/digest/settings.ts`) — which calendars to read, how far ahead a to-do
counts as "due soon" and whose to-dos to watch, how far back the email scan looks,
how many days before an unanswered email is chased, and (for the billing checks, if
they come back on) which vendors to ignore and the billing cutoff day. Ask for an edit there rather than "turn off the noisy one";
each check can also be switched off individually. New checks get added the same way —
one new file — so this list is expected to grow.

### Logs — `/logs`

The audit trail — a read-only, newest-first feed of everything the automations do (pushes,
syncs, ingestion, diagnostics), each with a timestamp, a level (red error / amber warning),
an action, and details. Type in the search/level boxes and click **Search** (it searches
the whole log, not just what's on screen); **Refresh** reloads the latest.

---

## Tips, permissions & troubleshooting

- **Pick the job first.** Most financial pages act on the job in the top picker. If a page
  looks empty or says "pick a job above," that's usually why.
- **Amounts include tax** in the bill views; on the coding screen you *enter* amounts
  pre-tax and the app adds tax back. Don't double-count it.
- **Permissions on the phone:** Tools scanning and Employee Time photos need **camera**;
  Mileage needs **location**; Tools and Employee Time use **location** (optional) to guess
  the nearest job. If you denied one by accident, re-enable it in your browser's site
  settings.
- **"Writes are off" warnings:** on some deploys, writing to JobTread is intentionally
  turned off. You'll see a banner, and actions produce a *preview* — nothing is sent to
  JobTread, but time entries and records are still saved locally.
- **Fix bills in JobTread, not the sheet.** JobTread is the source of truth. Re-coding,
  re-dating, reassigning, or deleting a bill in JobTread flows back to the Assistant and
  Drive automatically through the hourly sync (or the **⟳ Sync** button).
- **Sync button says "Already running":** that's fine — a full sync takes ~15 minutes and
  only one runs at a time. Wait and check **Logs** for the result.
- **Side panel won't sign in:** open it in a normal browser tab once (use the "Open in a
  new tab to sign in" button), then return to the panel.
