/**
 * THE invoice-review settings file. One place, every knob.
 *
 * ── FOR THE OFFICE ──────────────────────────────────────────────────────────
 * Everything you would want to change about what the monthly review flags is in
 * this file: how small a difference is too small to mention, how small an
 * unbilled remainder counts as rounding rather than a missed charge, and which
 * of the softer, more speculative findings you want to see at all. Editing a
 * value here and redeploying changes the review. You should never have to open
 * a check's code to change a threshold — if you find yourself wanting to, the
 * setting is missing and belongs here.
 *
 * Turning a check OFF is `enabled: false` on its block. The check keeps
 * existing, stops running, and stops appearing.
 *
 * ⚠️ TURNING A CHECK OFF IS NOT THE SAME AS RULING ON A FINDING. A ruling says
 * "we looked at this one and it's fine", and it is recorded with a reason and a
 * name against it (see rulings.ts). Disabling a check here makes a whole class
 * of problem stop being looked for, org-wide, silently, for everyone. Reach for
 * a ruling first, essentially always.
 *
 * ── FOR THE NEXT DEVELOPER ──────────────────────────────────────────────────
 * A new check adds: a config block here (typed), one line in `registry.ts`, and
 * its own file under `checks/`. Nothing else changes — not the runner, not the
 * route, not the history, not the page.
 *
 * SEVERITY IS DELIBERATELY NOT HERE YET. Whether a finding is an error or a
 * warning is exactly the policy the plan's Stage 3 sets from evidence — each
 * check accrues a confirmed-versus-overruled tally, and that promotes or
 * demotes it. Hard-coding a severity knob now would put a number here that the
 * later machinery has to take back.
 *
 * Every value here is a DEFAULT, not a fact about production. Nothing in this
 * file reaches JobTread, Drive, Gmail or the Sheet by itself.
 */
import type { InvoiceReviewGlobalSettings } from "./checkTypes";

import type { BackupConfig } from "./checks/backup";
import type { CostBasisConfig } from "./checks/costBasis";
import type { DraftBillsConfig } from "./checks/draftBills";
import type { DuplicateBillConfig } from "./checks/duplicateBill";
import type { InvoiceMathConfig } from "./checks/invoiceMath";
import type { IssueDateConfig } from "./checks/issueDate";
import type { LaborRateConfig } from "./checks/laborRate";
import type { MailCaptureConfig } from "./checks/mailCapture";
import type { MarginConfig } from "./checks/margin";
import type { MarkupDriftConfig } from "./checks/markupDrift";
import type { UninvoicedConfig } from "./checks/uninvoiced";
import type { VendorSilentConfig } from "./checks/vendorSilent";

/** One check's policy: whether it runs, and what it runs with. */
export interface SettingsBlock<C> {
  enabled: boolean;
  config: C;
}

export interface InvoiceReviewSettings {
  global: InvoiceReviewGlobalSettings;
  checks: {
    backup: SettingsBlock<BackupConfig>;
    "invoice-math": SettingsBlock<InvoiceMathConfig>;
    "issue-date": SettingsBlock<IssueDateConfig>;
    "cost-basis": SettingsBlock<CostBasisConfig>;
    "duplicate-bill": SettingsBlock<DuplicateBillConfig>;
    uninvoiced: SettingsBlock<UninvoicedConfig>;
    "draft-bills": SettingsBlock<DraftBillsConfig>;
    "labor-rate": SettingsBlock<LaborRateConfig>;
    "mail-capture": SettingsBlock<MailCaptureConfig>;
    "vendor-silent": SettingsBlock<VendorSilentConfig>;
    margin: SettingsBlock<MarginConfig>;
    "markup-drift": SettingsBlock<MarkupDriftConfig>;
  };
}

