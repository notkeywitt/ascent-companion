import type { PaveConfig } from "./jobtread";

/** Server-side Pave config from env. Never import this into client components. */
export function getPaveConfig(): PaveConfig {
  return {
    grantKey: process.env.JT_GRANT_KEY ?? "",
    orgId: process.env.JT_ORG_ID ?? "",
  };
}

export function hasGrant(): boolean {
  return Boolean(process.env.JT_GRANT_KEY);
}

/**
 * Master gate for ALL writes to JobTread. Off by default. Only flip to "true"
 * once we've coordinated with the existing AppSheet→JobTread flow so the two
 * systems don't fight over the same bills.
 */
export function writesEnabled(): boolean {
  return process.env.COMPANION_WRITES_ENABLED === "true";
}
