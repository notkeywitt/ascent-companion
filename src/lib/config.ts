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
