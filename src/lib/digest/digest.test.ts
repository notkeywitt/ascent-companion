import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHECKS, enabledChecks } from "./registry";
import { DIGEST_CATEGORIES, DIGEST_SETTINGS, categoryLabel, categoryOrder } from "./settings";
import { categoryTone, groupByCategory, titleCase, worstStatus } from "./grouping";
import { fallbackSummary } from "./run";
import { openBillingPeriod } from "./checks/draftBillsPastCutoff";
import { billMatchesEmail, matchVendor, normalizeVendorName } from "./checks/uncapturedBills";
import { humanizeFlag } from "./checks/reconciliationFlags";
import { dayLabel } from "./checks/calendarEvents";
import { isExcludedJob } from "./checks/costVsInvoice";
import type { StoredCheckResult } from "./types";

/**
 * The digest's testable surface: the registry wiring that makes a check RUN at
 * all, the category grouping that makes the UI data-driven, and the four
 * judgment calls a check makes (is this month closed / is this the same invoice
 * / is this job excluded / what is this day called). Everything else is I/O.
 */

const result = (over: Partial<StoredCheckResult> = {}): StoredCheckResult => ({
  id: "x",
  title: "X",
  category: "billing",
  status: "ok",
  summary: "fine",
  items: [],
  durationMs: 1,
  ...over,
});

describe("registry wiring", () => {
  it("binds every declared check to a settings block", () => {
    for (const check of CHECKS) {
      expect(DIGEST_SETTINGS, `no settings block for check "${check.id}"`).toHaveProperty(check.id);
      expect(check.config).toEqual(
        (DIGEST_SETTINGS as Record<string, { config: unknown }>)[check.id].config,
      );
    }
  });

  it("takes `enabled` from settings, not from the check file", () => {
    for (const check of CHECKS) {
      const block = (DIGEST_SETTINGS as Record<string, { enabled: boolean }>)[check.id];
      expect(check.enabled).toBe(block.enabled);
    }
    expect(enabledChecks().length).toBeGreaterThan(0);
  });

  it("gives every check a unique id and a registered category", () => {
    const ids = CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHECKS) {
      expect(DIGEST_CATEGORIES.map((x) => x.id)).toContain(c.category);
    }
  });
});

describe("category grouping (why the UI has no hardcoded tabs)", () => {
  it("orders categories as configured and drops empty ones", () => {
    const views = groupByCategory(
      [result({ id: "a", category: "followup" }), result({ id: "b", category: "billing" })],
      DIGEST_CATEGORIES,
    );
    expect(views.map((v) => v.id)).toEqual(["followup", "billing"]);
  });

  it("renders a category no one registered, rather than losing its check", () => {
    const views = groupByCategory([result({ id: "s", category: "safety_walks" })], DIGEST_CATEGORIES);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ id: "safety_walks", label: "Safety Walks" });
  });

  it("rolls up worst-status and counts items", () => {
    const views = groupByCategory(
      [
        result({ id: "a", status: "warning", items: [{ title: "one" }, { title: "two" }] }),
        result({ id: "b", status: "error" }),
      ],
      DIGEST_CATEGORIES,
    );
    expect(views[0].status).toBe("error");
    expect(views[0].itemCount).toBe(2);
  });

  it("worstStatus prefers error, then warning", () => {
    expect(worstStatus([result({ status: "ok" })])).toBe("ok");
    expect(worstStatus([result({ status: "ok" }), result({ status: "warning" })])).toBe("warning");
    expect(worstStatus([result({ status: "warning" }), result({ status: "error" })])).toBe("error");
  });

  it("draws an ok check that still has items as info, not as Clear", () => {
    // The calendar's own case: a busy day is `ok` (not a problem) but must not
    // render as a green tick with the event count hidden — which is what the
    // card did before the digest led with Calendar.
    expect(categoryTone({ status: "ok", itemCount: 12 })).toBe("info");
    expect(categoryTone({ status: "ok", itemCount: 0 })).toBe("clear");
  });

  it("keeps a real problem ahead of the informational tone", () => {
    expect(categoryTone({ status: "warning", itemCount: 3 })).toBe("warning");
    expect(categoryTone({ status: "error", itemCount: 0 })).toBe("error");
    // An errored check with items is still an error, never info.
    expect(categoryTone({ status: "error", itemCount: 5 })).toBe("error");
  });

  it("labels and orders categories from settings", () => {
    expect(categoryLabel("billing")).toBe("Billing");
    expect(categoryLabel("safety_walks")).toBe("Safety Walks");
    expect(categoryOrder("billing")).toBeLessThan(categoryOrder("nope"));
    expect(titleCase("cost-vs-invoice")).toBe("Cost Vs Invoice");
  });
});