export const DEFAULT_SETTINGS: InvoiceReviewSettings = {
  global: {
    // A cent. Floating-point money drifts below this; a real error never hides
    // under it. Shared by every check on purpose — two checks disagreeing about
    // what "equal" means is how a review starts contradicting itself.
    tolerance: 0.01,
  },
  checks: {
    backup: {
      enabled: true,
      config: {
        // Both directions on by default. The unmatched-file half is the softer
        // one — a PDF filed here may simply belong to another month — but it is
        // also the half that catches a charge nobody ever billed on.
        reportUnmatchedFiles: true,
        reportDuplicates: true,
      },
    },
    "invoice-math": { enabled: true, config: {} },
    "issue-date": { enabled: true, config: {} },
    "cost-basis": { enabled: true, config: {} },
    "duplicate-bill": { enabled: true, config: {} },
    uninvoiced: {
      enabled: true,
      config: {
        // Below fifty cents an "unbilled remainder" is rounding between two
        // systems, not a charge anyone forgot.
        remainderFloor: 0.5,
      },
    },
    "draft-bills": { enabled: true, config: {} },
    // ── Labor rates ───────────────────────────────────────────────────────
    // JobTread snapshots the hourly rate onto a time entry and never re-costs
    // it, so a rate changed today leaves every entry already logged behind.
    // The symptom is a month that will not reconcile and no visible cause.
    "labor-rate": {
      enabled: true,
      config: {
        // A dollar of cost difference. Below that it is a rate that moved by
        // pennies on a short entry, not a rate anybody changed.
        minVarianceCost: 1,
        // On by default: a pay type that vanished from a membership means the
        // month's cost cannot be verified against anything, and silence there
        // reads as a pass.
        reportUnknownTypes: true,
      },
    },
    "mail-capture": {
      enabled: true,
      config: {
        // Unknown senders are noisy by nature — no bill list existed to search,
        // so nothing was ever proven. On by default because a new vendor whose
        // first invoice was never filed is exactly the thing worth catching,
        // and the finding says plainly that it proves nothing.
        reportUnknownSenders: true,
      },
    },
    "vendor-silent": {
      enabled: true,
      config: {
        // Deliberately strict. This check reasons from a pattern rather than
        // from a document, so it earns its place only by being right nearly
        // every time it speaks — one wrong nag a month and it gets ignored,
        // and then so does everything near it.
        minMonthsRatio: 0.8, // four months in five
        minMonthsSeen: 3,
        minTypicalCost: 250, // the month a $12 hardware run didn't happen is not news
      },
    },
    // ── Margin ────────────────────────────────────────────────────────────
    // Ascent bills cost-plus, so the markup IS the revenue: a line that reaches
    // a client invoice at cost earns nothing, and nothing else in the review
    // would ever notice — the invoice foots, the bill is captured, the backup
    // is filed, and the client pays it without a murmur.
    margin: {
      enabled: true,
      config: {
        // The whole false-positive risk here is lines with NO cost recorded:
        // JobTread holds 0 for a flat-priced line, and reading that as "billed
        // at zero cost" would fire on every deposit and allowance draw on every
        // invoice. The floor plus the cost>0 guard in the check is what keeps
        // this out of the flood category.
        minLineCost: 25,
        // Cost codes billed at cost ON PURPOSE. Empty to start: the office
        // should fill it from what the first month or two actually reports,
        // rather than from a guess made here about which codes are
        // pass-through. This list is the pressure valve that stops them ruling
        // on the same permit line every month forever.
        passThroughCodes: [],
        reportMissingMarkup: true,
        reportBelowCost: true,
      },
    },
    "markup-drift": {
      enabled: true,
      config: {
        // Ascent charges different markups to different customers, so this is
        // measured against the CUSTOMER'S OWN history and nothing else. Strict,
        // like vendor-silent and for the same reason: a check that reasons from
        // a pattern earns its place only by being right nearly every time.
        minMonthsSeen: 3,
        minPointsOff: 3, // percentage points off their usual rate
        minDollarsOff: 500, // and worth this much, so a wide swing on a tiny month is silent
        minMonthCost: 2000, // a trivial month can produce a wild ratio; ignore it
      },
    },
  },
};

/** Every check id that has a settings block — the registry checks itself
 *  against this, so a typo'd id is caught rather than silently not running. */
export type CheckId = keyof InvoiceReviewSettings["checks"];
