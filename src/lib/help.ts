/**
 * THE HELP TOPICS — the app's own instructions, as data.
 *
 * Pure data (no React, no DB), for the same reason `nav.ts` is: two surfaces
 * read it. The `/help` page renders every topic a role can use, and the header's
 * global search offers matching topics as a kind of answer. A topic added here
 * appears in both.
 *
 * ── HOW TO WRITE A TOPIC: ASD-STE100 (Simplified Technical English) ──────────
 *
 * STE-100 is the aerospace writing standard for procedures. It exists because a
 * reader who is tired, in a hurry, or reading in a second language must not have
 * to interpret an instruction. The rules used here:
 *
 *   1. One instruction per step. Two actions are two steps.
 *   2. Start a step with the verb. "Tap **Clock in**." — not "You should now…".
 *   3. Keep a step to 20 words. Keep a note to 25 words.
 *   4. Active voice, present tense. Say who does what.
 *   5. One word for one thing. A button is "tap"; a page is "open"; a value from
 *      a list is "select". Never vary the verb for style.
 *   6. Put the condition first: "If the vendor is wrong, select the vendor."
 *   7. A warning starts with the command, and states one risk one time.
 *   8. Use the article ("the", "a"). Drop no words to save space.
 *   9. No noun stack longer than three words.
 *  10. Name a control by the text on it, in `**bold**`.
 *
 * Approved technical verbs for this app, on top of the STE dictionary: tap,
 * scan, sign in, refresh, save, sync, code (a bill), clock in, clock out.
 *
 * ── ACCURACY ────────────────────────────────────────────────────────────────
 *
 * Every label in `**bold**` below is the text on the control today. When a page
 * changes its wording, this file changes with it. `USER_MANUAL.md` is the long
 * form of the same knowledge — the manual explains a screen, a topic here
 * answers one question. Keep the two in step.
 */

export interface HelpTopic {
  /** Stable slug. It is the anchor (`/help#clock-in`) and the search result id. */
  id: string;
  /** The question, as the reader would ask it. */
  q: string;
  /**
   * The gate id (see lib/views) of the page this topic is about, or null for a
   * topic every role needs. A topic for a page you cannot open is hidden — help
   * for a page that is not there reads as a fault in the app.
   */
  view: string | null;
  /** Where the topic's page lives, when it has one. */
  href?: string;
  /** The procedure. One action per line. */
  steps?: string[];
  /** Conditions, limits and things worth knowing. */
  notes?: string[];
  /** A risk. One sentence, command first. */
  warn?: string[];
  /** Extra words a person may search for. */
  keywords?: string[];
}

export interface HelpSection {
  id: string;
  title: string;
  /** One line, under 25 words, saying what the section answers. */
  blurb: string;
  topics: HelpTopic[];
}

