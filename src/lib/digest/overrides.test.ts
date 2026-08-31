import { describe, expect, it } from "vitest";

import { mergeSettings } from "./overrides";
import { DIGEST_SETTINGS } from "./settings";

/**
 * `mergeSettings` is the pure half of the /admin digest-settings override
 * layer — no DB here (see overrides.ts's header comment on why this repo's
 * vitest suite stays DB-free). `getDigestOverrides` (the DB read) and
 * `resolveChecks` (the orchestrator) are exercised manually against a real
 * database instead, same as the Role Defaults feature this mirrors.
 */
describe("mergeSettings", () => {
  it("returns the defaults unchanged when there are no overrides", () => {
    const merged = mergeSettings({});
    expect(merged).toEqual(DIGEST_SETTINGS);
  });

  it("an enabled override fully replaces the default", () => {
    expect(DIGEST_SETTINGS["email-followups"].enabled).toBe(true);
    const merged = mergeSettings({ "email-followups": { enabled: false } });
    expect(merged["email-followups"].enabled).toBe(false);
    // Its config is untouched by an enabled-only override.
    expect(merged["email-followups"].config).toEqual(DIGEST_SETTINGS["email-followups"].config);
  });

  it("a config override merges key-by-key, not wholesale", () => {
    const merged = mergeSettings({ "calendar-events": { config: { days: 14 } } });
    const cfg = merged["calendar-events"].config as Record<string, unknown>;
    expect(cfg.days).toBe(14);
    // Untouched keys survive the default unchanged.
    expect(cfg.calendarNames).toEqual(DIGEST_SETTINGS["calendar-events"].config.calendarNames);
    expect(cfg.includePrimary).toBe(DIGEST_SETTINGS["calendar-events"].config.includePrimary);
    // enabled is untouched by a config-only override.
    expect(merged["calendar-events"].enabled).toBe(DIGEST_SETTINGS["calendar-events"].enabled);
  });

  it("an override for an unknown check id is ignored, not invented", () => {
    const merged = mergeSettings({ "no-such-check": { enabled: true, config: { x: 1 } } });
    expect(merged).toEqual(DIGEST_SETTINGS);
    expect(merged["no-such-check"]).toBeUndefined();
  });

  it("can turn an off-by-default billing check back on", () => {
    expect(DIGEST_SETTINGS["uncaptured-bills"].enabled).toBe(false);
    const merged = mergeSettings({ "uncaptured-bills": { enabled: true } });
    expect(merged["uncaptured-bills"].enabled).toBe(true);
  });
});