describe("draft bills: which billing month is still open", () => {
  // The cutoff is INCLUSIVE — a bill arriving ON the 10th still bills to the
  // previous month, so that month stays open through the 10th.
  const on = (iso: string) => new Date(`${iso}T12:00:00-07:00`);

  it("keeps the previous month open through the cutoff day", () => {
    expect(openBillingPeriod(on("2026-08-05"), 10)).toBe(202607);
    expect(openBillingPeriod(on("2026-08-10"), 10)).toBe(202607);
  });

  it("closes it the day after", () => {
    expect(openBillingPeriod(on("2026-08-11"), 10)).toBe(202608);
    expect(openBillingPeriod(on("2026-08-31"), 10)).toBe(202608);
  });

  it("rolls the year back across January", () => {
    expect(openBillingPeriod(on("2026-01-05"), 10)).toBe(202512);
  });

  it("follows a changed cutoff day", () => {
    expect(openBillingPeriod(on("2026-08-10"), 5)).toBe(202608);
    expect(openBillingPeriod(on("2026-08-10"), 15)).toBe(202607);
  });
});

describe("uncaptured bills: matching a sender to a vendor", () => {
  const vendors = [
    { id: "1", name: "Ace Hardware" },
    { id: "2", name: "Ace Hardware Lopez Island" },
    { id: "3", name: "Ferguson Enterprises, Inc." },
  ];

  it("strips corporate noise when normalizing", () => {
    expect(normalizeVendorName("Ferguson Enterprises, Inc.")).toBe("ferguson enterprises");
    expect(normalizeVendorName("Smith & Sons LLC")).toBe("smith and sons");
  });

  it("prefers the longer, more specific vendor name", () => {
    const hit = matchVendor({ fromName: "Ace Hardware Lopez Island", fromDomain: "acelopez.com" }, vendors);
    expect(hit?.id).toBe("2");
  });

  it("falls back to the sender's domain", () => {
    expect(matchVendor({ fromName: "Billing Dept", fromDomain: "ferguson.com" }, vendors)?.id).toBe("3");
  });

  it("returns null rather than guessing", () => {
    expect(matchVendor({ fromName: "Some Newsletter", fromDomain: "example.org" }, vendors)).toBeNull();
  });
});

describe("uncaptured bills: is this bill that email's invoice", () => {
  const cfg = { matchWindowDays: 21, amountTolerance: 0.12 };
  const bill = (issueDate: string, cost: number) =>
    ({ id: "b", number: 1, jobId: null, jobName: "", cost, status: "approved", issueDate });

  it("matches on the date window alone when the subject printed no amount", () => {
    expect(billMatchesEmail(bill("2026-08-20", 500), "2026-08-15", null, cfg)).toBe(true);
    expect(billMatchesEmail(bill("2026-06-01", 500), "2026-08-15", null, cfg)).toBe(false);
  });

  it("absorbs sales tax when the subject did print one", () => {
    // $500 pre-tax cost vs a $543 tax-inclusive total — the same invoice.
    expect(billMatchesEmail(bill("2026-08-15", 500), "2026-08-15", 543, cfg)).toBe(true);
    expect(billMatchesEmail(bill("2026-08-15", 500), "2026-08-15", 900, cfg)).toBe(false);
  });

  it("never matches without dates on both sides", () => {
    expect(billMatchesEmail(bill("", 500), "2026-08-15", null, cfg)).toBe(false);
    expect(billMatchesEmail(bill("2026-08-15", 500), "", null, cfg)).toBe(false);
  });
});

