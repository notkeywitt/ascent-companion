/**
 * Who may ask AscentBot, and what each person's answers may draw on.
 *
 * Job knowledge — selections, scope, schedule, notes, files, memory, calendar,
 * to-dos, tools, contacts, Drive and the non-staff company records — is the
 * base every allowed asker gets. On top of it a ROLE switches on AREAS:
 *
 *   financials  budgets, job cost, bills and invoices with amounts, unbilled
 *               cost, what clients owe, the coding queue;
 *   staff       the Employees records: phone, home address, birthday, license;
 *   email       the office mailbox.
 *
 * The rule is enforced by WHICH TOOLS the model is handed, not by asking it to
 * hold back: an area that is off has no tool to call. The prompt lines below
 * only tell the model how to answer around the gap.
 *
 * Roles and people live in the Companion DB (tables bot_roles, bot_users —
 * botUsers.ts) and are edited on the AscentBot page (/ascentbot, admin only).
 * Pure module: no DB, so it is tested on its own.
 */

export type BotArea = "financials" | "staff" | "email";

export const BOT_AREAS: { id: BotArea; label: string; desc: string }[] = [
  {
    id: "financials",
    label: "Financials",
    desc: "Budgets, job cost, bills and invoices with amounts, unbilled cost, what clients owe.",
  },
  {
    id: "staff",
    label: "Staff records",
    desc: "Employees' phone, email, home address, birthday and driver's license.",
  },
  {
    id: "email",
    label: "Office mailbox",
    desc: "Search and read office@ascentbuildingco.com.",
  },
];

export const ALL_AREAS: BotArea[] = BOT_AREAS.map((a) => a.id);

/**
 * Written once, when the tables are first created (src/db/index.ts). After
 * that the AscentBot page owns them. The five are the pilot group, who keep
 * everything they had and gain financials.
 */
export const BOT_SEED_ROLES: { id: string; name: string; areas: BotArea[] }[] = [
  { id: "full", name: "Full access", areas: ["financials", "staff", "email"] },
  { id: "jobs", name: "Jobs only", areas: [] },
];
export const BOT_SEED_USERS = [
  "keillor@ascentbuildingco.com",
  "office@ascentbuildingco.com",
  "ty@ascentbuildingco.com",
  "tommy@ascentbuildingco.com",
  "casey@ascentbuildingco.com",
];

/** Keeps only known area ids, once each, in BOT_AREAS order. Accepts a JSON string too. */
export function cleanAreas(raw: unknown): BotArea[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  const got = new Set(Array.isArray(list) ? list.map(String) : []);
  return ALL_AREAS.filter((a) => got.has(a));
}

/**
 * Job knowledge: every allowed asker. search_company_records is not listed:
 * googleChat.ts hands each asker a copy narrowed to the records they may read.
 */
export const JOB_TOOLS = [
  "list_jobs",
  "get_job_selections",
  "search_job_scope",
  "search_job_documents",
  "search_job_bills",
  "get_job_time",
  "get_job_schedule",
  "get_job_notes",
  "search_job_memory",
  "get_job_files",
  "read_file",
  "get_calendar",
  "find_tools",
  "get_todos",
  "find_contact",
  "search_drive",
  "list_vendors",
];

/** The registry tools each area adds. */
export const AREA_TOOLS: Record<BotArea, string[]> = {
  financials: [
    "get_job_financials",
    "get_job_cost_lines",
    "get_client_documents",
    "get_open_invoices",
    "get_vendor_bills",
    "get_unbilled",
    "get_coding_queue",
    "get_bill_detail",
    "get_job_budget",
    "get_cost_to_complete",
  ],
  staff: [],
  email: ["search_email", "read_email", "read_email_attachment"],
};

/** The registry tools one asker is handed. */
export function botToolNames(areas: BotArea[]): string[] {
  return [...JOB_TOOLS, ...areas.flatMap((a) => AREA_TOOLS[a])];
}

/** The `search_company_records` record types one asker may read. */
export function recordTypes(areas: BotArea[]): string[] {
  const all = ["employees", "vendors", "projects", "requisitions", "safety_meetings", "plans", "precover_photos"];
  return areas.includes("staff") ? all : all.filter((r) => r !== "employees");
}

/** What the bot says to someone who is not on the list, or is switched off. */
export const NOT_ALLOWED = "Sorry, I only answer people the office has added. Ask the office to add you.";

/**
 * The prompt lines that depend on what the asker may see. Each says what to
 * do when a question falls in an area that is off: point to the office, and
 * never give a figure, even one that appears earlier in the space.
 */
export function accessSystem(areas: BotArea[]): string {
  const on = (a: BotArea) => areas.includes(a);
  const lines: string[] = [];
  if (on("financials")) {
    lines.push(
      "- Money questions are yours to answer for this person: budget, cost, spend, bills, invoices,",
      "  payments, what is unbilled and what clients owe. Look it up, never estimate:",
      "  • budget vs spent, over or under budget, by job, division or cost code: get_job_financials;",
      "  • which bills or vendors make up a code's spend: get_job_cost_lines;",
      "  • contract value, change orders, what was invoiced, paid and still owed on a job:",
      "    get_client_documents; who owes us across all jobs: get_open_invoices;",
      "  • cost not yet invoiced: get_unbilled; draft bills waiting to be coded: get_coding_queue;",
      "  • one vendor across jobs (\"spent with Sunset this year\"): get_vendor_bills.",
      "  Give dollars with commas and cents only when under $100 (\"$12,480\", \"$45.20\").",
      "  Say what a figure counts (\"approved and pending bills\", \"tax included\").",
      "  Budget is at cost; an invoice total is the customer's price with tax. Don't compare them as like.",
    );
  } else {
    lines.push(
      "- This person has no access to financials. For a money question (cost, budget, spend,",
      "  invoices, bill amounts, what is owed), say the office can help, and give no figure,",
      "  even one that appears earlier in this space. What a bill BOUGHT is not a money",
      "  question: search_job_bills gives products, never amounts.",
    );
  }
  if (on("staff")) {
    lines.push(
      "- Staff details are not private for this person: the owner approved sharing every",
      "  Employees column with them (phone, email, position, hire date, birthday, home address,",
      "  driver's license). For any question about a staff member, call search_company_records",
      "  'employees' with their name and give what it returns. Never refuse one without looking.",
    );
  } else {
    lines.push(
      "- This person has no access to staff records. For a staff member's phone, address,",
      "  birthday or license, say the office can help. Give no staff detail.",
    );
  }
  if (on("email")) {
    lines.push(
      "- An email's PDF attachment (an estimate, invoice or quote): read_email gives each",
      "  attachment an attachmentId; open it with read_email_attachment before you say an",
      "  amount or detail is not recorded.",
    );
  } else {
    lines.push("- This person has no access to the office mailbox. Don't say what any email contains.");
  }
  return lines.join("\n");
}