export const HELP: HelpSection[] = [
  /* ───────────────────────────────────────────────────────────── start here */
  {
    id: "start",
    title: "Start here",
    blurb: "Sign in, put the app on your phone, and find your way around.",
    topics: [
      {
        id: "sign-in",
        q: "How do I sign in?",
        view: null,
        keywords: ["login", "log in", "password", "google", "access", "locked out"],
        steps: [
          "Open the app link on your phone or your computer.",
          "Tap **Sign in with Google**.",
          "Select your Ascent Google account.",
        ],
        notes: [
          "Only staff on the access list can sign in.",
          "If the app refuses your address, ask an administrator to add it.",
          "The app keeps you signed in. You sign in one time for each device.",
          "Use **or use the shared password** only when Google sign-in does not work.",
        ],
      },
      {
        id: "install-phone",
        q: "How do I put the app on my phone?",
        view: null,
        keywords: ["install", "home screen", "icon", "app", "iphone", "android", "pwa"],
        steps: [
          "If you have an iPhone, open the app in Safari.",
          "Tap **Share**.",
          "Tap **Add to Home Screen**.",
          "If you have an Android phone, open the app in Chrome.",
          "Tap the **⋮** menu.",
          "Tap **Install app**.",
        ],
        notes: [
          "The app then has its own icon and opens full screen.",
          "The app also works in a normal browser tab.",
        ],
      },
      {
        id: "find-page",
        q: "How do I find a page?",
        view: null,
        keywords: ["home", "menu", "navigate", "buttons", "the rest", "where is"],
        steps: [
          "Tap **Home** at the bottom of the screen.",
          "Tap one of the large buttons for the pages you use each day.",
          "Tap **The Rest** for every other page you can open.",
        ],
        notes: [
          "The bottom bar holds up to three shortcuts beside **Home**.",
          "Your role decides which pages you see.",
          "This help page is in **The Rest**, and in the **Utilities** list.",
        ],
      },
      {
        id: "search",
        q: "How do I search?",
        view: null,
        keywords: ["find", "search box", "vendor", "line item", "bill number"],
        steps: [
          "Tap the search box at the top of the screen.",
          "Type a page name, a vendor name, or a word from a bill line.",
          "Tap a result.",
        ],
        notes: [
          "Type a number alone to look up that bill number.",
          "The box searches pages, vendors, bills, line items and this help page.",
          "Field users have no search box. Use the buttons on **Home**.",
        ],
      },
      {
        id: "theme",
        q: "How do I change the light and dark theme?",
        view: null,
        keywords: ["dark mode", "light mode", "colour", "color", "palette", "appearance"],
        steps: ["Tap the Ascent logo at the top left of the screen."],
        notes: [
          "The logo is the only light and dark control.",
          "Open **Appearance** on **Home** to change the colour palette.",
          "Each device keeps its own theme.",
        ],
      },
      {
        id: "pick-job",
        q: "How do I select a job?",
        view: "recode",
        href: "/trackingsheet",
        keywords: ["job picker", "customer", "which job", "pick a job", "all jobs"],
        steps: [
          "Open **Tracking Sheets**.",
          "Tap the page title.",
          "Type a customer name, a job number, a job name, or an address.",
          "Tap the job.",
        ],
        notes: [
          "The page title is the job selector. The job list opens over the page.",
          "The job you select is the job the financial pages act on.",
          "The job stays selected as you move between pages.",
          "Select **All jobs** to see every job in the month.",
          "If a page tells you to select a job, come back here first.",
        ],
      },
    ],
  },

  /* ─────────────────────────────────────────────────────────────── my work */
  {
    id: "mywork",
    title: "My work",
    blurb: "Your time, your miles, the tools, and what you ask the office for.",
    topics: [
      {
        id: "clock-in",
        q: "How do I clock in?",
        view: "employee-time",
        href: "/employee-time",
        keywords: ["time clock", "hours", "start work", "clock"],
        steps: [
          "Open **Time**.",
          "Make sure the **Job**, the **Cost code** and the **Pay type** are correct.",
          "To change one, tap its row and select a new value.",
          "Tap **Clock in**.",
        ],
        notes: [
          "The three rows hold the values you used last, so most days you change nothing.",
          "The clock starts at the current time.",
          "To clock in for an earlier time, tap the day chip or the time chip.",
          "Your clock is in JobTread. You can clock out on a different phone.",
        ],
      },
      {
        id: "clock-out",
        q: "How do I clock out?",
        view: "employee-time",
        href: "/employee-time",
        keywords: ["stop work", "end shift", "note", "photos", "forgot to clock out"],
        steps: [
          "Open **Time**.",
          "Tap **Clock out**.",
          "Write the **Note**.",
          "Add photos of the work if they help.",
          "Tap the button at the bottom to confirm.",
        ],
        notes: [
          "The note is necessary. The app does not log the time without it.",
          "The limit is 8 photos.",
          "If you forgot to clock out, tap the day chip or the time chip in the same panel.",
          "Set the correct stop time. The panel then shows the new length.",
          "A stop time later than the current time is not permitted.",
        ],
        warn: [
          "Use **Cancel this clock-in** only to throw a clock away. It logs no time.",
        ],
      },
      {
        id: "log-past-time",
        q: "How do I log time I already worked?",
        view: "employee-time",
        href: "/employee-time",
        keywords: ["log a range", "add hours", "yesterday", "missed time", "backdate"],
        steps: [
          "Open **Time**.",
          "Tap the **+** button beside **Clock in**.",
          "Select the job, the cost code and the pay type.",
          "Set the start time and the stop time.",
          "Write the note.",
          "Tap **Log time**.",
        ],
        notes: ["This writes one entry. No clock runs."],
      },
      {
        id: "timesheet",
        q: "How do I see the hours I logged?",
        view: "employee-time",
        href: "/employee-time",
        keywords: ["timesheet", "pay period", "approved", "pending", "my hours"],
        steps: [
          "Open **Time**.",
          "Tap the **Timesheets** tab.",
          "Use the month arrows to select the month.",
          "Tap the **1–15** pill or the **16–end** pill to select the period.",
        ],
        notes: [
          "Each day shows its total and its state: **Approved**, **Pending** or **Clocked in**.",
          "Tap an entry to open that time in JobTread.",
        ],
      },
      {
        id: "mileage",
        q: "How do I log my miles?",
        view: "mileage",
        href: "/mileage-tracker",
        keywords: ["miles", "trip", "driving", "gps", "mileage"],
        steps: [
          "Open **Miles**.",
          "Make sure the **Driver** is you.",
          "Select a **Job** and a **Purpose** if they apply.",
          "Tap **Start trip** before you drive.",
          "Tap **End trip** when you arrive.",
        ],
        notes: [
          "The app fills in the miles, the time and the two addresses.",
          "Allow location for the start and the end. The app cannot work without it.",
          "You can lock the phone between the two taps.",
          "Tap **Add miles** for a trip you forgot.",
          "Tap **View logged miles** to read your history.",
          "Log each stop of a multi-stop trip as its own trip.",
        ],
      },
      {
        id: "tools-move",
        q: "How do I move a tool to a job?",
        view: "tools",
        href: "/tools",
        keywords: ["tool", "scan", "qr", "sticker", "location", "job site"],
        steps: [
          "Open **Tools**.",
          "Tap **Scan a tool**.",
          "Point the camera at the QR sticker on the tool.",
          "Select the job in **Set location to**.",
          "Tap **Update location**.",
        ],
        notes: [
          "Allow the camera for the scan.",
          "Location permission puts the nearest job first in the list.",
          "You can also find the tool by name and edit its location.",
        ],
      },
      {
        id: "tools-new",
        q: "How do I add a new tool?",
        view: "tools",
        href: "/tools",
        keywords: ["new tool", "register", "inventory", "serial", "photo"],
        steps: [
          "Open **Tools**.",
          "Tap **Scan a tool**.",
          "Point the camera at the new sticker.",
          "Write the **Name** in the **New tool** form that opens.",
          "Add a photo, the type, the condition and the location.",
          "Tap **Add tool**.",
        ],
        notes: [
          "The name is necessary. The other fields are not.",
          "The sticker code becomes the tool ID.",
          "Tap **New tool** for a tool that has no sticker.",
          "The **Scan** button beside **Serial number** reads the serial off the label.",
          "Check a scanned serial yourself. The camera makes mistakes.",
        ],
      },
      {
        id: "requisition",
        q: "How do I ask the office to buy something?",
        view: "requisitions",
        href: "/requisitions",
        keywords: ["requisition", "materials", "rental", "purchase", "order", "supplies"],
        steps: [
          "Open **Requisitions**.",
          "Tap **New request**.",
          "Write a short **Title**.",
          "Select the **Job**, the **Type** and the **Priority**.",
          "Write what you need in the **What do you need?** box.",
          "Tap **Submit request**.",
        ],
        notes: [
          "Add **Needed by**, **Est. cost** and **Deliver to** when you know them.",
          "The office sets the status: Requested, Ordered, Received, Denied or Canceled.",
          "Your requests stay on the page with their status.",
        ],
      },
      {
        id: "time-off",
        q: "How do I request time off?",
        view: "time-off",
        href: "/time-off",
        keywords: ["pto", "sick", "vacation", "leave", "balance", "time off"],
        steps: [
          "Open **Time Off**.",
          "Tap **Request time off**.",
          "Select the **Type**.",
          "Write the **Amount** in hours and minutes.",
          "Set the **Start date**.",
          "Tap **Submit request**.",
        ],
        notes: [
          "Set the **End date** for more than one day.",
          "Your balance is at the top of the page.",
          "**My requests** shows what you asked for and its status.",
        ],
      },
      {
        id: "safety-meeting",
        q: "How do I record a safety meeting?",
        view: "safety-meeting",
        href: "/safety-meeting",
        keywords: ["toolbox talk", "signature", "attendance", "roster", "ipad"],
        steps: [
          "Open **Safety Meeting** on the iPad.",
          "Set the **Date**.",
          "Write the **Topic**.",
          "Select the **Meeting lead**.",
          "Select the name of the first person.",
          "Let that person sign on the pad.",
          "Tap **Add attendee**.",
          "Repeat the last three steps for each person.",
          "Tap **Save meeting**.",
        ],
        notes: [
          "The app needs a topic, a lead, and one signed person minimum.",
          "The app files a signed roster PDF in Drive and gives you the link.",
          "The pad needs no camera and no location.",
        ],
      },
      {
        id: "rfi",
        q: "How do I raise an RFI?",
        view: "rfis",
        href: "/rfis",
        keywords: ["rfi", "request for information", "question", "architect"],
        steps: [
          "Open **RFIs**.",
          "Select the job.",
          "Tap **+ New RFI**.",
          "Write the **Subject**.",
          "Write the assignee and the dates.",
          "Save the form.",
        ],
        notes: [
          "The subject is necessary.",
          "Tap an RFI to open it, write the **Answer**, and set its status.",
          "A text field saves when you tap away from it. A date and a status save at once.",
          "RFIs stay in this app. They do not reach JobTread.",
        ],
      },
    ],
  },

  /* ───────────────────────────────────────────────────── bills and invoices */
  {
    id: "bills",
    title: "Bills and invoices",
    blurb: "A bill arrives, gets a job, gets a cost code, and reaches the client invoice.",
    topics: [
      {
        id: "add-bill",
        q: "How do I add a vendor bill?",
        view: "coding",
        href: "/add-bill",
        keywords: ["add bill", "invoice", "photograph", "upload", "vendor bill", "log bill"],
        steps: [
          "Select the job first.",
          "Tap the **＋** button at the top of the screen.",
          "Select the invoice file.",
          "Select the **Vendor** if you know it.",
          "Tap **Log Bill**.",
        ],
        notes: [
          "On a computer the button says **＋ Add bill**.",
          "A PDF or a photo up to 15 MB is permitted.",
          "The app reads the invoice, codes the lines, and makes a draft bill in JobTread.",
          "The app takes the billing month from the upload date, not from the invoice.",
          "The same invoice twice does not make a second bill.",
          "If the app cannot match the vendor, select the vendor and send the bill again.",
          "Tick **Single line — don't itemize** to make one cost item for a long invoice.",
          "A line whose cost code is not in the budget stays uncoded. Code it in **Tracking Sheets**.",
        ],
        warn: [
          "Check the job before you tap **Log Bill**. The bill goes on the job you selected.",
        ],
      },
      {
        id: "code-bill",
        q: "How do I code a vendor bill?",
        view: "recode",
        href: "/trackingsheet",
        keywords: ["code", "cost code", "coding", "recode", "csi", "budget"],
        steps: [
          "Open **Tracking Sheets**.",
          "Tap the page title and select the job.",
          "Tap the bill you must code.",
          "Compare the invoice image against the line items.",
          "Select a cost code for each line.",
          "Tap **Save changes**.",
        ],
        notes: [
          "Use **Apply one code to all lines** for a bill with many lines.",
          "Under a code, the page shows the budget left for it. Red means over budget.",
          "The amounts on the page include tax.",
          "Type an amount before tax. The app adds the tax back.",
          "The app warns you if you leave the page with unsaved coding.",
        ],
        warn: [
          "Change amounts in JobTread when a bill is no longer a draft. JobTread locks them.",
        ],
      },
      {
        id: "needs-project",
        q: "How do I give an ingested bill its job?",
        view: "needs-project",
        href: "/needs-project",
        keywords: ["needs project", "no job", "unassigned", "assign", "ingested"],
        steps: [
          "Open **Needs Project**.",
          "Tap **View PDF ↗** to read the bill.",
          "Select the job in that row.",
          "Tap **Assign**.",
        ],
        notes: [
          "The app pushes the bill to that job and files the PDF in Drive.",
          "Each row has its own job selector.",
          "Tap **Dismiss** for a duplicate, or for mail that is not a bill.",
          "**Dismiss** keeps the row and the PDF. It only stops the row showing here.",
        ],
      },
      {
        id: "email-invoices",
        q: "How do I log an invoice from the office inbox?",
        view: "email",
        href: "/email",
        keywords: ["email", "inbox", "gmail", "log invoice", "attachment"],
        steps: [
          "Open **Email Invoices**.",
          "Tap **Refresh**.",
          "Select the job for the email.",
          "Tap **PAID** if the invoice is already paid.",
          "Tap **Log Invoice**.",
        ],
        notes: [
          "One invoice takes 15 to 45 seconds. Wait for the green mark.",
          "An email with several PDFs has one job selector for each PDF.",
          "Give every PDF a job, then tap **Log all N invoices**.",
          "Tap **✓ Processed** for an invoice that someone entered in JobTread by hand.",
          "Tap **Not relevant** for mail that is not an invoice.",
          "The **Handled** tray at the bottom holds an **Undo** for each row.",
        ],
      },
      {
        id: "unbilled",
        q: "How do I see what a job has not billed yet?",
        view: "unbilled",
        href: "/unbilled",
        keywords: ["unbilled", "uninvoiced", "at cost", "wip"],
        steps: ["Open **Unbilled**.", "Select the job.", "Read the **Unbilled (at cost)** figure."],
        notes: [
          "The page needs one job. It cannot report every job at once.",
          "The table splits the figure by type and status.",
          "The page only reads. It changes nothing.",
        ],
      },
      {
        id: "invoice-month",
        q: "How do I invoice a job for the month?",
        view: "recode",
        href: "/trackingsheet",
        keywords: ["client invoice", "customer invoice", "stage", "month", "billing"],
        steps: [
          "Open **Tracking Sheets**.",
          "Select the billing month.",
          "Read the card for each job.",
          "Tap the job to open its workbench.",
          "Code every bill that has no cost code.",
          "Tap **Check this job** and read the findings.",
          "Make the customer invoice in JobTread.",
        ],
        notes: [
          "JobTread makes the invoice. This app prepares the month for it.",
          "**Check this job** runs the invoice-review checks while a fix is still cheap.",
          "The billing month runs from the 10th to the 10th.",
        ],
      },
      {
        id: "invoice-review",
        q: "How do I check a month of client invoices?",
        view: "invoice-review",
        href: "/invoice-review",
        keywords: ["invoice review", "audit", "findings", "backup", "check"],
        steps: [
          "Open **Invoice Review**.",
          "Select the month.",
          "Tap **Run review**.",
          "Read each finding.",
          "Fix each problem in JobTread.",
          "Tap **Check again**.",
        ],
        notes: [
          "The review takes about a minute.",
          "The review cross-checks the invoices, the bills behind them, the Drive backup and the mailbox.",
          "**Investigate** has Claude chase each finding and report what it found.",
          "A note that a finding is acceptable stays in this app. JobTread does not see it.",
        ],
      },
      {
        id: "payments",
        q: "How do I pay a Sunset statement?",
        view: "payments",
        href: "/payments",
        keywords: ["sunset", "statement", "tsys", "pay", "payment", "discount"],
        steps: [
          "Open **Sunset Statements**.",
          "Read the **net to pay** on the statement card.",
          "Tap **Copy** for the account and for the statement number.",
          "Tap **Pay at TSYS ↗**.",
          "Pay at the TSYS page.",
          "Tap **Mark paid**.",
        ],
        notes: [
          "The filter opens on **unpaid**.",
          "The card reads the account, the statement number, the total and the discount off the PDF.",
          "Tap **Undo paid** if you marked the wrong statement.",
        ],
      },
      {
        id: "find-bill",
        q: "How do I find a bill?",
        view: "bill-search",
        href: "/bill-search",
        keywords: ["bill search", "invoice number", "2x4", "line item", "history"],
        steps: [
          "Type the vendor, the invoice number, or a word from a line in the search box.",
          "Tap the bill in the results.",
        ],
        notes: [
          "Open **Bill Search** to see every match instead of the first few.",
          "The index holds the years before JobTread as well.",
          "A bill from those years opens its PDF in Drive.",
        ],
      },
    ],
  },

  /* ──────────────────────────────────────────────────────── office and admin */
  {
    id: "office",
    title: "Office and admin",
    blurb: "The roster, the team's notices, access, and the record of what the app did.",
    topics: [
      {
        id: "employees",
        q: "How do I edit the employee roster?",
        view: "employees",
        href: "/employees",
        keywords: ["roster", "employee", "project database", "jobtread user", "link"],
        steps: [
          "Open **Employees**.",
          "Find the person.",
          "Tap **Edit**.",
          "Change the fields you must change.",
          "Save the row.",
        ],
        notes: [
          "The **JobTread** column offers **Link** when the match is clear.",
          "The app writes only the fields you changed.",
        ],
        warn: ["Check each edit before you save. The roster changes at once, with no undo."],
      },
      {
        id: "notice",
        q: "How do I tell the whole team something?",
        view: "notices",
        href: "/notices",
        keywords: ["notice", "announcement", "banner", "popup", "message the team"],
        steps: [
          "Open **Notices**.",
          "Tap **New notice**.",
          "Write the **Title** and the message.",
          "Select **Banner** or **Popup** in **Show as**.",
          "Select who sees it.",
          "Set the start and the end, or leave both empty.",
          "Save the notice.",
        ],
        notes: [
          "A banner sits under the header. A popup covers the page until the reader closes it.",
          "Each person sees a notice one time. A dismissal follows them to every device.",
          "The **On/Off** switch stops a notice and keeps its read history.",
          "To reach a person again, post a new notice.",
        ],
        warn: ["Use **Popup** only for something the team must read now."],
      },
      {
        id: "access",
        q: "How do I let a new person sign in?",
        view: "admin",
        href: "/admin",
        keywords: ["admin", "access", "allowlist", "add user", "remove user", "role"],
        steps: [
          "Open **Admin**.",
          "Type the person's Ascent email address.",
          "Tap **Add**.",
          "Set their role.",
        ],
        notes: [
          "A change takes effect at once.",
          "Founders come from the hosting settings. You cannot remove them.",
          "A role sets the pages a person sees. You can also grant one page to one person.",
        ],
        warn: ["Check the address before you tap **Remove**. There is no confirmation."],
      },
      {
        id: "logs",
        q: "How do I see what the automation did?",
        view: "logs",
        href: "/logs",
        keywords: ["logs", "audit", "error", "sync result", "ingestion"],
        steps: [
          "Open **Logs**.",
          "Type a word in the search box.",
          "Select a level.",
          "Tap **Search**.",
        ],
        notes: [
          "The feed is newest first, and it only reads.",
          "The search reads the whole log, not the rows on the screen.",
          "Each row carries a time, a level, an action and the detail.",
        ],
      },
      {
        id: "actions",
        q: "How do I run a script job now?",
        view: "actions",
        href: "/actions",
        keywords: ["actions", "run", "sync", "script", "schedule"],
        steps: ["Open **Actions**.", "Find the job.", "Tap **Run**.", "Read the result note."],
        notes: [
          "**Logs** records every run.",
          "“Lock busy — nothing ran” means a sync is already running. Wait.",
        ],
        warn: ["Run an action only when you must. Each one acts on production at once."],
      },
      {
        id: "changelog",
        q: "How do I see what changed in the app?",
        view: "changelog",
        href: "/changelog",
        keywords: ["changelog", "release", "what changed", "new", "in flight"],
        steps: ["Open **Changelog**.", "Tap a row to read that session's changes."],
        notes: [
          "The number at the top counts the changes of the last 30 days.",
          "An **in flight** mark means the work is not finished.",
          "The **Next:** line says where that work stopped.",
        ],
      },
      {
        id: "request-change",
        q: "How do I ask for a fix or a new feature?",
        view: "requests",
        href: "/requests",
        keywords: ["request", "feature", "bug", "suggestion", "broken"],
        steps: [
          "Open **Requests**.",
          "Tap **+ Request**.",
          "Write the title.",
          "Write what you expected and what happened.",
          "Tap **Submit**.",
        ],
        notes: [
          "The title is necessary. The detail is not.",
          "Anyone can set a request to open, planned, done or declined.",
        ],
      },
    ],
  },

  /* ───────────────────────────────────────────────────── when it goes wrong */
  {
    id: "trouble",
    title: "If something does not work",
    blurb: "The faults people meet most, and what to do about each one.",
    topics: [
      {
        id: "empty-page",
        q: "The page is empty. What do I do?",
        view: null,
        keywords: ["blank", "empty", "nothing here", "pick a job", "no data"],
        steps: [
          "Read the message on the page.",
          "If it asks for a job, open **Tracking Sheets** and select one.",
          "If the page still shows nothing, refresh it.",
        ],
        notes: [
          "Most financial pages act on one job.",
          "An empty invoicing page also means every approved bill is already invoiced.",
        ],
      },
      {
        id: "permissions",
        q: "The camera or the location does not work. What do I do?",
        view: null,
        keywords: ["camera", "location", "gps", "permission", "denied", "blocked"],
        steps: [
          "Open your browser's settings for this site.",
          "Allow the camera, the location, or both.",
          "Refresh the app.",
        ],
        notes: [
          "**Tools** needs the camera for a scan.",
          "**Miles** needs the location for the start and the end of a trip.",
          "**Tools** and **Time** use the location to guess the nearest job. That use is optional.",
        ],
      },
      {
        id: "sync-busy",
        q: "The sync says “Already running”. What do I do?",
        view: "recode",
        href: "/trackingsheet",
        keywords: ["sync", "already running", "drive", "lock", "15 minutes"],
        steps: ["Wait.", "Read the result in **Logs**."],
        notes: [
          "One sync runs at a time. A full sync takes about 15 minutes.",
          "The button confirms that the sync started, not that it finished.",
          "More taps start nothing.",
        ],
      },
      {
        id: "preview-mode",
        q: "The app says it did not write to JobTread. Why?",
        view: null,
        keywords: ["writes", "preview", "dry run", "not sent", "banner"],
        notes: [
          "Some deploys turn the JobTread writes off. A banner then says so.",
          "An action shows you what it would do, and sends nothing.",
          "The app still saves your time entries and records. The office can send them later.",
          "Ask an administrator whether writes are on.",
        ],
      },
      {
        id: "wrong-bill",
        q: "A bill is wrong. Where do I fix it?",
        view: null,
        keywords: ["wrong", "fix", "delete", "void", "source of truth", "jobtread"],
        steps: [
          "Fix the bill in JobTread.",
          "Wait for the hourly sync, or tap **Sync to Tracking Sheet**.",
        ],
        notes: [
          "JobTread is the source of truth. The sheets and Drive mirror it.",
          "A re-code, a new date, or a new job in JobTread reaches this app on its own.",
          "Tap **Flag for review** on a bill the app cannot correct.",
        ],
        warn: [
          "Never delete a bill. Ask the office to void it, so the history stays.",
        ],
      },
      {
        id: "side-panel",
        q: "The Chrome side panel will not sign in. What do I do?",
        view: null,
        keywords: ["side panel", "chrome", "extension", "desktop", "jobtread beside"],
        steps: [
          "Tap **Open in a new tab to sign in**.",
          "Sign in in that tab.",
          "Return to the side panel.",
        ],
        notes: [
          "Google sign-in cannot run inside the panel.",
          "The panel then stays signed in.",
          "The panel follows the job you open in JobTread.",
        ],
      },
      {
        id: "still-stuck",
        q: "I am still stuck. Who do I ask?",
        view: null,
        keywords: ["help", "support", "who", "ask", "stuck", "problem"],
        steps: [
          "Open **Requests**.",
          "Write what you did, what you expected, and what happened.",
          "Tap **Submit**.",
        ],
        notes: [
          "Name the page and the job. That is what makes a fault easy to find.",
          "Tell the office at once if the fault stops your work.",
        ],
      },
    ],
  },
];