describe("cost vs invoice: the accepted-gap list is data", () => {
  const config = {
    gapThreshold: 5000,
    excludeJobIds: ["JT123"],
    excludeJobNames: ["barn remodel"],
    maxJobs: 60,
    concurrency: 4,
  };
  const job = (id: string, name: string, customer = "") => ({ id, name, customer });

  it("excludes by id", () => {
    expect(isExcludedJob(job("JT123", "Anything"), config)).toBe(true);
  });
  it("excludes by case-insensitive name fragment, customer included", () => {
    expect(isExcludedJob(job("x", "Old Barn Remodel Phase 2"), config)).toBe(true);
    expect(isExcludedJob(job("x", "Kitchen", "Barn Remodel LLC"), config)).toBe(true);
  });
  it("keeps everything else", () => {
    expect(isExcludedJob(job("x", "New Build"), config)).toBe(false);
  });
  it("an empty exclusion entry excludes nothing", () => {
    expect(isExcludedJob(job("x", "New Build"), { ...config, excludeJobNames: [""] })).toBe(false);
  });
});

describe("presentation helpers", () => {
  it("humanizes a flag name", () => {
    expect(humanizeFlag("AMOUNT_MISMATCH")).toBe("Amount mismatch");
    expect(humanizeFlag("NO_LINE_ITEMS")).toBe("No line items");
  });

  it("names calendar days relative to today", () => {
    expect(dayLabel("2026-08-31", "2026-08-31")).toBe("Today");
    expect(dayLabel("2026-09-01", "2026-08-31")).toBe("Tomorrow");
    expect(dayLabel("2026-09-02", "2026-08-31")).toBe("Wed, Sep 2");
  });
});

describe("fallback summary (used when Gemini is unreachable)", () => {
  it("says all clear only when nothing is flagged or broken", () => {
    expect(fallbackSummary([result(), result()])).toBe("All checks are clear this morning.");
  });

  it("never claims all clear while a check errored", () => {
    const text = fallbackSummary([result(), result({ id: "e", title: "Calendar", status: "error" })]);
    expect(text).not.toContain("All checks are clear");
    expect(text).toContain("Calendar");
  });

  it("counts flagged items across checks", () => {
    const text = fallbackSummary([
      result({ status: "warning", summary: "2 uncaptured bills found.", items: [{ title: "a" }, { title: "b" }] }),
    ]);
    expect(text).toContain("2 items need attention");
    expect(text).toContain("2 uncaptured bills found.");
  });
});

describe("the isolation contract: one dead source must not kill the digest", () => {
  // Nothing is configured — no Apps Script URL, no JobTread grant, no Claude
  // key — so every check hits an unreachable source. That is the scenario this
  // whole design exists for, and it must produce a COMPLETE digest of errors,
  // not an exception. Fully offline: callAppsScript short-circuits on the
  // missing env, and the Claude calls are skipped without a key.
  //
  // DATABASE_URL is pointed at an unopenable path for the same reason. Not
  // every check reads an external service — `digest-todos` reads our OWN
  // database — so leaving a working local DB here would let that one check
  // legitimately succeed and quietly weaken this test from "every check
  // errored" to "most of them did".
  const realDatabaseUrl = process.env.DATABASE_URL;
  beforeEach(() => {
    delete process.env.APPS_SCRIPT_SYNC_URL;
    delete process.env.APPS_SCRIPT_SYNC_SECRET;
    delete process.env.JT_GRANT_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL_DIGEST;
    process.env.DATABASE_URL = "file:/nonexistent-directory/unopenable.db";
  });
  afterEach(() => {
    if (realDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = realDatabaseUrl;
  });

  it("reports every check as an error and still returns a digest", async () => {
    const { computeDigest } = await import("./run");
    const digest = await computeDigest(new Date("2026-08-31T12:00:00-07:00"));

    expect(digest.date).toBe("2026-08-31");
    expect(digest.status).toBe("error");
    expect(digest.results).toHaveLength(enabledChecks().length);
    for (const r of digest.results) {
      expect(r.status).toBe("error");
      expect(r.summary.length).toBeGreaterThan(0);
    }
    // A summary is always present, and never claims things are fine.
    expect(digest.summarySource).toBe("fallback");
    expect(digest.summary).not.toContain("All checks are clear");
    // The run log names each check, so a silent stall is debuggable after the fact.
    for (const c of enabledChecks()) {
      expect(digest.log.join("\n")).toContain(c.id);
    }
  });
});
