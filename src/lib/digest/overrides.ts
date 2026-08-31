/**
 * The Daily Digest's live settings — DIGEST_SETTINGS defaults, layered with
 * whatever an admin has changed from /admin → Digest, stored in the
 * `digest_settings_overrides` table (src/db/schema.ts).
 *
 * Split into a pure merge (`mergeSettings`, no DB — unit-tested directly) and
 * an impure read (`getDigestOverrides`, the DB call), because this repo's
 * test suite is deliberately "pure modules, no DB, no network" (see
 * vitest.config.ts) — keeping the merge logic pure is what lets it stay
 * covered by that suite instead of needing a real database to test.
 *
 * READ FRESH ON EVERY DIGEST RUN, not cached or baked into a session. That's
 * a deliberate departure from the Role Defaults pattern this feature mirrors
 * (role_access is baked into a session JWT at sign-in — see src/auth.ts) —
 * the digest's caller (/api/digest/run) is a scheduler with no session at
 * all, so there is nothing to bake an override into. One extra DB read, once
 * a day, is the whole cost of a setting taking effect on the very next run.
 */
import { db, ensureDb } from "@/db";
import { digestSettingsOverrides } from "@/db/schema";
import { DIGEST_SETTINGS } from "./settings";
import { bindChecks, type SettingsBlock } from "./registry";
import type { DigestCheck } from "./types";

export interface DigestOverride {
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/**
 * Pure. Layers `overrides` onto DIGEST_SETTINGS:
 *  - an override for a check id DIGEST_SETTINGS doesn't know is ignored (a
 *    stale row from a since-removed check shouldn't invent a phantom one);
 *  - `enabled` fully replaces the default when present;
 *  - `config` merges KEY-BY-KEY over the default config — a partial override
 *    (e.g. just `{lookbackDays: 5}`) never blanks out the rest of that
 *    check's settings.
 */
export function mergeSettings(
  overrides: Record<string, DigestOverride>,
): Record<string, SettingsBlock> {
  const merged: Record<string, SettingsBlock> = {};
  for (const [id, block] of Object.entries(DIGEST_SETTINGS)) {
    const o = overrides[id];
    merged[id] = {
      enabled: o?.enabled ?? block.enabled,
      config: o?.config ? { ...(block.config as object), ...o.config } : block.config,
    };
  }
  return merged;
}

function parseConfig(json: string | null): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every stored override, keyed by check id. Fail-soft: an unreachable DB or a
 * corrupt row degrades to "no overrides" (pure defaults) rather than breaking
 * the digest — mirrors `roleBaseFor`'s DB-error fallback in src/auth.ts.
 */
export async function getDigestOverrides(): Promise<Record<string, DigestOverride>> {
  try {
    await ensureDb();
    const rows = await db.select().from(digestSettingsOverrides);
    const out: Record<string, DigestOverride> = {};
    for (const r of rows) {
      out[r.checkId] = { enabled: r.enabled ?? undefined, config: parseConfig(r.config) };
    }
    return out;
  } catch {
    return {};
  }
}

/** What a real digest run uses: fresh DB read, merged over the defaults, bound
 *  into checks. Called once per run by `runDigest` — never by `computeDigest`
 *  directly, so tests that call `computeDigest` stay DB-free. */
export async function resolveChecks(): Promise<DigestCheck<never>[]> {
  const overrides = await getDigestOverrides();
  return bindChecks(mergeSettings(overrides));
}