/** Every topic, flat, in page order. */
export const ALL_TOPICS: HelpTopic[] = HELP.flatMap((s) => s.topics);

/** A topic by id, for a deep link (`/help#clock-in`). */
export function getHelpTopic(id: string): HelpTopic | undefined {
  return ALL_TOPICS.find((t) => t.id === id);
}

/** Can this reader use this topic? A topic with no view is for everyone. */
export function topicVisible(t: HelpTopic, can: (view: string) => boolean): boolean {
  return t.view === null || can(t.view);
}

/**
 * The sections this reader can use, with the topics they cannot dropped, and any
 * section that empties out dropped with them.
 */
export function visibleHelp(can: (view: string) => boolean): HelpSection[] {
  return HELP.map((s) => ({ ...s, topics: s.topics.filter((t) => topicVisible(t, can)) })).filter(
    (s) => s.topics.length > 0,
  );
}

/** The words a search matches against — everything the topic says. */
function haystack(t: HelpTopic): string {
  return [t.q, ...(t.keywords ?? []), ...(t.steps ?? []), ...(t.notes ?? []), ...(t.warn ?? [])]
    .join(" ")
    .toLowerCase()
    // A search for "clock in" must not miss "Tap **Clock in**".
    .replace(/\*\*/g, "");
}

/**
 * Search the topics. Used by the header's global search, so it is deliberately
 * cheap: a substring test over strings that ship with the bundle.
 *
 * A hit on the QUESTION ranks above a hit in the body — "How do I clock in?"
 * is the answer to "clock in", and a step that mentions the clock is not.
 */
export function searchHelp(
  query: string,
  can: (view: string) => boolean,
  limit = 4,
): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = ALL_TOPICS.filter((t) => topicVisible(t, can) && haystack(t).includes(q));
  const asked = (t: HelpTopic) => (t.q.toLowerCase().includes(q) ? 0 : 1);
  return hits.sort((a, b) => asked(a) - asked(b)).slice(0, limit);
}
